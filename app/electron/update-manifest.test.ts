import { describe, it, expect } from 'vitest';
import { parseUpdateManifest } from './update-manifest';

function omit(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const rest = { ...obj };
  delete rest[key];
  return rest;
}

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    version: '9.9.9',
    channel: 'latest',
    notesSummary: 'Bug fixes and improvements.',
    releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v9.9.9',
    artifactUrl: 'https://github.com/on-par/sound-buddy-releases/releases/download/v9.9.9/SoundBuddy.zip',
    artifactSizeBytes: 123456,
    sha256: 'a'.repeat(64),
    publishedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('parseUpdateManifest', () => {
  it('parses a valid manifest into the four consumed fields', () => {
    const result = parseUpdateManifest(validManifest());

    expect(result).toEqual({
      ok: true,
      manifest: {
        version: '9.9.9',
        notesSummary: 'Bug fixes and improvements.',
        releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v9.9.9',
        artifactUrl:
          'https://github.com/on-par/sound-buddy-releases/releases/download/v9.9.9/SoundBuddy.zip',
      },
    });
  });

  it('ignores unknown future fields (AC 4)', () => {
    const result = parseUpdateManifest({
      ...validManifest(),
      deltaUrl: 'https://example.com/delta.zip',
      minimumOsVersion: '26.0',
      anything: 1,
    });

    expect(result).toEqual({
      ok: true,
      manifest: {
        version: '9.9.9',
        notesSummary: 'Bug fixes and improvements.',
        releaseUrl: 'https://github.com/on-par/sound-buddy-releases/releases/tag/v9.9.9',
        artifactUrl:
          'https://github.com/on-par/sound-buddy-releases/releases/download/v9.9.9/SoundBuddy.zip',
      },
    });
  });

  it('parses fine with optional signed true, false, or absent', () => {
    expect(parseUpdateManifest({ ...validManifest(), signed: true }).ok).toBe(true);
    expect(parseUpdateManifest({ ...validManifest(), signed: false }).ok).toBe(true);
    expect(parseUpdateManifest(validManifest()).ok).toBe(true);
  });

  it('reports a problem naming the field when version is missing', () => {
    const result = parseUpdateManifest(omit(validManifest(), 'version'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/version/);
  });

  it('reports a problem naming the field when notesSummary is missing', () => {
    const result = parseUpdateManifest(omit(validManifest(), 'notesSummary'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/notesSummary/);
  });

  it('reports a problem naming the field when releaseUrl is missing', () => {
    const result = parseUpdateManifest(omit(validManifest(), 'releaseUrl'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/releaseUrl/);
  });

  it('reports a problem naming the field when artifactUrl is missing', () => {
    const result = parseUpdateManifest(omit(validManifest(), 'artifactUrl'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/artifactUrl/);
  });

  it('rejects a version with a leading "v"', () => {
    const result = parseUpdateManifest({ ...validManifest(), version: 'v1.2.3' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/version/);
  });

  it('rejects a non-string version', () => {
    const result = parseUpdateManifest({ ...validManifest(), version: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/version/);
  });

  it('rejects a non-https releaseUrl', () => {
    const result = parseUpdateManifest({
      ...validManifest(),
      releaseUrl: 'http://github.com/on-par/sound-buddy-releases/releases/tag/v9.9.9',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/releaseUrl/);
  });

  it('rejects a non-string artifactUrl', () => {
    const result = parseUpdateManifest({ ...validManifest(), artifactUrl: 42 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/artifactUrl/);
  });

  it('rejects schemaVersion 0', () => {
    const result = parseUpdateManifest({ ...validManifest(), schemaVersion: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/schemaVersion/);
  });

  it('rejects a non-integer schemaVersion', () => {
    const result = parseUpdateManifest({ ...validManifest(), schemaVersion: 1.5 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/schemaVersion/);
  });

  it('rejects a string schemaVersion', () => {
    const result = parseUpdateManifest({ ...validManifest(), schemaVersion: '1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/schemaVersion/);
  });

  it('accepts schemaVersion 2 as a floor check only', () => {
    const result = parseUpdateManifest({ ...validManifest(), schemaVersion: 2 });

    expect(result.ok).toBe(true);
  });

  it('rejects null input with a single "must be a JSON object" problem', () => {
    const result = parseUpdateManifest(null);

    expect(result).toEqual({ ok: false, problems: [expect.stringContaining('JSON object')] });
  });

  it('rejects an array input with a single "must be a JSON object" problem', () => {
    const result = parseUpdateManifest([]);

    expect(result).toEqual({ ok: false, problems: [expect.stringContaining('JSON object')] });
  });

  it('rejects a string input with a single "must be a JSON object" problem', () => {
    const result = parseUpdateManifest('str');

    expect(result).toEqual({ ok: false, problems: [expect.stringContaining('JSON object')] });
  });

  it('accumulates multiple problems at once', () => {
    const result = parseUpdateManifest({
      ...validManifest(),
      version: 'v1.2.3',
      artifactUrl: 'http://example.com/x.zip',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.length).toBe(2);
  });
});
