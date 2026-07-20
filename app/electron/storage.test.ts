import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  dirSizeBytes,
  formatBytes,
  saveAnalysisSummary,
  listAnalysisSummaries,
  setAnalysisSummaryNote,
  type AnalysisSummary,
} from './storage';

describe('formatBytes', () => {
  it('renders bytes with no decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('uses binary (1024) units with one decimal', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1.4 * 1024 * 1024 * 1024)).toBe('1.4 GB');
  });

  it('promotes a value that rounds up to 1024 into the next unit', () => {
    // 1 MB − 1 byte: 1023.999… KB must read "1 MB", not "1024 KB".
    expect(formatBytes(1024 * 1024 - 1)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe('1 GB');
    // A value genuinely below the promotion threshold stays in its unit.
    expect(formatBytes(1023 * 1024)).toBe('1023 KB');
  });

  it('guards against negative / non-finite input', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
  });
});

describe('dirSizeBytes', () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-storage-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns 0 for a folder that does not exist', async () => {
    expect(await dirSizeBytes(path.join(dir, 'nope'))).toBe(0);
  });

  it('returns 0 for an empty folder', async () => {
    expect(await dirSizeBytes(dir)).toBe(0);
  });

  it('sums file sizes across nested subfolders', async () => {
    fs.writeFileSync(path.join(dir, 'a.wav'), Buffer.alloc(100));
    const sub = path.join(dir, 'session-1');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'stem1.wav'), Buffer.alloc(250));
    fs.writeFileSync(path.join(sub, 'stem2.wav'), Buffer.alloc(150));
    expect(await dirSizeBytes(dir)).toBe(500);
  });

  it('does not follow symlinks out of the folder', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-outside-'));
    fs.writeFileSync(path.join(outside, 'big.wav'), Buffer.alloc(9999));
    try {
      fs.symlinkSync(outside, path.join(dir, 'link'));
      // The symlink itself is neither a real file nor a directory entry we
      // descend into, so its target's bytes are not counted.
      expect(await dirSizeBytes(dir)).toBe(0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('saveAnalysisSummary', () => {
  let dir = '';
  let summary: AnalysisSummary;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-storage-'));
    summary = {
      date: '2026-07-11T15:30:45.123Z',
      sourceFilename: 'sermon.wav',
      gradeLetter: 'B',
      score: 84,
      recordingType: 'Music',
      topFixes: ['Reduce low mids', 'Raise speech presence'],
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the history folder if missing and returns a real file path', async () => {
    const historyDir = path.join(dir, 'history');

    const file = await saveAnalysisSummary(historyDir, summary);

    expect(fs.existsSync(historyDir)).toBe(true);
    expect(fs.statSync(file).isFile()).toBe(true);
  });

  it('writes the summary record contents as JSON', async () => {
    const file = await saveAnalysisSummary(path.join(dir, 'history'), summary);

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AnalysisSummary;
    expect(Number.isNaN(Date.parse(parsed.date))).toBe(false);
    expect(parsed).toEqual(summary);
    expect(typeof parsed.score).toBe('number');
    expect(Array.isArray(parsed.topFixes)).toBe(true);
  });

  it('writes one discrete JSON file per analysis', async () => {
    const historyDir = path.join(dir, 'history');
    const second: AnalysisSummary = {
      ...summary,
      date: '2026-07-11T15:30:45.124Z',
      sourceFilename: 'worship.wav',
      gradeLetter: 'A',
      score: 95,
    };

    const firstFile = await saveAnalysisSummary(historyDir, summary);
    const secondFile = await saveAnalysisSummary(historyDir, second);
    const files = fs.readdirSync(historyDir).filter((name) => name.endsWith('.json'));

    expect(files).toHaveLength(2);
    expect(firstFile).not.toBe(secondFile);
    expect(JSON.parse(fs.readFileSync(firstFile, 'utf8'))).toMatchObject({ sourceFilename: 'sermon.wav' });
    expect(JSON.parse(fs.readFileSync(secondFile, 'utf8'))).toMatchObject({ sourceFilename: 'worship.wav' });
  });
});

describe('listAnalysisSummaries', () => {
  let dir = '';
  let base: AnalysisSummary;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-storage-'));
    base = {
      date: '2026-07-11T15:30:45.123Z',
      sourceFilename: 'sermon.wav',
      gradeLetter: 'B',
      score: 84,
      recordingType: 'Music',
      topFixes: ['Reduce low mids', 'Raise speech presence'],
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] for a missing history dir', async () => {
    expect(await listAnalysisSummaries(path.join(dir, 'nope'))).toEqual([]);
  });

  it('returns [] for an empty history dir', async () => {
    const historyDir = path.join(dir, 'history');
    fs.mkdirSync(historyDir);
    expect(await listAnalysisSummaries(historyDir)).toEqual([]);
  });

  it('round-trips saved records, newest-first by date', async () => {
    const historyDir = path.join(dir, 'history');
    const older = { ...base, date: '2026-07-10T09:00:00.000Z', sourceFilename: 'older.wav' };
    const newest = { ...base, date: '2026-07-11T20:00:00.000Z', sourceFilename: 'newest.wav' };
    const middle = { ...base, date: '2026-07-11T09:00:00.000Z', sourceFilename: 'middle.wav' };

    // Written out of chronological order — the sort must key off `date`, not
    // write order or filesystem mtime.
    await saveAnalysisSummary(historyDir, older);
    await saveAnalysisSummary(historyDir, newest);
    await saveAnalysisSummary(historyDir, middle);

    const result = await listAnalysisSummaries(historyDir);
    expect(result.map((r) => r.sourceFilename)).toEqual(['newest.wav', 'middle.wav', 'older.wav']);
  });

  it('caps at 10 most recent, excluding older records', async () => {
    const historyDir = path.join(dir, 'history');
    const records: AnalysisSummary[] = Array.from({ length: 13 }, (_, i) => ({
      ...base,
      // Explicit ISO dates spaced a day apart — deterministic ordering, no wall
      // clock. Index 0 is the oldest, index 12 the newest.
      date: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      sourceFilename: `file-${i}.wav`,
    }));

    for (const r of records) await saveAnalysisSummary(historyDir, r);

    const result = await listAnalysisSummaries(historyDir);
    expect(result).toHaveLength(10);
    // The 10 newest are index 12 down to index 3; indices 0-2 (oldest 3) are excluded.
    expect(result.map((r) => r.sourceFilename)).toEqual(
      Array.from({ length: 10 }, (_, i) => `file-${12 - i}.wav`),
    );
    expect(result.some((r) => r.sourceFilename === 'file-0.wav')).toBe(false);
  });

  it('skips a corrupt/non-JSON file without throwing', async () => {
    const historyDir = path.join(dir, 'history');
    await saveAnalysisSummary(historyDir, base);
    fs.writeFileSync(path.join(historyDir, 'garbage.json'), 'not valid json {{{');

    const result = await listAnalysisSummaries(historyDir);
    expect(result).toEqual([base]);
  });

  it('skips a well-formed-JSON file that is not a real AnalysisSummary', async () => {
    const historyDir = path.join(dir, 'history');
    await saveAnalysisSummary(historyDir, base);
    // Each of these parses fine but isn't a usable record: null, an array, an
    // object missing a required field, and a field with the wrong type.
    fs.writeFileSync(path.join(historyDir, 'null.json'), 'null');
    fs.writeFileSync(path.join(historyDir, 'array.json'), '[]');
    fs.writeFileSync(path.join(historyDir, 'missing-grade.json'), JSON.stringify({ ...base, gradeLetter: undefined }));
    fs.writeFileSync(path.join(historyDir, 'wrong-type.json'), JSON.stringify({ ...base, score: '84' }));

    const result = await listAnalysisSummaries(historyDir);
    expect(result).toEqual([base]);
  });

  it('returns a record with a note intact, and an older no-note record unchanged (#267)', async () => {
    const historyDir = path.join(dir, 'history');
    const withNote: AnalysisSummary = { ...base, sourceFilename: 'with-note.wav', note: 'board tech was out' };
    const withoutNote: AnalysisSummary = { ...base, sourceFilename: 'without-note.wav' };
    await saveAnalysisSummary(historyDir, withNote);
    await saveAnalysisSummary(historyDir, withoutNote);

    const result = await listAnalysisSummaries(historyDir);
    const bySource = Object.fromEntries(result.map((r) => [r.sourceFilename, r]));
    expect(bySource['with-note.wav'].note).toBe('board tech was out');
    expect('note' in bySource['without-note.wav']).toBe(false);
  });

  it('skips a record whose note field is the wrong type (#267)', async () => {
    const historyDir = path.join(dir, 'history');
    await saveAnalysisSummary(historyDir, base);
    fs.writeFileSync(path.join(historyDir, 'bad-note.json'), JSON.stringify({ ...base, note: 42 }));

    const result = await listAnalysisSummaries(historyDir);
    expect(result).toEqual([base]);
  });

  it('round-trips a record with source: "live", and a legacy no-source record unchanged (#261)', async () => {
    const historyDir = path.join(dir, 'history');
    const live: AnalysisSummary = { ...base, sourceFilename: 'live-session.wav', source: 'live' };
    const legacy: AnalysisSummary = { ...base, sourceFilename: 'legacy.wav' };
    await saveAnalysisSummary(historyDir, live);
    await saveAnalysisSummary(historyDir, legacy);

    const result = await listAnalysisSummaries(historyDir);
    const bySource = Object.fromEntries(result.map((r) => [r.sourceFilename, r]));
    expect(bySource['live-session.wav'].source).toBe('live');
    expect('source' in bySource['legacy.wav']).toBe(false);
  });
});

