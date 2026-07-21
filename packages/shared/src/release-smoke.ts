// End-to-end release channel smoke check (#505): proves a freshly cut release
// is reachable through every layer shipped in #500-#504 — the latest.json
// manifest, the artifact it points at, the site's /download redirect, and
// latest.json's contract (still published on every release for the website
// and any pre-#625 installed build, even though the app itself moved update
// discovery to electron-updater's latest-mac.yml feed — see
// docs/adr/0002-release-manifest-contract.md's "Update discovery migration"
// section). packages/shared (MIT) can't import from app/ (proprietary), so
// the app-update rules below are a self-contained duplicate of that
// validation, not an import of it.

import {
  validateReleaseManifest,
  verifyUploadedArtifactChecksum,
  RELEASE_MANIFEST_URL,
  RELEASES_REPO,
  SEMVER_PATTERN,
  SHA256_HEX_PATTERN,
  type ReleaseManifest,
} from './release-manifest.js';

export const SMOKE_LAYERS = ['manifest', 'artifact', 'site-route', 'app-update'] as const;
export type SmokeLayer = (typeof SMOKE_LAYERS)[number];

export const SITE_DOWNLOAD_URL = 'https://soundbuddy.online/download'; // site per site/astro.config.mjs; route per site/src/download-worker.ts
export const DEFAULT_BASELINE_APP_VERSION = '0.0.0'; // simulated "installed" version older than any release

const RELEASES_PAGE_FALLBACK_URL = `https://github.com/${RELEASES_REPO}/releases/latest`;
const HTTPS_PREFIX = 'https://';

export interface SmokeCheckResult {
  layer: SmokeLayer;
  ok: boolean;
  detail: string;
}

export interface ReleaseSmokeReport {
  ok: boolean;
  results: SmokeCheckResult[];
  version: string | null;
}

function isHttpOk(status: number): boolean {
  return status >= 200 && status < 300;
}

export function checkManifestLayer(
  tag: string,
  status: number,
  body: unknown,
): { result: SmokeCheckResult; manifest: ReleaseManifest | null } {
  const fail = (detail: string): { result: SmokeCheckResult; manifest: ReleaseManifest | null } => ({
    result: { layer: 'manifest', ok: false, detail },
    manifest: null,
  });

  if (!isHttpOk(status)) {
    return fail(
      `${RELEASE_MANIFEST_URL} returned HTTP ${status} — check that scripts/release.sh published latest.json to ${RELEASES_REPO}`,
    );
  }

  const validation = validateReleaseManifest(body);
  if (!validation.ok) {
    return fail(validation.errors.join('; '));
  }
  const manifest = validation.manifest;

  const expectedTag = `v${manifest.version}`;
  if (expectedTag !== tag) {
    return fail(
      `manifest reports ${expectedTag} but the tag under test is ${tag} — the releases/latest alias likely still points at the previous release`,
    );
  }

  if (!manifest.artifactUrl.includes(`/releases/download/${tag}/`)) {
    return fail(`artifactUrl ${manifest.artifactUrl} is not under the tag ${tag}`);
  }

  if (!manifest.releaseUrl.endsWith(`/releases/tag/${tag}`)) {
    return fail(`releaseUrl ${manifest.releaseUrl} does not end with /releases/tag/${tag}`);
  }

  if (manifest.notesSummary.trim().length === 0) {
    return fail('notesSummary is empty — the release notes were not generated, re-run scripts/release.sh');
  }

  return {
    result: { layer: 'manifest', ok: true, detail: `latest.json reports v${manifest.version} for ${tag}` },
    manifest,
  };
}

export function checkArtifactLayer(
  manifest: ReleaseManifest,
  head: { status: number; contentLengthBytes: number | null },
  uploadedDigest: string,
): SmokeCheckResult {
  if (!isHttpOk(head.status)) {
    return {
      layer: 'artifact',
      ok: false,
      detail: `artifact URL returned HTTP ${head.status} — check the release asset exists on the tag`,
    };
  }

  let sizeSkippedDetail = '';
  if (head.contentLengthBytes !== null) {
    if (head.contentLengthBytes !== manifest.artifactSizeBytes) {
      return {
        layer: 'artifact',
        ok: false,
        detail: `size mismatch: manifest says ${manifest.artifactSizeBytes} bytes but the artifact response reports ${head.contentLengthBytes} — the upload may be truncated/stale`,
      };
    }
  } else {
    sizeSkippedDetail = ' (size check skipped — response had no content-length)';
  }

  const checksum = verifyUploadedArtifactChecksum(manifest.sha256, uploadedDigest);
  if (!checksum.ok) {
    return { layer: 'artifact', ok: false, detail: checksum.error };
  }

  return {
    layer: 'artifact',
    ok: true,
    detail: `artifact downloadable and checksum matches manifest${sizeSkippedDetail}`,
  };
}

