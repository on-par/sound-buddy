import { describe, expect, it } from 'vitest';
import { checkUpdateFeed, parseLatestMacYml } from './update-feed.js';
import type { BuiltArtifact } from './update-feed.js';

const LATEST_MAC_YML = `version: 0.8.31
files:
  - url: Sound.Buddy-0.8.31-arm64-mac.zip
    sha512: AAAA1111BBBB2222==
    size: 123456789
  - url: Sound.Buddy-0.8.31-arm64.dmg
    sha512: CCCC3333DDDD4444==
    size: 987654321
path: Sound.Buddy-0.8.31-arm64-mac.zip
sha512: AAAA1111BBBB2222==
releaseDate: '2026-08-27T00:00:00.000Z'
blockMapSize: 12345
`;

describe('parseLatestMacYml', () => {
  it('extracts version, path and top-level sha512', () => {
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    expect(feed.version).toBe('0.8.31');
    expect(feed.path).toBe('Sound.Buddy-0.8.31-arm64-mac.zip');
    expect(feed.sha512).toBe('AAAA1111BBBB2222==');
  });

  it('extracts one file entry with url, sha512 and numeric size', () => {
    const feed = parseLatestMacYml(`files:
  - url: only.zip
    sha512: SHA==
    size: 42
`);
    expect(feed.files).toEqual([{ url: 'only.zip', sha512: 'SHA==', size: 42 }]);
  });

  it('handles two file entries', () => {
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    expect(feed.files).toHaveLength(2);
    expect(feed.files[0]).toEqual({
      url: 'Sound.Buddy-0.8.31-arm64-mac.zip',
      sha512: 'AAAA1111BBBB2222==',
      size: 123456789,
    });
    expect(feed.files[1]).toEqual({
      url: 'Sound.Buddy-0.8.31-arm64.dmg',
      sha512: 'CCCC3333DDDD4444==',
      size: 987654321,
    });
  });

  it('ignores unknown keys without throwing', () => {
    expect(() => parseLatestMacYml(LATEST_MAC_YML)).not.toThrow();
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    expect(feed).not.toHaveProperty('releaseDate');
    expect(feed).not.toHaveProperty('blockMapSize');
  });

  it('strips surrounding single or double quotes from a quoted value', () => {
    const feed = parseLatestMacYml(`version: '0.8.31'\npath: "Sound.Buddy-0.8.31-arm64-mac.zip"\n`);
    expect(feed.version).toBe('0.8.31');
    expect(feed.path).toBe('Sound.Buddy-0.8.31-arm64-mac.zip');
  });

  it('ignores an indented line outside of a files entry (e.g. nested config electron-builder adds later)', () => {
    const feed = parseLatestMacYml('version: 0.8.31\n  nestedExtra: value\npath: x.zip\n');
    expect(feed).toEqual({ version: '0.8.31', path: 'x.zip', files: [] });
  });

  it('does not treat a single-character value as quoted', () => {
    const feed = parseLatestMacYml('version: 5\n');
    expect(feed.version).toBe('5');
  });

  it('returns files: [] and does not throw for empty input', () => {
    expect(parseLatestMacYml('')).toEqual({ files: [] });
  });

  it('returns files: [] and does not throw for input with no files: block', () => {
    expect(parseLatestMacYml('version: 0.8.31\n')).toEqual({ version: '0.8.31', files: [] });
  });

  it('leaves size undefined when the key is absent', () => {
    const feed = parseLatestMacYml(`files:\n  - url: no-size.zip\n    sha512: SHA==\n`);
    expect(feed.files[0].size).toBeUndefined();
  });

  it('ignores an unrecognized indented key within a file entry (e.g. per-file blockMapSize)', () => {
    const feed = parseLatestMacYml(
      `files:\n  - url: with-blockmap.zip\n    sha512: SHA==\n    size: 42\n    blockMapSize: 99\n`,
    );
    expect(feed.files).toEqual([{ url: 'with-blockmap.zip', sha512: 'SHA==', size: 42 }]);
  });

  it('leaves size undefined when the key is non-numeric', () => {
    const feed = parseLatestMacYml(`files:\n  - url: bad-size.zip\n    sha512: SHA==\n    size: not-a-number\n`);
    expect(feed.files[0].size).toBeUndefined();
  });
});

const ZIP_ARTIFACT: BuiltArtifact = {
  name: 'Sound.Buddy-0.8.31-arm64-mac.zip',
  sizeBytes: 123456789,
  sha512Base64: 'AAAA1111BBBB2222==',
};

