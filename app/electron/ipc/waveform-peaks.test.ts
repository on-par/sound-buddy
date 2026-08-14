// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  buildWaveformPeaksArgs,
  peakCachePathFor,
  isPeakCacheFresh,
  runWaveformPeaks,
  type WaveformPeaksRunOptions,
} from './waveform-peaks';
import type { PythonStreamExitInfo, PythonStreamSlot } from './python-stream';
import type { SessionPeaksDto } from './api';

// The module imports ../logger and ./engine-loader for its module-level
// peaksSlot (ADR-0010); stub them so this pure-module suite runs without
// Electron. runWaveformPeaks itself never touches either — all deps injected.
vi.mock('../logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock('./engine-loader', () => ({
  loadEngineUtils: () => ({ readNdjsonLines: () => undefined }),
}));

const PEAKS: SessionPeaksDto = {
  bucketsPerSecond: 50,
  tracks: [{ index: 0, label: 'Kick', kind: 'mono', bucketCount: 5, data: 'AA==' }],
};

interface FakeSlotStarted {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  label: string;
  onLine?: (data: Record<string, unknown>) => void;
  onError?: (err: Error) => void;
  onExit: (info: PythonStreamExitInfo) => void;
}

function fakeSlot() {
  const started: FakeSlotStarted[] = [];
  const slot: PythonStreamSlot = {
    start(opts) {
      started.push(opts as unknown as FakeSlotStarted);
    },
    stop: async () => ({ closedCleanly: false }),
    isRunning: () => started.length > 0,
  };
  return { started, slot };
}