export function checkSiteRouteLayer(
  manifest: ReleaseManifest,
  redirect: { status: number; location: string | null },
): SmokeCheckResult {
  if (redirect.status < 300 || redirect.status >= 400) {
    return {
      layer: 'site-route',
      ok: false,
      detail: `${SITE_DOWNLOAD_URL} returned HTTP ${redirect.status}, expected a 3xx redirect`,
    };
  }

  if (redirect.location === null) {
    return {
      layer: 'site-route',
      ok: false,
      detail: `${SITE_DOWNLOAD_URL} redirected with no Location header`,
    };
  }

  if (redirect.location === RELEASES_PAGE_FALLBACK_URL) {
    return {
      layer: 'site-route',
      ok: false,
      detail:
        '/download degraded to the releases page fallback — the Worker could not fetch/validate latest.json',
    };
  }

  if (redirect.location !== manifest.artifactUrl) {
    return {
      layer: 'site-route',
      ok: false,
      detail: `/download points at ${redirect.location} but the manifest says ${manifest.artifactUrl}`,
    };
  }

  return { layer: 'site-route', ok: true, detail: `/download redirects to ${manifest.artifactUrl}` };
}

// Duplicates the version-comparison the app used to do in app/electron/updater.ts
// before #625 (electron-updater now does this comparison internally).
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Duplicates the validation the app used to do in
// app/electron/update-manifest.ts#parseUpdateManifest before #625 (deleted;
// superseded by electron-updater's own latest-mac.yml validation). Kept here
// so this smoke check still proves latest.json's shape for its other
// consumers (the website, any pre-#625 installed build).
function checkAppUpdateContract(data: unknown): string[] {
  if (!isPlainObject(data)) {
    return ['manifest must be a JSON object'];
  }

  const problems: string[] = [];
  const { schemaVersion, version, notesSummary, releaseUrl, artifactUrl, sha256, artifactSizeBytes } = data;

  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    problems.push('schemaVersion must be an integer >= 1');
  }
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    problems.push('version must be a semver string like "1.4.2" (no leading "v")');
  }
  if (typeof notesSummary !== 'string') {
    problems.push('notesSummary must be a string');
  }
  if (typeof releaseUrl !== 'string' || !releaseUrl.startsWith(HTTPS_PREFIX)) {
    problems.push('releaseUrl must be an https:// URL');
  }
  if (typeof artifactUrl !== 'string' || !artifactUrl.startsWith(HTTPS_PREFIX)) {
    problems.push('artifactUrl must be an https:// URL');
  }
  if (typeof sha256 !== 'string' || !SHA256_HEX_PATTERN.test(sha256)) {
    problems.push('sha256 must be 64 lowercase hex characters');
  }
  if (
    typeof artifactSizeBytes !== 'number' ||
    !Number.isInteger(artifactSizeBytes) ||
    artifactSizeBytes <= 0
  ) {
    problems.push('artifactSizeBytes must be a positive integer');
  }

  return problems;
}

export function checkAppUpdateLayer(
  body: unknown,
  manifest: ReleaseManifest,
  currentVersion: string,
): SmokeCheckResult {
  const problems = checkAppUpdateContract(body);
  if (problems.length > 0) {
    return {
      layer: 'app-update',
      ok: false,
      detail: `the app's update parser would reject this manifest: ${problems.join('; ')}`,
    };
  }

  const raw = body as Record<string, unknown>;
  const payload = {
    version: raw.version as string,
    url: raw.releaseUrl as string,
    notes: raw.notesSummary as string,
    downloadUrl: raw.artifactUrl as string,
    sha256: raw.sha256 as string,
    sizeBytes: raw.artifactSizeBytes as number,
  };

  const fieldChecks: Array<[string, unknown, unknown]> = [
    ['version', payload.version, manifest.version],
    ['releaseUrl', payload.url, manifest.releaseUrl],
    ['notesSummary', payload.notes, manifest.notesSummary],
    ['artifactUrl', payload.downloadUrl, manifest.artifactUrl],
    ['sha256', payload.sha256, manifest.sha256],
    ['artifactSizeBytes', payload.sizeBytes, manifest.artifactSizeBytes],
  ];
  for (const [field, actual, expected] of fieldChecks) {
    if (actual !== expected) {
      return {
        layer: 'app-update',
        ok: false,
        detail: `app-facing payload field "${field}" (${JSON.stringify(actual)}) does not match the manifest (${JSON.stringify(expected)})`,
      };
    }
  }

  if (!isNewerVersion(manifest.version, currentVersion)) {
    return {
      layer: 'app-update',
      ok: false,
      detail: `an app on ${currentVersion} would NOT be offered ${manifest.version}`,
    };
  }

  return {
    layer: 'app-update',
    ok: true,
    detail: `an app on ${currentVersion} would be offered v${manifest.version}`,
  };
}