const DMG_ARTIFACT: BuiltArtifact = {
  name: 'Sound.Buddy-0.8.31-arm64.dmg',
  sizeBytes: 987654321,
  sha512Base64: 'CCCC3333DDDD4444==',
};

describe('checkUpdateFeed', () => {
  it('returns ok: true on a matching feed+artifacts pair', () => {
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    expect(checkUpdateFeed(feed, [ZIP_ARTIFACT, DMG_ARTIFACT], '0.8.31')).toEqual({ ok: true });
  });

  it('reports a problem naming the file on a sha512 mismatch', () => {
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    const badZip = { ...ZIP_ARTIFACT, sha512Base64: 'WRONG==' };
    const verdict = checkUpdateFeed(feed, [badZip, DMG_ARTIFACT], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => p.includes(ZIP_ARTIFACT.name) && /sha512/i.test(p))).toBe(true);
  });

  it('reports a problem naming the file on a size mismatch', () => {
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    const badZip = { ...ZIP_ARTIFACT, sizeBytes: 1 };
    const verdict = checkUpdateFeed(feed, [badZip, DMG_ARTIFACT], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => p.includes(ZIP_ARTIFACT.name) && /size/i.test(p))).toBe(true);
  });

  it('reports a problem on a url naming an artifact that was not built', () => {
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    const verdict = checkUpdateFeed(feed, [DMG_ARTIFACT], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => p.includes(ZIP_ARTIFACT.name))).toBe(true);
  });

  it('reports a problem on a url containing a space, citing #625 or spaces', () => {
    const feed = parseLatestMacYml(`files:\n  - url: Sound Buddy-0.8.31-arm64-mac.zip\n    sha512: AAAA1111BBBB2222==\n    size: 123456789\npath: Sound Buddy-0.8.31-arm64-mac.zip\n`);
    const spacedArtifact: BuiltArtifact = { ...ZIP_ARTIFACT, name: 'Sound Buddy-0.8.31-arm64-mac.zip' };
    const verdict = checkUpdateFeed(feed, [spacedArtifact], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => /#625/.test(p) || /space/i.test(p))).toBe(true);
  });

  it('names "(none built)" when the referenced url matches no built artifact at all', () => {
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    const verdict = checkUpdateFeed(feed, [], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => p.includes('(none built)'))).toBe(true);
  });

  it('reports a problem on a version mismatch', () => {
    const feed = parseLatestMacYml(LATEST_MAC_YML);
    const verdict = checkUpdateFeed(feed, [ZIP_ARTIFACT, DMG_ARTIFACT], '0.9.0');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => /version/i.test(p))).toBe(true);
  });

  it('reports a problem on an empty files list', () => {
    const feed = parseLatestMacYml('version: 0.8.31\npath: x.zip\n');
    const verdict = checkUpdateFeed(feed, [ZIP_ARTIFACT], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => /files/i.test(p))).toBe(true);
  });

  it('reports a problem on a missing path', () => {
    const feed = parseLatestMacYml(
      'version: 0.8.31\nfiles:\n  - url: Sound.Buddy-0.8.31-arm64-mac.zip\n    sha512: AAAA1111BBBB2222==\n    size: 123456789\n',
    );
    const verdict = checkUpdateFeed(feed, [ZIP_ARTIFACT], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => /path/i.test(p))).toBe(true);
  });

  it('reports a problem on a path that is not one of the file urls', () => {
    const feed = parseLatestMacYml(
      'version: 0.8.31\nfiles:\n  - url: Sound.Buddy-0.8.31-arm64-mac.zip\n    sha512: AAAA1111BBBB2222==\n    size: 123456789\npath: something-else.zip\n',
    );
    const verdict = checkUpdateFeed(feed, [ZIP_ARTIFACT], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.some((p) => /path/i.test(p))).toBe(true);
  });

  it('accumulates two problems at once', () => {
    const feed = parseLatestMacYml(
      'version: 0.9.0\nfiles:\n  - url: Sound.Buddy-0.8.31-arm64-mac.zip\n    sha512: WRONG==\n    size: 123456789\npath: Sound.Buddy-0.8.31-arm64-mac.zip\n',
    );
    const verdict = checkUpdateFeed(feed, [ZIP_ARTIFACT], '0.8.31');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected failure');
    expect(verdict.problems.length).toBe(2);
  });
});
