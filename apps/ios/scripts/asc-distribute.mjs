#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// TestFlight distributor (#1691). After `testflight.sh` uploads a build via
// xcodebuild, this script waits for App Store Connect to finish processing
// it, fixes "Missing Export Compliance" if ASC still asks, sets What to
// Test, adds the build to every configured internal and external tester
// group, and submits beta app review once when external testing needs it.
// `--print-next-build-number` lets testflight.sh compute the build number
// (CLI argument, or the latest ASC build for the version + 1) through the
// same tested helper used here. `--dry-run` issues GET requests only and
// prints the plan.
//
// No npm dependencies: node:crypto signs the ES256 App Store Connect API
// JWT, and node:util parses argv. All side effects (fetch, file reads, git,
// sleep, the clock, logging) are injected so the logic is unit-testable
// without a network connection — see asc-distribute.test.mjs.

import { sign as cryptoSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ASC_BASE_URL = 'https://api.appstoreconnect.apple.com';
export const JWT_AUDIENCE = 'appstoreconnect-v1';
export const JWT_LIFETIME_SECONDS = 1200;
export const JWT_REFRESH_MARGIN_SECONDS = 60;
export const WHATS_NEW_MAX_CHARS = 4000;
export const NOTES_LOCALE = 'en-US';
export const READY_STATE = 'READY_FOR_BETA_SUBMISSION';
export const EXTERNAL_STATE_ALREADY_SUBMITTED = new Set([
  'WAITING_FOR_BETA_REVIEW',
  'IN_BETA_REVIEW',
  'BETA_APPROVED',
  'IN_BETA_TESTING',
]);
export const REQUIRED_ENV = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH'];

const DEFAULT_PROCESSING_TIMEOUT_SECONDS = 1800;
const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const CONTACT_FIELDS = ['contactEmail', 'contactPhone', 'contactFirstName', 'contactLastName'];
const GIT_NOTES_COMMIT_COUNT = 20;

/**
 * @typedef {{ bundleId: string, internalGroups: string[], externalGroups: string[],
 *   processingTimeoutSeconds: number, pollIntervalSeconds: number }} TestflightConfig
 * @typedef {{ get(path: string): Promise<any>, post(path: string, body: any): Promise<any>,
 *   patch(path: string, body: any): Promise<any> }} AscClient
 * @typedef {{ app: { id: string, bundleId: string }, build: { id: string, version: string,
 *   buildNumber: string, processingState: string } | null, steps: Array<{ description: string,
 *   planned: boolean }> }} DistributionPlan
 */

function splitList(value) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function dedupe(values) {
  return [...new Set(values)];
}

/** @returns {TestflightConfig} */
export function loadConfig(fileText, env) {
  let parsed;
  try {
    parsed = JSON.parse(fileText);
  } catch (err) {
    throw new Error(`testflight.config.json is not valid JSON: ${err.message}`, { cause: err });
  }
  if (parsed === null || typeof parsed !== 'object') {
    parsed = {};
  }

  const bundleId = env.ASC_BUNDLE_ID?.trim() || parsed.bundleId;
  if (!bundleId) {
    throw new Error(
      'testflight.config.json must set a non-empty "bundleId" (or export ASC_BUNDLE_ID)',
    );
  }

  const internalGroups = dedupe(
    env.ASC_INTERNAL_GROUPS !== undefined ? splitList(env.ASC_INTERNAL_GROUPS) : parsed.internalGroups ?? [],
  );
  const externalGroups = dedupe(
    env.ASC_EXTERNAL_GROUPS !== undefined ? splitList(env.ASC_EXTERNAL_GROUPS) : parsed.externalGroups ?? [],
  );

  let processingTimeoutSeconds = parsed.processingTimeoutSeconds ?? DEFAULT_PROCESSING_TIMEOUT_SECONDS;
  if (env.ASC_PROCESSING_TIMEOUT_SECONDS !== undefined) {
    const n = Number(env.ASC_PROCESSING_TIMEOUT_SECONDS);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(
        `ASC_PROCESSING_TIMEOUT_SECONDS must be a positive integer, got "${env.ASC_PROCESSING_TIMEOUT_SECONDS}"`,
      );
    }
    processingTimeoutSeconds = n;
  }

  const pollIntervalSeconds = parsed.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;

  return { bundleId, internalGroups, externalGroups, processingTimeoutSeconds, pollIntervalSeconds };
}

