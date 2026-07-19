import { describe, expect, it } from 'vitest';
import {
  buildReleaseManifest,
  buildReleaseManifestPreview,
  parseReleaseManifest,
  summarizeReleaseNotes,
  validateReleaseManifest,
  verifyUploadedArtifactChecksum,
  NOTES_SUMMARY_MAX_CHARS,
  DRY_RUN_MEASURED_PLACEHOLDER,
  RELEASE_MANIFEST_SCHEMA_VERSION,
} from './release-manifest.js';

const FIXTURE: Record<string, unknown> = {
  schemaVersion: 1,
  version: '0.4.2',
  channel: 'latest',
  notesSummary: 'Adds virtual soundcheck playback.',
  releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v0.4.2',
  artifactUrl:
    'https://github.com/on-par/sound-buddy-releases/releases/download/v0.4.2/Sound.Buddy-0.4.2-arm64-mac.zip',
  artifactSizeBytes: 123456789,
  sha256: 'a'.repeat(64),
  publishedAt: '2026-07-18T12:00:00Z',
};

const REQUIRED_FIELDS = [
  'schemaVersion',
  'version',
  'channel',
  'notesSummary',
  'releaseUrl',
  'artifactUrl',
  'artifactSizeBytes',
  'sha256',
  'publishedAt',
];