describe('setAnalysisSummaryNote', () => {
  let dir = '';
  let historyDir = '';
  let base: AnalysisSummary;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-storage-'));
    historyDir = path.join(dir, 'history');
    base = {
      date: '2026-07-11T15:30:45.123Z',
      sourceFilename: 'sermon.wav',
      gradeLetter: 'B',
      score: 84,
      recordingType: 'Music',
      topFixes: ['Reduce low mids', 'Raise speech presence'],
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the note into an existing record, leaving all other fields byte-identical', async () => {
    const file = await saveAnalysisSummary(historyDir, base);
    const basename = path.basename(file);

    await setAnalysisSummaryNote(historyDir, basename, 'used the new wireless pack today');

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AnalysisSummary;
    expect(parsed).toEqual({ ...base, note: 'used the new wireless pack today' });
  });

  it('trims whitespace off the note', async () => {
    const file = await saveAnalysisSummary(historyDir, base);
    await setAnalysisSummaryNote(historyDir, path.basename(file), '  spaced out  ');

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AnalysisSummary;
    expect(parsed.note).toBe('spaced out');
  });

  it('clamps the note to MAX_NOTE_LENGTH', async () => {
    const file = await saveAnalysisSummary(historyDir, base);
    const long = 'x'.repeat(500);
    await setAnalysisSummaryNote(historyDir, path.basename(file), long);

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AnalysisSummary;
    expect(parsed.note).toHaveLength(200);
    expect(parsed.note).toBe('x'.repeat(200));
  });

  it('removes the note key entirely for an empty/whitespace-only note', async () => {
    const file = await saveAnalysisSummary(historyDir, { ...base, note: 'old note' });
    await setAnalysisSummaryNote(historyDir, path.basename(file), '   ');

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AnalysisSummary;
    expect('note' in parsed).toBe(false);
  });

  it('rejects a path-traversal filename', async () => {
    await expect(setAnalysisSummaryNote(historyDir, '../outside.json', 'x')).rejects.toThrow(
      /\.\.\/outside\.json/,
    );
  });

  it('rejects a filename with a subdirectory component', async () => {
    await expect(setAnalysisSummaryNote(historyDir, 'a/b.json', 'x')).rejects.toThrow(/a\/b\.json/);
  });

  it('rejects a filename that does not end in .json', async () => {
    await expect(setAnalysisSummaryNote(historyDir, 'notjson.txt', 'x')).rejects.toThrow(/notjson\.txt/);
  });

  it('throws an actionable error when the target file does not exist', async () => {
    fs.mkdirSync(historyDir, { recursive: true });
    await expect(setAnalysisSummaryNote(historyDir, 'missing.json', 'x')).rejects.toThrow(
      /missing\.json.*not saved/,
    );
  });

  it('throws when the target file parses but is not an AnalysisSummary', async () => {
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'not-a-summary.json'), JSON.stringify({ foo: 'bar' }));

    await expect(setAnalysisSummaryNote(historyDir, 'not-a-summary.json', 'x')).rejects.toThrow(
      /not-a-summary\.json.*not saved/,
    );
  });
});
