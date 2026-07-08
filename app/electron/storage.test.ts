import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { dirSizeBytes, formatBytes } from './storage';

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

  it('returns 0 for a folder that does not exist', () => {
    expect(dirSizeBytes(path.join(dir, 'nope'))).toBe(0);
  });

  it('returns 0 for an empty folder', () => {
    expect(dirSizeBytes(dir)).toBe(0);
  });

  it('sums file sizes across nested subfolders', () => {
    fs.writeFileSync(path.join(dir, 'a.wav'), Buffer.alloc(100));
    const sub = path.join(dir, 'session-1');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'stem1.wav'), Buffer.alloc(250));
    fs.writeFileSync(path.join(sub, 'stem2.wav'), Buffer.alloc(150));
    expect(dirSizeBytes(dir)).toBe(500);
  });

  it('does not follow symlinks out of the folder', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-outside-'));
    fs.writeFileSync(path.join(outside, 'big.wav'), Buffer.alloc(9999));
    try {
      fs.symlinkSync(outside, path.join(dir, 'link'));
      // The symlink itself is neither a real file nor a directory entry we
      // descend into, so its target's bytes are not counted.
      expect(dirSizeBytes(dir)).toBe(0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
