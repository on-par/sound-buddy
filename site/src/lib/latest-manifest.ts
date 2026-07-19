// Pure validation/resolution for the stable release manifest contract shipped
// in #500/#501 (see docs/adr/0002-release-manifest-contract.md). No I/O here —
// callers (the download Worker, the CI health-check script) supply the fetch.

export const LATEST_MANIFEST_URL =
  'https://github.com/on-par/sound-buddy-releases/releases/latest/download/latest.json';

// Runtime fallback only — never a CTA href (#502 requires CTAs route through
// /download, which resolves this manifest at request time).
export const GITHUB_RELEASES_PAGE_URL = 'https://github.com/on-par/sound-buddy-releases/releases/latest';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const HTTPS_PREFIX = 'https://';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates a decoded latest.json payload. Returns actionable problem strings; empty = valid. */
export function validateLatestManifest(data: unknown): string[] {
  if (!isPlainObject(data)) {
    return ['manifest must be a JSON object'];
  }

  const problems: string[] = [];

  const { schemaVersion, version, artifactUrl, sha256, artifactSizeBytes, publishedAt } = data;

  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    problems.push('schemaVersion must be an integer >= 1');
  }

  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    problems.push('version must be a semver string like "1.4.2" (no leading "v")');
  }

  if (typeof artifactUrl !== 'string' || !artifactUrl.startsWith(HTTPS_PREFIX)) {
    problems.push('artifactUrl must be an https:// URL to the release zip');
  }

  if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256)) {
    problems.push('sha256 must be 64 lowercase hex characters');
  }

  if (
    typeof artifactSizeBytes !== 'number' ||
    !Number.isInteger(artifactSizeBytes) ||
    artifactSizeBytes <= 0
  ) {
    problems.push('artifactSizeBytes must be a positive integer');
  }

  if (typeof publishedAt !== 'string' || Number.isNaN(new Date(publishedAt).getTime())) {
    problems.push('publishedAt must be a parseable ISO 8601 date string');
  }

  return problems;
}

/** Resolves where /download should redirect to, degrading to the releases page on any validation failure. */
export function resolveDownloadRedirect(data: unknown): { location: string; healthy: boolean } {
  if (validateLatestManifest(data).length === 0) {
    return { location: (data as { artifactUrl: string }).artifactUrl, healthy: true };
  }
  return { location: GITHUB_RELEASES_PAGE_URL, healthy: false };
}