export interface ReleaseSmokeFetchers {
  fetchManifest(): Promise<{ status: number; body: unknown }>;
  fetchArtifactHead(artifactUrl: string): Promise<{ status: number; contentLengthBytes: number | null }>;
  fetchArtifactDigest(tag: string, assetName: string): Promise<string>;
  fetchDownloadRedirect(): Promise<{ status: number; location: string | null }>;
}

function skippedResult(layer: SmokeLayer): SmokeCheckResult {
  return { layer, ok: false, detail: 'skipped — manifest layer failed' };
}

async function runLayer(
  layer: SmokeLayer,
  what: string,
  run: () => Promise<SmokeCheckResult>,
): Promise<SmokeCheckResult> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      layer,
      ok: false,
      detail: `could not reach ${what} (${message}) — check network/GitHub availability`,
    };
  }
}

export async function runReleaseSmoke(
  opts: { tag: string; currentVersion?: string },
  fetchers: ReleaseSmokeFetchers,
): Promise<ReleaseSmokeReport> {
  const currentVersion = opts.currentVersion ?? DEFAULT_BASELINE_APP_VERSION;

  let manifestBody: unknown = null;
  let manifestOrNull: ReleaseManifest | null = null;
  const manifestOutcome = await runLayer('manifest', RELEASE_MANIFEST_URL, async () => {
    const { status, body } = await fetchers.fetchManifest();
    manifestBody = body;
    const checked = checkManifestLayer(opts.tag, status, body);
    manifestOrNull = checked.manifest;
    return checked.result;
  });

  if (!manifestOutcome.ok || !manifestOrNull) {
    return {
      ok: false,
      version: null,
      results: [
        manifestOutcome,
        skippedResult('artifact'),
        skippedResult('site-route'),
        skippedResult('app-update'),
      ],
    };
  }
  const manifest: ReleaseManifest = manifestOrNull;

  // String.split always returns a non-empty array, so pop() is never
  // undefined here — the fallback only guards the type, not a real branch.
  /* c8 ignore next */
  const assetName = decodeURIComponent(manifest.artifactUrl.split('/').pop() ?? '');

  const artifactResult = await runLayer('artifact', 'the artifact URL', async () => {
    const head = await fetchers.fetchArtifactHead(manifest.artifactUrl);
    const digest = await fetchers.fetchArtifactDigest(opts.tag, assetName);
    return checkArtifactLayer(manifest, head, digest);
  });

  const siteRouteResult = await runLayer('site-route', SITE_DOWNLOAD_URL, async () => {
    const redirect = await fetchers.fetchDownloadRedirect();
    return checkSiteRouteLayer(manifest, redirect);
  });

  const appUpdateResult = await runLayer('app-update', RELEASE_MANIFEST_URL, async () => {
    return checkAppUpdateLayer(manifestBody, manifest, currentVersion);
  });

  const results = [manifestOutcome, artifactResult, siteRouteResult, appUpdateResult];
  return { ok: results.every((r) => r.ok), version: manifest.version, results };
}

export function formatSmokeReport(report: ReleaseSmokeReport): string {
  const lines = report.results.map((r) => `${r.ok ? '✓' : '✖'} ${r.layer}: ${r.detail}`);
  if (report.ok) {
    lines.push(`RELEASE SMOKE PASSED for v${report.version}`);
  } else {
    const brokenLayers = report.results.filter((r) => !r.ok).map((r) => r.layer);
    lines.push(`RELEASE SMOKE FAILED — broken layer(s): ${brokenLayers.join(', ')}`);
  }
  return lines.join('\n');
}