function makeFs() {
  const files = new Map<string, { mtime: number; content: string }>();
  const mkdirs: string[] = [];
  return {
    files,
    mkdirs,
    write(p: string, content: string, mtime = 1000) {
      files.set(p, { content, mtime });
    },
    stat: (p: string) => files.get(p)?.mtime ?? null,
    readFile: (p: string) => {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT: ${p}`);
      return f.content;
    },
    mkdir: (p: string) => {
      mkdirs.push(p);
    },
  };
}

function makeOpts(overrides: Partial<WaveformPeaksRunOptions> = {}) {
  const { started, slot } = fakeSlot();
  const fs = makeFs();
  const log = vi.fn();
  const logWarn = vi.fn();
  const logError = vi.fn();
  const onProgress = vi.fn();
  const opts: WaveformPeaksRunOptions = {
    python: '/venv/bin/python3',
    script: '/scripts/waveform_peaks.py',
    env: {},
    cacheDir: '/cache',
    slot,
    stat: fs.stat,
    readFile: fs.readFile,
    mkdir: fs.mkdir,
    log,
    logWarn,
    logError,
    onProgress,
    ...overrides,
  };
  return { opts, started, fs, log, logWarn, logError, onProgress };
}

function writeSession(fs: ReturnType<typeof makeFs>, tracks = [{ file: 'a.wav' }], mtime = 500) {
  fs.write('/sess/session.json', JSON.stringify({ sampleRate: 48000, tracks }), mtime);
}

describe('buildWaveformPeaksArgs', () => {
  it('returns [sessionDir, --out, outPath]', () => {
    expect(buildWaveformPeaksArgs('/sessions/A', '/cache/abc.json')).toEqual([
      '/sessions/A',
      '--out',
      '/cache/abc.json',
    ]);
  });
});

describe('peakCachePathFor', () => {
  it('is deterministic per sessionDir and lives in the cache dir', () => {
    const a = peakCachePathFor('/sessions/A', '/cache');
    expect(a).toBe(peakCachePathFor('/sessions/A', '/cache'));
    expect(a.startsWith('/cache/')).toBe(true);
    expect(a.endsWith('.json')).toBe(true);
  });

  it('produces distinct paths for different session dirs', () => {
    expect(peakCachePathFor('/sessions/A', '/cache')).not.toBe(peakCachePathFor('/sessions/B', '/cache'));
  });
});

describe('isPeakCacheFresh', () => {
  it('is true when the cache is newer than or as new as every source', () => {
    expect(isPeakCacheFresh(100, [50, 60, 100])).toBe(true);
  });

  it('is false when the cache is missing', () => {
    expect(isPeakCacheFresh(null, [50])).toBe(false);
  });

  it('is false when any source mtime is missing', () => {
    expect(isPeakCacheFresh(100, [50, null])).toBe(false);
  });

  it('is false when any source is newer than the cache', () => {
    expect(isPeakCacheFresh(100, [50, 150])).toBe(false);
  });

  it('is true with no sources when the cache exists', () => {
    expect(isPeakCacheFresh(100, [])).toBe(true);
  });
});

describe('runWaveformPeaks', () => {
  it('returns an error without spawning when session.json is unreadable', async () => {
    const { opts, started } = makeOpts();
    const result = await runWaveformPeaks('/sess', opts);
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Could not read session.json');
    expect(started).toHaveLength(0);
  });

  it('returns an error without spawning when session.json has no tracks array', async () => {
    const { opts, started, fs } = makeOpts();
    fs.write('/sess/session.json', JSON.stringify({ sampleRate: 48000 }));
    const result = await runWaveformPeaks('/sess', opts);
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Could not read session.json');
    expect(started).toHaveLength(0);
  });

  it('returns an error without spawning when session.json has an empty tracks array', async () => {
    const { opts, started, fs } = makeOpts();
    fs.write('/sess/session.json', JSON.stringify({ sampleRate: 48000, tracks: [] }));
    const result = await runWaveformPeaks('/sess', opts);
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Could not read session.json');
    expect(started).toHaveLength(0);
  });

  it('serves a fresh cache without spawning', async () => {
    const { opts, started, fs } = makeOpts();
    writeSession(fs);
    fs.write('/sess/a.wav', 'stem', 400);
    fs.write(peakCachePathFor('/sess', '/cache'), JSON.stringify(PEAKS), 600);
    const result = await runWaveformPeaks('/sess', opts);
    expect(result).toEqual({ success: true, cached: true, peaks: PEAKS });
    expect(started).toHaveLength(0);
  });

  it('spawns the script on a stale cache and serves the generated document', async () => {
    const { opts, started, fs } = makeOpts();
    const cachePath = peakCachePathFor('/sess', '/cache');
    writeSession(fs);
    fs.write('/sess/a.wav', 'stem', 400);
    fs.write(cachePath, 'stale', 100);
    const p = runWaveformPeaks('/sess', opts);

    expect(started).toHaveLength(1);
    expect(started[0].command).toBe('/venv/bin/python3');
    expect(started[0].args).toEqual(['/scripts/waveform_peaks.py', '/sess', '--out', cachePath]);
    expect(started[0].label).toBe('generate-session-peaks');
    expect(started[0].env).toEqual({});
    expect(fs.mkdirs).toContain('/cache');

    fs.write(cachePath, JSON.stringify(PEAKS), 700);
    started[0].onExit({ code: 0, signal: null, expected: false });
    const result = await p;
    expect(result).toEqual({ success: true, cached: false, peaks: PEAKS });
  });

  it('maps a non-zero child exit to an actionable error', async () => {
    const { opts, started, fs } = makeOpts();
    writeSession(fs);
    const p = runWaveformPeaks('/sess', opts);
    started[0].onExit({ code: 1, signal: null, expected: false });
    const result = await p;
    expect(result).toEqual({ success: false, error: 'waveform peak generation failed (exit 1).' });
  });

  it('maps a null child exit (signal death) to an actionable error', async () => {
    const { opts, started, fs } = makeOpts();
    writeSession(fs);
    const p = runWaveformPeaks('/sess', opts);
    started[0].onExit({ code: null, signal: 'SIGKILL', expected: false });
    const result = await p;
    expect(result).toEqual({ success: false, error: 'waveform peak generation failed (exit null).' });
  });

  it('returns an error when the child process errors out', async () => {
    const { opts, started, fs, logError } = makeOpts();
    writeSession(fs);
    const p = runWaveformPeaks('/sess', opts);
    started[0].onError?.(new Error('spawn ENOENT'));
    const result = await p;
    expect(result).toEqual({ success: false, error: 'waveform peak generation failed (exit null).' });
    expect(logError).toHaveBeenCalledWith('generate-session-peaks: process error', expect.any(Error));
  });

  it('reports an error when the generated cache file cannot be read back', async () => {
    const { opts, started, fs } = makeOpts();
    writeSession(fs);
    const p = runWaveformPeaks('/sess', opts);
    started[0].onExit({ code: 0, signal: null, expected: false });
    const result = await p;
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Could not read generated peaks');
  });

  it('forwards progress lines to onProgress', async () => {
    const { opts, started, fs, onProgress } = makeOpts();
    writeSession(fs);
    const p = runWaveformPeaks('/sess', opts);
    started[0].onLine?.({ type: 'done', tracks: 1 });
    expect(onProgress).toHaveBeenCalledWith({ type: 'done', tracks: 1 });
    started[0].onExit({ code: 0, signal: null, expected: false });
    await p;
  });

  it('treats a track lacking a file field as a missing source and spawns', async () => {
    const { opts, started, fs } = makeOpts();
    writeSession(fs, [{ file: 'a.wav' }, {}]);
    fs.write('/sess/a.wav', 'stem', 400);
    const p = runWaveformPeaks('/sess', opts);
    expect(started).toHaveLength(1);
    started[0].onExit({ code: 0, signal: null, expected: false });
    await p;
  });
});
