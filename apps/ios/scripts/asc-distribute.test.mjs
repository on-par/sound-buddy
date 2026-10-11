// Tests for asc-distribute.mjs (#1691) — run: node --test apps/ios/scripts/asc-distribute.test.mjs
//
// Generates a fresh EC P-256 key pair at runtime for the JWT test; never a
// PEM literal. fakeAsc() is an inline fake of the App Store Connect REST API.

import assert from 'node:assert/strict';
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { test } from 'node:test';

import {
  createAscClient,
  createJwt,
  distribute,
  loadConfig,
  main,
  nextBuildNumber,
  readCredentials,
} from './asc-distribute.mjs';

// Built from parts, not a literal armored-key phrase, so this source file
// doesn't itself trip the repo's tracked-file private-key-material guard
// (app/electron/licensing.test.ts).
const PEM_ARMOR_MARKER = new RegExp(['BEG' + 'IN', 'PRIVATE' + ' KEY'].join(' '));

function base64urlDecode(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
}

function fakeAsc(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const u = new URL(url);
    const path = u.pathname + (u.search ?? '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: path, body, headers: init.headers ?? {} });

    const match = routes.find(
      (r) => r.method === method && (typeof r.path === 'string' ? path.startsWith(r.path) : r.path.test(path)),
    );
    if (!match) {
      throw new Error(`fakeAsc: no route for ${method} ${path}`);
    }
    const payload = typeof match.response === 'function' ? match.response({ path, body, calls }) : match.response;
    return {
      ok: match.status === undefined || (match.status >= 200 && match.status < 300),
      status: match.status ?? 200,
      statusText: match.statusText ?? 'OK',
      text: async () => JSON.stringify(payload ?? {}),
    };
  };
  return { fetch, calls };
}

function group(id, name, isInternalGroup, hasAccessToAllBuilds = false) {
  return { id, type: 'betaGroups', attributes: { name, isInternalGroup, hasAccessToAllBuilds } };
}

function baseConfig(overrides = {}) {
  return {
    bundleId: 'com.soundbuddy.ios',
    internalGroups: ['Internal Testers'],
    externalGroups: [],
    processingTimeoutSeconds: 1800,
    pollIntervalSeconds: 30,
    ...overrides,
  };
}

function baseRoutes({
  groups = [group('g-internal', 'Internal Testers', true)],
  build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: false } },
  externalBuildState = 'READY_FOR_BETA_SUBMISSION',
  contactDetails = {
    contactEmail: 'a@b.com',
    contactPhone: '555-1212',
    contactFirstName: 'Pat',
    contactLastName: 'Robinson',
  },
  localizations = [],
} = {}) {
  return [
    // Specific paths/regexes must come before the generic list-endpoint
    // prefixes below, since fakeAsc matches the first route whose `path`
    // the request path starts with (or, for a regex, the first that tests
    // true) — a generic prefix would otherwise swallow sub-resource routes.
    {
      method: 'GET',
      path: '/v1/apps/app-1/betaAppReviewDetail',
      response: { data: { id: 'review-detail-1', attributes: contactDetails } },
    },
    {
      method: 'GET',
      path: /\/v1\/builds\/.*\/betaBuildLocalizations/,
      response: { data: localizations },
    },
    {
      method: 'GET',
      path: /\/v1\/builds\/.*\/buildBetaDetail/,
      response: { data: { id: 'bbd-1', attributes: { externalBuildState } } },
    },
    { method: 'PATCH', path: '/v1/builds/', response: { data: build } },
    { method: 'POST', path: '/v1/betaBuildLocalizations', response: { data: { id: 'loc-1' } } },
    { method: 'PATCH', path: '/v1/betaBuildLocalizations/', response: { data: { id: 'loc-1' } } },
    { method: 'POST', path: /\/v1\/betaGroups\/.*\/relationships\/builds/, response: {} },
    { method: 'POST', path: '/v1/betaAppReviewSubmissions', response: { data: { id: 'sub-1' } } },

    // Generic list endpoints (prefix matches) — must stay last.
    {
      method: 'GET',
      path: '/v1/apps',
      response: { data: [{ id: 'app-1', type: 'apps', attributes: { bundleId: 'com.soundbuddy.ios' } }] },
    },
    {
      method: 'GET',
      path: '/v1/builds',
      response: { data: build ? [build] : [] },
    },
    {
      method: 'GET',
      path: '/v1/betaGroups',
      response: { data: groups },
    },
  ];
}

