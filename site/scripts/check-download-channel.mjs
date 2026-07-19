// Health-check the download channel (#502): fetch the stable latest.json
// manifest that the site's /download Worker route resolves at request time,
// and validate it against the same contract as src/lib/latest-manifest.ts.
// CI fails here if the manifest endpoint is unavailable or malformed, so a
// broken release publish is caught before it silently breaks the site's CTAs.

const MANIFEST_URL = 'https://github.com/on-par/sound-buddy-releases/releases/latest/download/latest.json';
const TIMEOUT_MS = 30_000;

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const HTTPS_PREFIX = 'https://';

const HELP = 'the site\'s /download CTA resolves from this manifest; check that scripts/release.sh published latest.json to on-par/sound-buddy-releases, or GitHub availability';

function fail(message) {
  console.error(`✖ download-channel: ${message} — ${HELP}`);
  process.exit(1);
}

let response;
try {
  response = await fetch(MANIFEST_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
} catch (err) {
  fail(`could not reach ${MANIFEST_URL} (${err.message})`);
}

if (!response.ok) {
  fail(`${MANIFEST_URL} returned HTTP ${response.status}`);
}

let data;
try {
  data = await response.json();
} catch (err) {
  fail(`${MANIFEST_URL} did not return valid JSON (${err.message})`);
}

const problems = [];

if (typeof data !== 'object' || data === null || Array.isArray(data)) {
  fail('manifest must be a JSON object');
}

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
if (typeof artifactSizeBytes !== 'number' || !Number.isInteger(artifactSizeBytes) || artifactSizeBytes <= 0) {
  problems.push('artifactSizeBytes must be a positive integer');
}
if (typeof publishedAt !== 'string' || Number.isNaN(new Date(publishedAt).getTime())) {
  problems.push('publishedAt must be a parseable ISO 8601 date string');
}

if (problems.length) {
  fail(`manifest failed validation: ${problems.join('; ')}`);
}

console.log(`✓ download channel healthy: v${version} at ${artifactUrl}`);
