import { describe, it, expect } from 'vitest';
import {
  LATEST_MANIFEST_URL,
  GITHUB_RELEASES_PAGE_URL,
  validateLatestManifest,
  resolveDownloadRedirect,
} from './latest-manifest';

const validManifest = {
  schemaVersion: 1,
  version: '1.4.2',
  channel: 'stable',
  notesSummary: 'Bug fixes and performance improvements.',
  releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v1.4.2',
  artifactUrl: 'https://github.com/on-par/sound-buddy-releases/releases/download/v1.4.2/Sound.Buddy-1.4.2-arm64-mac.zip',
  artifactSizeBytes: 123456789,
  sha256: 'a'.repeat(64),
  publishedAt: '2026-07-01T12:00:00Z',
};

describe('validateLatestManifest', () => {
  it('returns no problems for a valid manifest', () => {
    expect(validateLatestManifest(validManifest)).toEqual([]);
  });

  it('ignores unknown extra fields (backwards-compat)', () => {
    expect(validateLatestManifest({ ...validManifest, futureField: 'whatever' })).toEqual([]);
  });

  it('flags null as not a plain object', () => {
    expect(validateLatestManifest(null)).toEqual(['manifest must be a JSON object']);
  });

  it('flags a non-object (array) as not a plain object', () => {
    expect(validateLatestManifest([1, 2, 3])).toEqual(['manifest must be a JSON object']);
  });

  it('flags a non-object (string) as not a plain object', () => {
    expect(validateLatestManifest('nope')).toEqual(['manifest must be a JSON object']);
  });

  it('flags a missing schemaVersion', () => {
    const { schemaVersion, ...rest } = validManifest;
    expect(validateLatestManifest(rest)).toEqual([
      'schemaVersion must be an integer >= 1',
    ]);
  });

  it('flags a schemaVersion of the wrong type', () => {
    expect(validateLatestManifest({ ...validManifest, schemaVersion: '1' })).toEqual([
      'schemaVersion must be an integer >= 1',
    ]);
  });

  it('flags a schemaVersion below 1', () => {
    expect(validateLatestManifest({ ...validManifest, schemaVersion: 0 })).toEqual([
      'schemaVersion must be an integer >= 1',
    ]);
  });

  it('flags a missing version', () => {
    const { version, ...rest } = validManifest;
    expect(validateLatestManifest(rest)).toEqual([
      'version must be a semver string like "1.4.2" (no leading "v")',
    ]);
  });

  it('flags a version with a leading "v"', () => {
    expect(validateLatestManifest({ ...validManifest, version: 'v1.4.2' })).toEqual([
      'version must be a semver string like "1.4.2" (no leading "v")',
    ]);
  });

  it('flags a version missing a patch segment', () => {
    expect(validateLatestManifest({ ...validManifest, version: '1.4' })).toEqual([
      'version must be a semver string like "1.4.2" (no leading "v")',
    ]);
  });

  it('flags a missing artifactUrl', () => {
    const { artifactUrl, ...rest } = validManifest;
    expect(validateLatestManifest(rest)).toEqual([
      'artifactUrl must be an https:// URL to the release zip',
    ]);
  });

  it('flags a non-https artifactUrl', () => {
    expect(
      validateLatestManifest({
        ...validManifest,
        artifactUrl: 'http://github.com/on-par/sound-buddy-releases/releases/download/v1.4.2/x.zip',
      }),
    ).toEqual(['artifactUrl must be an https:// URL to the release zip']);
  });

  it('flags a missing sha256', () => {
    const { sha256, ...rest } = validManifest;
    expect(validateLatestManifest(rest)).toEqual([
      'sha256 must be 64 lowercase hex characters',
    ]);
  });

  it('flags an uppercase sha256', () => {
    expect(validateLatestManifest({ ...validManifest, sha256: 'A'.repeat(64) })).toEqual([
      'sha256 must be 64 lowercase hex characters',
    ]);
  });

  it('flags a too-short sha256', () => {
    expect(validateLatestManifest({ ...validManifest, sha256: 'a'.repeat(63) })).toEqual([
      'sha256 must be 64 lowercase hex characters',
    ]);
  });

  it('flags a missing artifactSizeBytes', () => {
    const { artifactSizeBytes, ...rest } = validManifest;
    expect(validateLatestManifest(rest)).toEqual([
      'artifactSizeBytes must be a positive integer',
    ]);
  });

  it('flags a zero artifactSizeBytes', () => {
    expect(validateLatestManifest({ ...validManifest, artifactSizeBytes: 0 })).toEqual([
      'artifactSizeBytes must be a positive integer',
    ]);
  });

  it('flags a negative artifactSizeBytes', () => {
    expect(validateLatestManifest({ ...validManifest, artifactSizeBytes: -5 })).toEqual([
      'artifactSizeBytes must be a positive integer',
    ]);
  });

  it('flags a float artifactSizeBytes', () => {
    expect(validateLatestManifest({ ...validManifest, artifactSizeBytes: 123.5 })).toEqual([
      'artifactSizeBytes must be a positive integer',
    ]);
  });

  it('flags a missing publishedAt', () => {
    const { publishedAt, ...rest } = validManifest;
    expect(validateLatestManifest(rest)).toEqual([
      'publishedAt must be a parseable ISO 8601 date string',
    ]);
  });

  it('flags an unparseable publishedAt', () => {
    expect(validateLatestManifest({ ...validManifest, publishedAt: 'not-a-date' })).toEqual([
      'publishedAt must be a parseable ISO 8601 date string',
    ]);
  });

  it('reports every violation when multiple fields are invalid', () => {
    expect(
      validateLatestManifest({ ...validManifest, schemaVersion: 0, sha256: 'bad' }),
    ).toEqual([
      'schemaVersion must be an integer >= 1',
      'sha256 must be 64 lowercase hex characters',
    ]);
  });
});

describe('resolveDownloadRedirect', () => {
  it('resolves to the artifactUrl with healthy: true for a valid manifest', () => {
    expect(resolveDownloadRedirect(validManifest)).toEqual({
      location: validManifest.artifactUrl,
      healthy: true,
    });
  });

  it('falls back to the releases page with healthy: false for an invalid manifest', () => {
    expect(resolveDownloadRedirect({ ...validManifest, sha256: 'bad' })).toEqual({
      location: GITHUB_RELEASES_PAGE_URL,
      healthy: false,
    });
  });

  it('falls back to the releases page with healthy: false for null input', () => {
    expect(resolveDownloadRedirect(null)).toEqual({
      location: GITHUB_RELEASES_PAGE_URL,
      healthy: false,
    });
  });

  it('falls back to the releases page with healthy: false for non-object input', () => {
    expect(resolveDownloadRedirect('nope')).toEqual({
      location: GITHUB_RELEASES_PAGE_URL,
      healthy: false,
    });
  });
});

describe('constants', () => {
  it('LATEST_MANIFEST_URL points at the stable releases-latest manifest asset', () => {
    expect(LATEST_MANIFEST_URL).toBe(
      'https://github.com/on-par/sound-buddy-releases/releases/latest/download/latest.json',
    );
  });

  it('GITHUB_RELEASES_PAGE_URL points at the releases page', () => {
    expect(GITHUB_RELEASES_PAGE_URL).toBe(
      'https://github.com/on-par/sound-buddy-releases/releases/latest',
    );
  });
});