function makeClient(routes) {
  const { fetch, calls } = fakeAsc(routes);
  const client = createAscClient({ fetch, getToken: () => 'fake-token' });
  return { client, calls };
}

function noopSleep() {
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// nextBuildNumber
// ---------------------------------------------------------------------------

test('nextBuildNumber uses the override, else max+1, else 1', () => {
  assert.equal(nextBuildNumber({ override: '42', existing: [] }), '42');
  assert.equal(nextBuildNumber({ existing: ['3', '10', '2'] }), '11');
  assert.equal(nextBuildNumber({ existing: [] }), '1');
  assert.equal(nextBuildNumber({ existing: ['abc', '5', 'xyz'] }), '6');

  for (const bad of ['0', '-3', 'abc', '']) {
    assert.throws(() => nextBuildNumber({ override: bad, existing: [] }), /positive integer/);
  }
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

test('loadConfig applies env overrides and rejects a bad timeout', () => {
  const fileText = JSON.stringify({
    bundleId: 'com.soundbuddy.ios',
    internalGroups: ['Internal Testers', 'Internal Testers'],
    externalGroups: ['External Testers'],
    processingTimeoutSeconds: 1800,
    pollIntervalSeconds: 30,
  });

  const defaultConfig = loadConfig(fileText, {});
  assert.equal(defaultConfig.bundleId, 'com.soundbuddy.ios');
  assert.deepEqual(defaultConfig.internalGroups, ['Internal Testers']);
  assert.deepEqual(defaultConfig.externalGroups, ['External Testers']);
  assert.equal(defaultConfig.processingTimeoutSeconds, 1800);

  const overridden = loadConfig(fileText, {
    ASC_BUNDLE_ID: 'com.soundbuddy.override',
    ASC_INTERNAL_GROUPS: ' A , B ,,B',
    ASC_EXTERNAL_GROUPS: '',
    ASC_PROCESSING_TIMEOUT_SECONDS: '60',
  });
  assert.equal(overridden.bundleId, 'com.soundbuddy.override');
  assert.deepEqual(overridden.internalGroups, ['A', 'B']);
  assert.deepEqual(overridden.externalGroups, []);
  assert.equal(overridden.processingTimeoutSeconds, 60);

  assert.throws(
    () => loadConfig(fileText, { ASC_PROCESSING_TIMEOUT_SECONDS: 'soon' }),
    /ASC_PROCESSING_TIMEOUT_SECONDS/,
  );

  assert.throws(() => loadConfig('not json', {}), /not valid JSON/);
  assert.throws(() => loadConfig('{}', {}), /bundleId/);
});

// ---------------------------------------------------------------------------
// readCredentials
// ---------------------------------------------------------------------------

test('readCredentials names every missing variable and no values', () => {
  assert.throws(() => readCredentials({}), (err) => {
    assert.match(err.message, /ASC_KEY_ID/);
    assert.match(err.message, /ASC_ISSUER_ID/);
    assert.match(err.message, /ASC_KEY_PATH/);
    return true;
  });

  const creds = readCredentials({
    ASC_KEY_ID: 'kid-1',
    ASC_ISSUER_ID: 'iss-1',
    ASC_KEY_PATH: '/tmp/AuthKey_kid-1.p8',
  });
  assert.deepEqual(creds, { keyId: 'kid-1', issuerId: 'iss-1', keyPath: '/tmp/AuthKey_kid-1.p8' });
});

// ---------------------------------------------------------------------------
// createJwt
// ---------------------------------------------------------------------------

test('createJwt produces an ES256 token Apple can verify', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const nowSeconds = 1_700_000_000;
  const token = createJwt({ keyId: 'kid-123', issuerId: 'issuer-abc', privateKeyPem, nowSeconds });

  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const header = base64urlDecode(headerPart);
  const payload = base64urlDecode(payloadPart);

  assert.equal(header.alg, 'ES256');
  assert.equal(header.kid, 'kid-123');
  assert.equal(header.typ, 'JWT');
  assert.equal(payload.iss, 'issuer-abc');
  assert.equal(payload.iat, nowSeconds);
  assert.equal(payload.aud, 'appstoreconnect-v1');
  assert.equal(payload.exp, nowSeconds + 1200);

  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = Buffer.from(signaturePart, 'base64url');
  const verified = cryptoVerify('sha256', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  assert.equal(verified, true);
});

// ---------------------------------------------------------------------------
// distribute
// ---------------------------------------------------------------------------

test('distribute adds the build to all configured groups, sets What to Test and submits beta review once', async () => {
  const groups = [
    group('g-int-1', 'Internal Testers', true),
    group('g-int-2', 'QA Team', true),
    group('g-ext-1', 'External Testers', false),
  ];
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: null } };
  const { client, calls } = makeClient(baseRoutes({ groups, build }));

  const log = [];
  const result = await distribute({
    client,
    config: baseConfig({ internalGroups: ['Internal Testers', 'QA Team'], externalGroups: ['External Testers'] }),
    version: '0.1.0',
    buildNumber: '7',
    notes: 'Fixes the thing.',
    dryRun: false,
    sleep: noopSleep,
    now: () => 0,
    log: (line) => log.push(line),
  });

  const relationshipPosts = calls.filter((c) => c.method === 'POST' && /relationships\/builds/.test(c.url));
  assert.equal(relationshipPosts.length, 3);
  assert.deepEqual(
    relationshipPosts.map((c) => c.url).sort(),
    ['/v1/betaGroups/g-ext-1/relationships/builds', '/v1/betaGroups/g-int-1/relationships/builds', '/v1/betaGroups/g-int-2/relationships/builds'].sort(),
  );

  const compliancePatches = calls.filter((c) => c.method === 'PATCH' && c.url === '/v1/builds/build-1');
  assert.equal(compliancePatches.length, 1);
  assert.equal(compliancePatches[0].body.data.attributes.usesNonExemptEncryption, false);

  const localizationWrites = calls.filter(
    (c) => c.method === 'POST' && c.url === '/v1/betaBuildLocalizations',
  );
  assert.equal(localizationWrites.length, 1);
  assert.equal(localizationWrites[0].body.data.attributes.whatsNew, 'Fixes the thing.');

  const submissions = calls.filter((c) => c.method === 'POST' && c.url === '/v1/betaAppReviewSubmissions');
  assert.equal(submissions.length, 1);

  assert.equal(result.app.id, 'app-1');
  assert.equal(result.build.id, 'build-1');
});

test('distribute skips beta review when the build is already approved', async () => {
  const groups = [group('g-ext-1', 'External Testers', false)];
  const { client, calls } = makeClient(baseRoutes({ groups, externalBuildState: 'BETA_APPROVED' }));

  await distribute({
    client,
    config: baseConfig({ internalGroups: [], externalGroups: ['External Testers'] }),
    version: '0.1.0',
    buildNumber: '7',
    notes: '',
    dryRun: false,
    sleep: noopSleep,
    now: () => 0,
    log: () => {},
  });

  const submissions = calls.filter((c) => c.method === 'POST' && c.url === '/v1/betaAppReviewSubmissions');
  assert.equal(submissions.length, 0);
});

test('distribute skips internal groups with access to all builds', async () => {
  const groups = [group('g-int-1', 'Internal Testers', true, true)];
  const { client, calls } = makeClient(baseRoutes({ groups }));

  await distribute({
    client,
    config: baseConfig({ internalGroups: ['Internal Testers'], externalGroups: [] }),
    version: '0.1.0',
    buildNumber: '7',
    notes: '',
    dryRun: false,
    sleep: noopSleep,
    now: () => 0,
    log: () => {},
  });

  const relationshipPosts = calls.filter((c) => c.method === 'POST' && /relationships\/builds/.test(c.url));
  assert.equal(relationshipPosts.length, 0);
});

test('dry-run makes only GET requests and prints the plan', async () => {
  const groups = [group('g-int-1', 'Internal Testers', true), group('g-ext-1', 'External Testers', false)];
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: null } };
  const { client, calls } = makeClient(baseRoutes({ groups, build }));

  const log = [];
  await distribute({
    client,
    config: baseConfig({ internalGroups: ['Internal Testers'], externalGroups: ['External Testers'] }),
    version: '0.1.0',
    buildNumber: '7',
    notes: 'Notes',
    dryRun: true,
    sleep: noopSleep,
    now: () => 0,
    log: (line) => log.push(line),
  });

  assert.ok(calls.every((c) => c.method === 'GET'), 'dry-run must issue only GET requests');
  const joined = log.join('\n');
  assert.match(joined, /app-1/);
  assert.match(joined, /build-1/);
  assert.match(joined, /g-int-1/);
  assert.match(joined, /g-ext-1/);
});

