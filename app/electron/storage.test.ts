import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { dirSizeBytes, formatBytes, saveAnalysisSummary, type AnalysisSummary } from './storage';

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