export function readCredentials(env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing App Store Connect env var(s): ${missing.join(', ')}. Export them (see apps/ios/README.md "TestFlight").`,
    );
  }
  return { keyId: env.ASC_KEY_ID, issuerId: env.ASC_ISSUER_ID, keyPath: env.ASC_KEY_PATH };
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createJwt({ keyId, issuerId, privateKeyPem, nowSeconds }) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = { iss: issuerId, iat: nowSeconds, exp: nowSeconds + JWT_LIFETIME_SECONDS, aud: JWT_AUDIENCE };
  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64url(signature)}`;
}

export function nextBuildNumber({ override, existing = [] }) {
  if (override !== undefined && override !== null) {
    if (!/^[1-9]\d*$/.test(String(override))) {
      throw new Error(`--build-number must be a positive integer, got "${override}"`);
    }
    return String(override);
  }
  const numbers = existing.filter((s) => /^\d+$/.test(s)).map(Number);
  if (numbers.length === 0) return '1';
  return String(Math.max(...numbers) + 1);
}

/** @returns {AscClient} */
export function createAscClient({ fetch, getToken, baseUrl = ASC_BASE_URL }) {
  async function request(method, path, body) {
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const detail = json?.errors?.[0]?.detail || json?.errors?.[0]?.title || res.statusText;
      throw new Error(`ASC ${method} ${path} failed (${res.status}): ${detail}`);
    }
    return json;
  }

  async function get(path) {
    const first = await request('GET', path);
    if (!Array.isArray(first.data)) return first;
    let data = first.data.slice();
    const included = first.included;
    let next = first.links?.next;
    while (next) {
      const page = await request('GET', next);
      data = data.concat(page.data ?? []);
      next = page.links?.next;
    }
    return { data, included };
  }

  return {
    get,
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
  };
}

function findGroupByName(groups, name) {
  return groups.find((g) => g.attributes.name === name);
}

function resolveGroups(config, allGroups) {
  const missing = [];
  let mismatch = null;

  const internalResolved = [];
  for (const name of config.internalGroups) {
    const found = findGroupByName(allGroups, name);
    if (!found) {
      missing.push(name);
      continue;
    }
    if (!found.attributes.isInternalGroup && !mismatch) {
      mismatch = `Tester group "${name}" is configured as internal but is an external group in App Store Connect`;
      continue;
    }
    internalResolved.push(found);
  }

  const externalResolved = [];
  for (const name of config.externalGroups) {
    const found = findGroupByName(allGroups, name);
    if (!found) {
      missing.push(name);
      continue;
    }
    if (found.attributes.isInternalGroup && !mismatch) {
      mismatch = `Tester group "${name}" is configured as external but is an internal group in App Store Connect`;
      continue;
    }
    externalResolved.push(found);
  }

  if (missing.length > 0) {
    throw new Error(
      `Tester group(s) not found in App Store Connect: ${missing.map((n) => `"${n}"`).join(', ')}. ` +
        'Create it in App Store Connect > TestFlight or fix apps/ios/testflight.config.json',
    );
  }
  if (mismatch) {
    throw new Error(mismatch);
  }

  return { internalResolved, externalResolved };
}

async function fetchBuild({ client, appId, version, buildNumber }) {
  const query =
    `/v1/builds?filter[app]=${encodeURIComponent(appId)}` +
    `&filter[version]=${encodeURIComponent(buildNumber)}` +
    `&filter[preReleaseVersion.version]=${encodeURIComponent(version)}` +
    '&include=buildBetaDetail';
  const result = await client.get(query);
  return result.data[0] ?? null;
}

async function waitForProcessing({ client, appId, version, buildNumber, config, dryRun, sleep, now, log }) {
  if (dryRun) {
    const build = await fetchBuild({ client, appId, version, buildNumber });
    if (!build) {
      log(`build ${version}(${buildNumber}) not yet visible in App Store Connect`);
      return null;
    }
    log(`build ${build.id} ${version}(${buildNumber}) ${build.attributes.processingState}`);
    return build;
  }

  const deadline = now() + config.processingTimeoutSeconds * 1000;
  while (true) {
    const build = await fetchBuild({ client, appId, version, buildNumber });
    if (build) {
      const state = build.attributes.processingState;
      if (state === 'VALID') {
        log(`build ${build.id} ${version}(${buildNumber}) ${state}`);
        return build;
      }
      if (state === 'FAILED' || state === 'INVALID') {
        throw new Error(`Build ${version} (${buildNumber}) is ${state}`);
      }
    }
    if (now() > deadline) {
      throw new Error(`Build ${version} (${buildNumber}) is still processing after ${config.processingTimeoutSeconds}s`);
    }
    await sleep(config.pollIntervalSeconds * 1000);
  }
}