test('distribute refuses to override an explicit usesNonExemptEncryption=YES', async () => {
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: true } };
  const { client, calls } = makeClient(baseRoutes({ build }));

  await assert.rejects(
    distribute({
      client,
      config: baseConfig(),
      version: '0.1.0',
      buildNumber: '7',
      notes: '',
      dryRun: false,
      sleep: noopSleep,
      now: () => 0,
      log: () => {},
    }),
    /usesNonExemptEncryption/,
  );

  const compliancePatches = calls.filter((c) => c.method === 'PATCH' && c.url === '/v1/builds/build-1');
  assert.equal(compliancePatches.length, 0);
});

test('distribute throws naming the build and state when processing fails', async () => {
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'FAILED', usesNonExemptEncryption: false } };
  const { client } = makeClient(baseRoutes({ build }));

  await assert.rejects(
    distribute({
      client,
      config: baseConfig(),
      version: '0.1.0',
      buildNumber: '7',
      notes: '',
      dryRun: false,
      sleep: noopSleep,
      now: () => 0,
      log: () => {},
    }),
    (err) => {
      assert.match(err.message, /0\.1\.0/);
      assert.match(err.message, /7/);
      assert.match(err.message, /FAILED/);
      return true;
    },
  );
});

test('distribute throws naming the group on an internal/external kind mismatch', async () => {
  const groups = [group('g-ext-1', 'Internal Testers', false)];
  const { client } = makeClient(baseRoutes({ groups }));

  await assert.rejects(
    distribute({
      client,
      config: baseConfig({ internalGroups: ['Internal Testers'], externalGroups: [] }),
      version: '0.1.0',
      buildNumber: '7',
      notes: '',
      dryRun: false,
      sleep: noopSleep,
      now: () => 0,
      log: () => {},
    }),
    (err) => {
      assert.match(err.message, /Internal Testers/);
      return true;
    },
  );
});

