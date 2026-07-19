// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure validation for the stable release manifest contract (#500/#501, see
// docs/adr/0002-release-manifest-contract.md). No I/O here — the caller
// (updater.ts) supplies the fetch. The app ships zero node_modules, so this
// mirrors site/src/lib/latest-manifest.ts rather than importing
// @sound-buddy/shared.

export const LATEST_MANIFEST_URL =
  'https://github.com/on-par/sound-buddy-releases/releases/latest/download/latest.json';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const HTTPS_PREFIX = 'https://';
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** The subset of the latest.json contract (#500) that update discovery consumes. */
export interface UpdateManifest {
  version: string;
  notesSummary: string;
  releaseUrl: string;
  artifactUrl: string;
  sha256: string;
  artifactSizeBytes: number;
}

export type UpdateManifestResult =
  | { ok: true; manifest: UpdateManifest }
  | { ok: false; problems: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates and narrows a decoded latest.json payload. Unknown fields are ignored (forward-compatible per the ADR). */
export function parseUpdateManifest(data: unknown): UpdateManifestResult {
  if (!isPlainObject(data)) {
    return { ok: false, problems: ['manifest must be a JSON object — try Check for Updates again later'] };
  }

  const problems: string[] = [];
  const { schemaVersion, version, notesSummary, releaseUrl, artifactUrl, sha256, artifactSizeBytes } = data;

  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    problems.push('schemaVersion must be an integer >= 1');
  }

  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    problems.push('version must be a semver string like "1.4.2" (no leading "v")');
  }

  if (typeof notesSummary !== 'string') {
    problems.push('notesSummary must be a string');
  }

  if (typeof releaseUrl !== 'string' || !releaseUrl.startsWith(HTTPS_PREFIX)) {
    problems.push('releaseUrl must be an https:// URL to the release page');
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

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    manifest: {
      version: version as string,
      notesSummary: notesSummary as string,
      releaseUrl: releaseUrl as string,
      artifactUrl: artifactUrl as string,
      sha256: sha256 as string,
      artifactSizeBytes: artifactSizeBytes as number,
    },
  };
}