/** @returns {Promise<DistributionPlan>} */
export async function distribute({ client, config, version, buildNumber, notes, dryRun, sleep, now, log }) {
  const steps = [];
  const write = async (description, fn) => {
    if (dryRun) {
      log(`PLAN ${description}`);
      steps.push({ description, planned: true });
      return undefined;
    }
    const result = await fn();
    log(description);
    steps.push({ description, planned: false });
    return result;
  };

  const appsResult = await client.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(config.bundleId)}`);
  const appData = appsResult.data[0];
  if (!appData) {
    throw new Error(`No App Store Connect app with bundle id ${config.bundleId}`);
  }
  const appId = appData.id;
  log(`app ${appId}`);

  const build = await waitForProcessing({ client, appId, version, buildNumber, config, dryRun, sleep, now, log });

  const groupsResult = await client.get(`/v1/betaGroups?filter[app]=${encodeURIComponent(appId)}&limit=200`);
  const { internalResolved, externalResolved } = resolveGroups(config, groupsResult.data);
  for (const g of internalResolved) log(`group ${g.attributes.name} ${g.id} internal`);
  for (const g of externalResolved) log(`group ${g.attributes.name} ${g.id} external`);

  if (config.externalGroups.length > 0) {
    const detailResult = await client.get(`/v1/apps/${appId}/betaAppReviewDetail`);
    const attrs = detailResult.data.attributes;
    const missingFields = CONTACT_FIELDS.filter((f) => !attrs[f]);
    if (missingFields.length > 0) {
      throw new Error(
        `Beta App Review contact details are missing (${missingFields.join(', ')}); ` +
          'fill them in App Store Connect > TestFlight > Test Information',
      );
    }
  }

  if (build) {
    const usesNonExemptEncryption = build.attributes.usesNonExemptEncryption;
    if (usesNonExemptEncryption === true) {
      throw new Error(
        `Build ${version} (${buildNumber}) already answers usesNonExemptEncryption=YES; ` +
          'the distributor never overrides an explicit answer',
      );
    }
    if (usesNonExemptEncryption === null || usesNonExemptEncryption === undefined) {
      await write(`compliance: set usesNonExemptEncryption=false on build ${build.id}`, () =>
        client.patch(`/v1/builds/${build.id}`, {
          data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } },
        }),
      );
    }

    const trimmedNotes = (notes ?? '').slice(0, WHATS_NEW_MAX_CHARS);
    if (trimmedNotes) {
      const locResult = await client.get(`/v1/builds/${build.id}/betaBuildLocalizations`);
      const existingLoc = locResult.data.find((l) => l.attributes.locale === NOTES_LOCALE);
      if (existingLoc) {
        await write(`What to Test: update ${NOTES_LOCALE} localization ${existingLoc.id}`, () =>
          client.patch(`/v1/betaBuildLocalizations/${existingLoc.id}`, {
            data: { type: 'betaBuildLocalizations', id: existingLoc.id, attributes: { whatsNew: trimmedNotes } },
          }),
        );
      } else {
        await write(`What to Test: create ${NOTES_LOCALE} localization for build ${build.id}`, () =>
          client.post('/v1/betaBuildLocalizations', {
            data: {
              type: 'betaBuildLocalizations',
              attributes: { locale: NOTES_LOCALE, whatsNew: trimmedNotes },
              relationships: { build: { data: { type: 'builds', id: build.id } } },
            },
          }),
        );
      }
    }

    for (const g of internalResolved) {
      if (g.attributes.hasAccessToAllBuilds) {
        log(`group ${g.attributes.name} already receives all builds`);
        continue;
      }
      await write(`add build ${build.id} to internal group ${g.attributes.name} (${g.id})`, () =>
        client.post(`/v1/betaGroups/${g.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] }),
      );
    }

    if (config.externalGroups.length > 0) {
      const detailResult = await client.get(`/v1/builds/${build.id}/buildBetaDetail`);
      const externalState = detailResult.data.attributes.externalBuildState;
      if (externalState === READY_STATE || (dryRun && externalState === 'MISSING_EXPORT_COMPLIANCE')) {
        await write(`submit build ${build.id} for beta app review`, () =>
          client.post('/v1/betaAppReviewSubmissions', {
            data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
          }),
        );
      } else if (EXTERNAL_STATE_ALREADY_SUBMITTED.has(externalState)) {
        log(`beta review: already ${externalState}`);
      } else {
        throw new Error(
          `Build ${version} (${buildNumber}) cannot be submitted for beta review: buildBetaDetail state is ${externalState}`,
        );
      }
    }

    for (const g of externalResolved) {
      await write(`add build ${build.id} to external group ${g.attributes.name} (${g.id})`, () =>
        client.post(`/v1/betaGroups/${g.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] }),
      );
    }
  }

  return {
    app: { id: appId, bundleId: config.bundleId },
    build: build
      ? { id: build.id, version, buildNumber, processingState: build.attributes.processingState }
      : null,
    steps,
  };
}

function resolveNotesFromGit(exec) {
  try {
    const tag = exec('git', ['describe', '--tags', '--abbrev=0']).trim();
    if (!tag) throw new Error('no tag found');
    return exec(
      'git',
      ['log', `${tag}..HEAD`, '--no-merges', '--pretty=format:- %s', '--', 'apps/ios'],
    ).trim();
  } catch {
    try {
      return exec(
        'git',
        ['log', `-${GIT_NOTES_COMMIT_COUNT}`, '--no-merges', '--pretty=format:- %s', '--', 'apps/ios'],
      ).trim();
    } catch {
      return '';
    }
  }
}

function defaultConfigPath() {
  return fileURLToPath(new URL('../testflight.config.json', import.meta.url));
}

export async function main(argv, deps) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        version: { type: 'string' },
        'build-number': { type: 'string' },
        notes: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'print-next-build-number': { type: 'boolean', default: false },
        config: { type: 'string' },
      },
    });

    if (!values.version) {
      throw new Error('--version is required');
    }

    const credentials = readCredentials(deps.env);
    let privateKeyPem;
    try {
      privateKeyPem = deps.readFile(credentials.keyPath);
    } catch (err) {
      throw new Error(`Could not read ASC_KEY_PATH "${credentials.keyPath}": ${err.message}`, { cause: err });
    }

    const configPath = values.config ?? defaultConfigPath();
    const config = loadConfig(deps.readFile(configPath), deps.env);

    let cachedToken = null;
    let cachedExpiry = 0;
    const getToken = () => {
      const nowSeconds = Math.floor(deps.now() / 1000);
      if (!cachedToken || nowSeconds >= cachedExpiry - JWT_REFRESH_MARGIN_SECONDS) {
        cachedToken = createJwt({ keyId: credentials.keyId, issuerId: credentials.issuerId, privateKeyPem, nowSeconds });
        cachedExpiry = nowSeconds + JWT_LIFETIME_SECONDS;
      }
      return cachedToken;
    };

    const client = createAscClient({ fetch: deps.fetch, getToken });

    if (values['print-next-build-number']) {
      if (values['build-number'] !== undefined) {
        deps.log(nextBuildNumber({ override: values['build-number'], existing: [] }));
        return 0;
      }
      const appsResult = await client.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(config.bundleId)}`);
      const appData = appsResult.data[0];
      if (!appData) {
        throw new Error(`No App Store Connect app with bundle id ${config.bundleId}`);
      }
      const existingResult = await client.get(
        `/v1/builds?filter[app]=${encodeURIComponent(appData.id)}` +
          `&filter[preReleaseVersion.version]=${encodeURIComponent(values.version)}&limit=200`,
      );
      const existing = existingResult.data.map((b) => b.attributes.version);
      deps.log(nextBuildNumber({ existing }));
      return 0;
    }

    if (!values['build-number']) {
      throw new Error('--build-number is required');
    }
    nextBuildNumber({ override: values['build-number'], existing: [] });

    const notes = values.notes ?? resolveNotesFromGit(deps.exec);

    await distribute({
      client,
      config,
      version: values.version,
      buildNumber: values['build-number'],
      notes,
      dryRun: Boolean(values['dry-run']),
      sleep: deps.sleep,
      now: deps.now,
      log: deps.log,
    });

    return 0;
  } catch (err) {
    deps.error(`error: ${err.message}`);
    return 1;
  }
}

/* c8 ignore start -- real-process wiring: exercised on the Mini, not under test */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const realDeps = {
    env: process.env,
    fetch: globalThis.fetch,
    readFile: (p) => readFileSync(p, 'utf8'),
    exec: (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  };
  process.exitCode = await main(process.argv.slice(2), realDeps);
}
/* c8 ignore stop */