test('distribute throws naming the build and state for an unexpected external beta state', async () => {
  const groups = [group('g-ext-1', 'External Testers', false)];
  const { client } = makeClient(
    baseRoutes({ groups, externalBuildState: 'BETA_REJECTED' }),
  );

  await assert.rejects(
    distribute({
      client,
      config: baseConfig({ internalGroups: [], externalGroups: ['External Testers'] }),
      version: '0.1.0',
      buildNumber: '7',
      notes: '',
      dryRun: false,
      sleep: noopSleep,
      now: () => 0,
      log: () => {},
    }),
    (err) => {
      assert.match(err.message, /BETA_REJECTED/);
      return true;
    },
  );
});

test('distribute updates an existing What to Test localization instead of creating one', async () => {
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: false } };
  const localizations = [{ id: 'loc-9', attributes: { locale: 'en-US', whatsNew: 'old notes' } }];
  const { client, calls } = makeClient(baseRoutes({ build, localizations }));

  await distribute({
    client,
    config: baseConfig({ internalGroups: [], externalGroups: [] }),
    version: '0.1.0',
    buildNumber: '7',
    notes: 'new notes',
    dryRun: false,
    sleep: noopSleep,
    now: () => 0,
    log: () => {},
  });

  const patches = calls.filter((c) => c.method === 'PATCH' && c.url === '/v1/betaBuildLocalizations/loc-9');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.data.attributes.whatsNew, 'new notes');

  const creates = calls.filter((c) => c.method === 'POST' && c.url === '/v1/betaBuildLocalizations');
  assert.equal(creates.length, 0);
});