describe('validateReleaseManifest', () => {
  it('accepts the canonical fixture and freezes the nine-key contract', () => {
    const result = validateReleaseManifest(FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(Object.keys(result.manifest).sort()).toEqual([...REQUIRED_FIELDS].sort());
  });

  it('returns all required fields with the fixture values', () => {
    const result = validateReleaseManifest(FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.manifest.version).toBe('0.4.2');
    expect(result.manifest.channel).toBe('latest');
    expect(result.manifest.notesSummary).toBe('Adds virtual soundcheck playback.');
    expect(result.manifest.releaseUrl).toBe(FIXTURE.releaseUrl);
    expect(result.manifest.artifactUrl).toBe(FIXTURE.artifactUrl);
    expect(result.manifest.artifactSizeBytes).toBe(123456789);
    expect(result.manifest.sha256).toBe('a'.repeat(64));
    expect(result.manifest.publishedAt).toBe('2026-07-18T12:00:00Z');
  });

  it('ignores unknown extra fields for forward/backwards compat', () => {
    const result = validateReleaseManifest({ ...FIXTURE, futureField: 'x', schemaVersion: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.manifest).not.toHaveProperty('futureField');
    expect(Object.keys(result.manifest).sort()).toEqual([...REQUIRED_FIELDS].sort());
  });

  it.each(REQUIRED_FIELDS)('flags a missing required field "%s"', (field) => {
    const copy = { ...FIXTURE };
    delete copy[field];
    const result = validateReleaseManifest(copy);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes(field))).toBe(true);
  });

  it.each([
    ['uppercase hex', 'A'.repeat(64)],
    ['63 chars', 'a'.repeat(63)],
    ['non-hex', 'z'.repeat(64)],
  ])('rejects an invalid sha256 (%s)', (_label, badSha) => {
    const result = validateReleaseManifest({ ...FIXTURE, sha256: badSha });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('shasum -a 256'))).toBe(true);
  });

  it('rejects a version with a leading "v"', () => {
    const result = validateReleaseManifest({ ...FIXTURE, version: 'v0.4.2' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('rejects an incomplete semver (missing patch)', () => {
    const result = validateReleaseManifest({ ...FIXTURE, version: '0.4' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it.each(['releaseUrl', 'artifactUrl'])('rejects a non-https %s', (field) => {
    const result = validateReleaseManifest({ ...FIXTURE, [field]: 'http://example.com/x' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes(field) && e.includes('https://'))).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['non-integer', 1.5],
  ])('rejects an invalid artifactSizeBytes (%s)', (_label, size) => {
    const result = validateReleaseManifest({ ...FIXTURE, artifactSizeBytes: size });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('artifactSizeBytes'))).toBe(true);
  });

  it('rejects an unparseable publishedAt', () => {
    const result = validateReleaseManifest({ ...FIXTURE, publishedAt: 'not-a-date' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('publishedAt') && e.includes('ISO 8601'))).toBe(true);
  });

  it('rejects a non-string notesSummary', () => {
    const result = validateReleaseManifest({ ...FIXTURE, notesSummary: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('notesSummary'))).toBe(true);
  });

  it('rejects an empty-string channel', () => {
    const result = validateReleaseManifest({ ...FIXTURE, channel: '' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('channel'))).toBe(true);
  });

  it('rejects schemaVersion 0', () => {
    const result = validateReleaseManifest({ ...FIXTURE, schemaVersion: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'str'],
  ])('rejects non-object input (%s)', (_label, value) => {
    const result = validateReleaseManifest(value);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('JSON object'))).toBe(true);
  });

  it('accumulates one error per missing field for an empty object', () => {
    const result = validateReleaseManifest({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.length).toBeGreaterThanOrEqual(REQUIRED_FIELDS.length);
  });
});

describe('parseReleaseManifest', () => {
  it('parses a valid JSON string of the fixture', () => {
    const result = parseReleaseManifest(JSON.stringify(FIXTURE));
    expect(result.ok).toBe(true);
  });

  it('reports a JSON syntax error with a regeneration hint', () => {
    const result = parseReleaseManifest('not json{');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('valid JSON');
    expect(result.errors[0]).toContain('scripts/release.sh');
  });

  it('delegates to the validator for syntactically valid but structurally invalid JSON', () => {
    const result = parseReleaseManifest(JSON.stringify({ ...FIXTURE, sha256: 'bad' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('shasum -a 256'))).toBe(true);
  });
});

describe('buildReleaseManifest', () => {
  const input = {
    version: '0.4.2',
    notes: '## Highlights\n- Adds virtual soundcheck playback.',
    releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v0.4.2',
    artifactUrl:
      'https://github.com/on-par/sound-buddy-releases/releases/download/v0.4.2/Sound.Buddy-0.4.2-arm64-mac.zip',
    artifactSizeBytes: 123456789,
    sha256: 'a'.repeat(64),
    publishedAt: '2026-07-18T12:00:00Z',
  };

  it('builds a valid manifest with schemaVersion 1, default channel, and summarized notes', () => {
    const manifest = buildReleaseManifest(input);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.channel).toBe('latest');
    expect(manifest.notesSummary).toBe('Highlights Adds virtual soundcheck playback.');
  });

  it('respects an explicit channel', () => {
    const manifest = buildReleaseManifest({ ...input, channel: 'beta' });
    expect(manifest.channel).toBe('beta');
  });

  it('throws with an actionable message when the assembled manifest is invalid', () => {
    expect(() => buildReleaseManifest({ ...input, sha256: 'bad' })).toThrow(
      'cannot build release manifest',
    );
  });
});

describe('signed field', () => {
  it('validates ok with signed: false and includes it in the manifest', () => {
    const result = validateReleaseManifest({ ...FIXTURE, signed: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.manifest.signed).toBe(false);
    expect(Object.keys(result.manifest).sort()).toEqual([...REQUIRED_FIELDS, 'signed'].sort());
  });

  it('validates ok with signed: true', () => {
    const result = validateReleaseManifest({ ...FIXTURE, signed: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.manifest.signed).toBe(true);
  });

  it('stays valid without signed, and omits it from the manifest (backwards compat)', () => {
    const result = validateReleaseManifest(FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.manifest).not.toHaveProperty('signed');
    expect(Object.keys(result.manifest).sort()).toEqual([...REQUIRED_FIELDS].sort());
  });

  it.each(['yes', 1, null])('rejects a non-boolean signed (%s)', (badSigned) => {
    const result = validateReleaseManifest({ ...FIXTURE, signed: badSigned });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('signed') && e.includes('boolean'))).toBe(true);
  });

  it('buildReleaseManifest includes signed when provided, omits it otherwise', () => {
    const input = {
      version: '0.4.2',
      notes: '## Highlights\n- Adds virtual soundcheck playback.',
      releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v0.4.2',
      artifactUrl:
        'https://github.com/on-par/sound-buddy-releases/releases/download/v0.4.2/Sound.Buddy-0.4.2-arm64-mac.zip',
      artifactSizeBytes: 123456789,
      sha256: 'a'.repeat(64),
      publishedAt: '2026-07-18T12:00:00Z',
    };
    const signedManifest = buildReleaseManifest({ ...input, signed: false });
    expect(signedManifest.signed).toBe(false);

    const unsignedManifest = buildReleaseManifest(input);
    expect(unsignedManifest).not.toHaveProperty('signed');
  });
});

describe('buildReleaseManifestPreview', () => {
  const previewInput = {
    version: '0.4.2',
    notes: '## Highlights\n- Adds virtual soundcheck playback.',
    releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v0.4.2',
    artifactUrl:
      'https://github.com/on-par/sound-buddy-releases/releases/download/v0.4.2/Sound.Buddy-0.4.2-arm64-mac.zip',
    signed: false,
  };

  it('builds a preview with measured-field placeholders', () => {
    const preview = buildReleaseManifestPreview(previewInput);
    expect(preview.schemaVersion).toBe(RELEASE_MANIFEST_SCHEMA_VERSION);
    expect(preview.channel).toBe('latest');
    expect(preview.notesSummary).toBe('Highlights Adds virtual soundcheck playback.');
    expect(preview.artifactSizeBytes).toBe(DRY_RUN_MEASURED_PLACEHOLDER);
    expect(preview.sha256).toBe(DRY_RUN_MEASURED_PLACEHOLDER);
    expect(preview.publishedAt).toBe(DRY_RUN_MEASURED_PLACEHOLDER);
    expect(preview.signed).toBe(false);
  });

  it('passes through an explicit channel', () => {
    const preview = buildReleaseManifestPreview({ ...previewInput, channel: 'beta' });
    expect(preview.channel).toBe('beta');
  });

  it('throws on a bad semver version', () => {
    expect(() => buildReleaseManifestPreview({ ...previewInput, version: 'v0.4.2' })).toThrow(
      'MAJOR.MINOR.PATCH',
    );
  });

  it.each(['artifactUrl', 'releaseUrl'])('throws on a non-https %s', (field) => {
    expect(() =>
      buildReleaseManifestPreview({ ...previewInput, [field]: 'http://example.com/x' }),
    ).toThrow(new RegExp(field));
  });
});

describe('verifyUploadedArtifactChecksum', () => {
  const sha = 'b'.repeat(64);

  it('ok when a sha256:-prefixed digest matches', () => {
    const result = verifyUploadedArtifactChecksum(sha, `sha256:${sha}`);
    expect(result).toEqual({ ok: true });
  });

  it('ok when a bare-hex digest matches', () => {
    const result = verifyUploadedArtifactChecksum(sha, sha);
    expect(result).toEqual({ ok: true });
  });

  it('fails on mismatch and names both hex values plus the re-run hint', () => {
    const other = 'c'.repeat(64);
    const result = verifyUploadedArtifactChecksum(sha, other);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain(sha);
    expect(result.error).toContain(other);
    expect(result.error).toContain('re-run scripts/release.sh');
  });

  it('fails on an empty digest with a shasum hint', () => {
    const result = verifyUploadedArtifactChecksum(sha, '');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('shasum -a 256');
  });

  it('fails on a malformed digest', () => {
    const result = verifyUploadedArtifactChecksum(sha, 'sha256:zzz');
    expect(result.ok).toBe(false);
  });

  it('fails on an invalid expectedSha256 with a regenerate hint', () => {
    const result = verifyUploadedArtifactChecksum('a'.repeat(63), sha);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('regenerate');
  });
});

describe('summarizeReleaseNotes', () => {
  it('strips markdown headings and bullet markers, collapsing whitespace', () => {
    const summary = summarizeReleaseNotes('## Highlights\n- Adds virtual soundcheck playback.\n- Fixes a bug.');
    expect(summary).toBe('Highlights Adds virtual soundcheck playback. Fixes a bug.');
  });

  it('collapses runs of newlines and whitespace into single spaces', () => {
    const summary = summarizeReleaseNotes('Line one\n\n\n   Line two');
    expect(summary).toBe('Line one Line two');
  });

  it('truncates long input to exactly NOTES_SUMMARY_MAX_CHARS ending in an ellipsis', () => {
    const longNotes = 'x'.repeat(NOTES_SUMMARY_MAX_CHARS + 50);
    const summary = summarizeReleaseNotes(longNotes);
    expect(summary.length).toBe(NOTES_SUMMARY_MAX_CHARS);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(summarizeReleaseNotes('')).toBe('');
    expect(summarizeReleaseNotes('   \n\n  ')).toBe('');
  });
});
