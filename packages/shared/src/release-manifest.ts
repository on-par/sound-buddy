// Machine-readable "latest release" manifest contract (#500). The app,
// website, and release tooling agree on the latest customer-downloadable
// build via this JSON shape instead of scraping the GitHub releases UI/HTML.

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
export const RELEASE_CHANNEL_LATEST = 'latest';
export const RELEASE_MANIFEST_FILENAME = 'latest.json';
export const RELEASES_REPO = 'on-par/sound-buddy-releases';
export const RELEASE_MANIFEST_URL = `https://github.com/${RELEASES_REPO}/releases/latest/download/${RELEASE_MANIFEST_FILENAME}`;

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
export const NOTES_SUMMARY_MAX_CHARS = 280;

export interface ReleaseManifest {
  schemaVersion: number;
  version: string;
  channel: string;
  notesSummary: string;
  releaseUrl: string;
  artifactUrl: string;
  artifactSizeBytes: number;
  sha256: string;
  publishedAt: string;
}

export type ReleaseManifestValidation =
  | { ok: true; manifest: ReleaseManifest }
  | { ok: false; errors: string[] };

const REGENERATE_HINT = 'regenerate it with scripts/release.sh';

export function summarizeReleaseNotes(notes: string): string {
  const stripped = notes
    .split('\n')
    .map((line) => line.replace(/^\s*#+\s*/, '').replace(/^\s*[-*]\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length <= NOTES_SUMMARY_MAX_CHARS) return stripped;
  return `${stripped.slice(0, NOTES_SUMMARY_MAX_CHARS - 1)}…`;
}

export function validateReleaseManifest(value: unknown): ReleaseManifestValidation {
  const errors: string[] = [];

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['manifest must be a JSON object — regenerate it with scripts/release.sh'] };
  }

  const v = value as Record<string, unknown>;
  const requireField = (name: string): boolean => {
    if (!(name in v) || v[name] === undefined) {
      errors.push(`missing required field "${name}" — ${REGENERATE_HINT}`);
      return false;
    }
    return true;
  };

  if (requireField('schemaVersion')) {
    const schemaVersion = v.schemaVersion;
    if (!(typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion >= 1)) {
      errors.push(`schemaVersion must be an integer >= 1, got ${JSON.stringify(schemaVersion)}`);
    }
  }

  if (requireField('version')) {
    const version = v.version;
    if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
      errors.push(
        `version must be MAJOR.MINOR.PATCH without a leading "v" (e.g. "0.4.2"), got ${JSON.stringify(version)}`,
      );
    }
  }

  if (requireField('channel')) {
    const channel = v.channel;
    if (typeof channel !== 'string' || channel.length === 0) {
      errors.push(`channel must be a non-empty string, got ${JSON.stringify(channel)}`);
    }
  }

  if (requireField('notesSummary')) {
    const notesSummary = v.notesSummary;
    if (typeof notesSummary !== 'string') {
      errors.push(`notesSummary must be a string, got ${JSON.stringify(notesSummary)}`);
    }
  }

  for (const field of ['releaseUrl', 'artifactUrl'] as const) {
    if (requireField(field)) {
      const url = v[field];
      if (typeof url !== 'string' || !url.startsWith('https://')) {
        errors.push(`${field} must be an https:// URL, got ${JSON.stringify(url)}`);
      }
    }
  }

  if (requireField('artifactSizeBytes')) {
    const artifactSizeBytes = v.artifactSizeBytes;
    if (!(typeof artifactSizeBytes === 'number' && Number.isInteger(artifactSizeBytes) && artifactSizeBytes > 0)) {
      errors.push(`artifactSizeBytes must be a positive integer, got ${JSON.stringify(artifactSizeBytes)}`);
    }
  }

  if (requireField('sha256')) {
    const sha256 = v.sha256;
    if (typeof sha256 !== 'string' || !SHA256_HEX_PATTERN.test(sha256)) {
      errors.push('sha256 must be 64 lowercase hex characters — compute it with: shasum -a 256 <zip>');
    }
  }

  if (requireField('publishedAt')) {
    const publishedAt = v.publishedAt;
    if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) {
      errors.push(
        `publishedAt must be an ISO 8601 UTC timestamp (e.g. "2026-07-18T12:00:00Z"), got ${JSON.stringify(publishedAt)}`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const manifest: ReleaseManifest = {
    schemaVersion: v.schemaVersion as number,
    version: v.version as string,
    channel: v.channel as string,
    notesSummary: v.notesSummary as string,
    releaseUrl: v.releaseUrl as string,
    artifactUrl: v.artifactUrl as string,
    artifactSizeBytes: v.artifactSizeBytes as number,
    sha256: v.sha256 as string,
    publishedAt: v.publishedAt as string,
  };

  return { ok: true, manifest };
}

export function parseReleaseManifest(json: string): ReleaseManifestValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    /* c8 ignore next -- JSON.parse always throws a SyntaxError (an Error instance); the fallback is unreachable */
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`manifest is not valid JSON (${message}) — ${REGENERATE_HINT}`] };
  }
  return validateReleaseManifest(parsed);
}

export interface BuildReleaseManifestInput {
  version: string;
  notes: string;
  releaseUrl: string;
  artifactUrl: string;
  artifactSizeBytes: number;
  sha256: string;
  publishedAt: string;
  channel?: string;
}

export function buildReleaseManifest(input: BuildReleaseManifestInput): ReleaseManifest {
  const candidate = {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    version: input.version,
    channel: input.channel ?? RELEASE_CHANNEL_LATEST,
    notesSummary: summarizeReleaseNotes(input.notes),
    releaseUrl: input.releaseUrl,
    artifactUrl: input.artifactUrl,
    artifactSizeBytes: input.artifactSizeBytes,
    sha256: input.sha256,
    publishedAt: input.publishedAt,
  };

  const result = validateReleaseManifest(candidate);
  if (!result.ok) {
    throw new Error(`cannot build release manifest: ${result.errors.join('; ')}`);
  }
  return result.manifest;
}