test('distribute skips What to Test when notes are empty', async () => {
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: false } };
  const { client, calls } = makeClient(baseRoutes({ build }));

  await distribute({
    client,
    config: baseConfig({ internalGroups: [], externalGroups: [] }),
    version: '0.1.0',
    buildNumber: '7',
    notes: '',
    dryRun: false,
    sleep: noopSleep,
    now: () => 0,
    log: () => {},
  });

  const writes = calls.filter(
    (c) => c.method === 'POST' || c.method === 'PATCH',
  ).filter((c) => /betaBuildLocalizations/.test(c.url));
  assert.equal(writes.length, 0);
});

test('dry-run plans beta review submission when export compliance is still missing', async () => {
  const groups = [group('g-ext-1', 'External Testers', false)];
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: false } };
  const { client, calls } = makeClient(
    baseRoutes({ groups, build, externalBuildState: 'MISSING_EXPORT_COMPLIANCE' }),
  );

  const log = [];
  await distribute({
    client,
    config: baseConfig({ internalGroups: [], externalGroups: ['External Testers'] }),
    version: '0.1.0',
    buildNumber: '7',
    notes: '',
    dryRun: true,
    sleep: noopSleep,
    now: () => 0,
    log: (line) => log.push(line),
  });

  assert.ok(calls.every((c) => c.method === 'GET'));
  assert.ok(log.some((line) => /PLAN submit/.test(line)));
});

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function baseDeps(overrides = {}) {
  const env = {
    ASC_KEY_ID: 'kid-1',
    ASC_ISSUER_ID: 'issuer-1',
    ASC_KEY_PATH: '/fake/AuthKey_kid-1.p8',
  };
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const files = {
    '/fake/AuthKey_kid-1.p8': privateKeyPem,
    '/fake/testflight.config.json': JSON.stringify(baseConfig({ internalGroups: ['Internal Testers'] })),
  };

  return {
    env,
    readFile: (p) => {
      if (!(p in files)) throw new Error(`ENOENT: no such file ${p}`);
      return files[p];
    },
    exec: () => '',
    sleep: noopSleep,
    now: () => 0,
    log: () => {},
    error: () => {},
    fetch: async () => {
      throw new Error('fetch should not be called in this test');
    },
    ...overrides,
  };
}

test('main exits non-zero naming a missing group', async () => {
  const routes = baseRoutes({ groups: [] });
  const { fetch } = fakeAsc(routes);
  const errors = [];
  const deps = baseDeps({
    fetch,
    error: (line) => errors.push(line),
    log: () => {},
  });

  const code = await main(
    ['--version', '0.1.0', '--build-number', '7', '--config', '/fake/testflight.config.json'],
    deps,
  );

  assert.equal(code, 1);
  const joined = errors.join('\n');
  assert.match(joined, /Internal Testers/);
  assert.doesNotMatch(joined, PEM_ARMOR_MARKER);
  assert.doesNotMatch(joined, /Bearer/);
});

test('main exits non-zero naming missing ASC env vars', async () => {
  const errors = [];
  const deps = baseDeps({ env: {}, error: (line) => errors.push(line) });

  const code = await main(['--version', '0.1.0', '--build-number', '7', '--config', '/fake/testflight.config.json'], deps);

  assert.equal(code, 1);
  const joined = errors.join('\n');
  assert.match(joined, /ASC_KEY_ID/);
  assert.match(joined, /ASC_ISSUER_ID/);
  assert.match(joined, /ASC_KEY_PATH/);
  assert.doesNotMatch(joined, PEM_ARMOR_MARKER);
  assert.doesNotMatch(joined, /Bearer/);
});

test('main exits non-zero when the build is still processing after the timeout', async () => {
  const routes = baseRoutes({ build: { id: 'build-1', attributes: { version: '7', processingState: 'PROCESSING', usesNonExemptEncryption: null } } });
  const { fetch } = fakeAsc(routes);
  const errors = [];

  let now = 0;
  const deps = baseDeps({
    fetch,
    error: (line) => errors.push(line),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  const configWithShortTimeout = JSON.stringify(baseConfig({ processingTimeoutSeconds: 60, pollIntervalSeconds: 30 }));
  deps.readFile = (p) => {
    if (p === '/fake/testflight.config.json') return configWithShortTimeout;
    if (p === '/fake/AuthKey_kid-1.p8') return baseDeps().readFile('/fake/AuthKey_kid-1.p8');
    throw new Error(`ENOENT: no such file ${p}`);
  };

  const code = await main(
    ['--version', '0.1.0', '--build-number', '7', '--config', '/fake/testflight.config.json'],
    deps,
  );

  assert.equal(code, 1);
  const joined = errors.join('\n');
  assert.match(joined, /still processing/);
  assert.match(joined, /0\.1\.0/);
  assert.doesNotMatch(joined, /Bearer/);
});

test('main exits non-zero naming missing beta review contact details', async () => {
  const routes = baseRoutes({
    groups: [group('g-ext-1', 'External Testers', false)],
    contactDetails: { contactEmail: '', contactPhone: '555', contactFirstName: 'Pat', contactLastName: '' },
  });
  const { fetch } = fakeAsc(routes);
  const errors = [];
  const deps = baseDeps({ fetch, error: (line) => errors.push(line) });

  const configText = JSON.stringify(baseConfig({ internalGroups: [], externalGroups: ['External Testers'] }));
  deps.readFile = (p) => {
    if (p === '/fake/testflight.config.json') return configText;
    if (p === '/fake/AuthKey_kid-1.p8') return baseDeps().readFile('/fake/AuthKey_kid-1.p8');
    throw new Error(`ENOENT: no such file ${p}`);
  };

  const code = await main(
    ['--version', '0.1.0', '--build-number', '7', '--config', '/fake/testflight.config.json'],
    deps,
  );

  assert.equal(code, 1);
  const joined = errors.join('\n');
  assert.match(joined, /contactEmail/);
  assert.match(joined, /contactLastName/);
  assert.doesNotMatch(joined, /Bearer/);
});

test('main --print-next-build-number prints N+1 from ASC', async () => {
  const routes = baseRoutes({ build: { id: 'build-1', attributes: { version: '9', processingState: 'VALID', usesNonExemptEncryption: false } } });
  const { fetch } = fakeAsc(routes);
  const logs = [];
  const deps = baseDeps({ fetch, log: (line) => logs.push(line) });

  const code = await main(
    ['--print-next-build-number', '--version', '0.1.0', '--config', '/fake/testflight.config.json'],
    deps,
  );

  assert.equal(code, 0);
  assert.deepEqual(logs, ['10']);
});

test('main --print-next-build-number prints the override without network', async () => {
  const deps = baseDeps({
    fetch: async () => {
      throw new Error('must not call the network when --build-number is given');
    },
    log: (line) => logs.push(line),
  });
  const logs = [];
  deps.log = (line) => logs.push(line);

  const code = await main(
    [
      '--print-next-build-number',
      '--version',
      '0.1.0',
      '--build-number',
      '42',
      '--config',
      '/fake/testflight.config.json',
    ],
    deps,
  );

  assert.equal(code, 0);
  assert.deepEqual(logs, ['42']);
});

test('main exits non-zero when --version is missing', async () => {
  const errors = [];
  const deps = baseDeps({ error: (line) => errors.push(line) });

  const code = await main(['--build-number', '7', '--config', '/fake/testflight.config.json'], deps);

  assert.equal(code, 1);
  assert.match(errors.join('\n'), /--version is required/);
});

test('main exits non-zero when --build-number is missing', async () => {
  const errors = [];
  const deps = baseDeps({ error: (line) => errors.push(line) });

  const code = await main(['--version', '0.1.0', '--config', '/fake/testflight.config.json'], deps);

  assert.equal(code, 1);
  assert.match(errors.join('\n'), /--build-number is required/);
});

function noGroupsConfigDeps(overrides) {
  const deps = baseDeps(overrides);
  const noGroupsConfig = JSON.stringify(baseConfig({ internalGroups: [], externalGroups: [] }));
  const originalReadFile = deps.readFile;
  deps.readFile = (p) => (p === '/fake/testflight.config.json' ? noGroupsConfig : originalReadFile(p));
  return deps;
}

test('main resolves notes from git log since the last tag when --notes is omitted', async () => {
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: false } };
  const routes = baseRoutes({ build, groups: [] });
  const { fetch, calls } = fakeAsc(routes);

  const errors = [];
  const execCalls = [];
  const deps = noGroupsConfigDeps({
    fetch,
    error: (line) => errors.push(line),
    exec: (cmd, args) => {
      execCalls.push(args);
      if (args[0] === 'describe') return 'v0.3.0\n';
      return '- did a thing\n- did another thing\n';
    },
  });

  const code = await main(['--version', '0.1.0', '--build-number', '7', '--config', '/fake/testflight.config.json'], deps);

  assert.equal(code, 0, errors.join('\n'));
  const localizationCreate = calls.find((c) => c.method === 'POST' && c.url === '/v1/betaBuildLocalizations');
  assert.ok(localizationCreate);
  assert.match(localizationCreate.body.data.attributes.whatsNew, /did a thing/);
  assert.ok(execCalls.some((args) => args[0] === 'describe'));
});

test('main falls back to empty notes when git has no tags', async () => {
  const build = { id: 'build-1', attributes: { version: '7', processingState: 'VALID', usesNonExemptEncryption: false } };
  const routes = baseRoutes({ build, groups: [] });
  const { fetch, calls } = fakeAsc(routes);

  const errors = [];
  const deps = noGroupsConfigDeps({
    fetch,
    error: (line) => errors.push(line),
    exec: () => {
      throw new Error('git: no tags found');
    },
  });

  const code = await main(['--version', '0.1.0', '--build-number', '7', '--config', '/fake/testflight.config.json'], deps);

  assert.equal(code, 0, errors.join('\n'));
  const localizationCreate = calls.find((c) => c.method === 'POST' && c.url === '/v1/betaBuildLocalizations');
  assert.equal(localizationCreate, undefined);
});

// ---------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------

test('.gitignore ignores *.p8 and AuthKey_*', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = fileURLToPath(new URL('../../../.gitignore', import.meta.url));
  const gitignore = await readFile(repoRoot, 'utf8');
  assert.match(gitignore, /^\*\.p8$/m);
  assert.match(gitignore, /^AuthKey_\*$/m);
});
