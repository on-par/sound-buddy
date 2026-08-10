// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

// Same packaged-shape electron mock as bundled-cjs-loader.test.ts /
// parser-drift.test.ts: mock Electron in the packaged shape and point
// resourcesPath at the real audio-engine package directory (which has no
// `engine/` subdir on disk — only the packaged .app's extraResources step
// creates one) so engineParsersDir() exercises its dev fallback and
// loadEngineParsers()/loadEngineUtils() load the REAL, just-built dist-cjs
// output from disk — proving the CJS build is genuinely loadable, in CI, with
// no media tools required (these parser entrypoints do no I/O at require()
// time).
vi.mock('electron', () => {
  const p = require('node:path') as typeof import('node:path');
  const os = require('node:os') as typeof import('node:os');
  const __filename2 = fileURLToPath(import.meta.url);
  const __dirname2 = p.dirname(__filename2);
  (process as { resourcesPath?: string }).resourcesPath = p.resolve(
    __dirname2,
    '..',
    '..',
    '..',
    'packages',
    'audio-engine',
  );
  return {
    app: {
      isPackaged: true,
      getPath: () => os.tmpdir(),
      setName: () => {},
      getName: () => 'sound-buddy-test',
    },
    ipcMain: { handle: () => {} },
    dialog: {},
    BrowserWindow: class {},
    systemPreferences: {},
    shell: {},
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
  };
});

import { engineParsersDir, loadEngineParsers, loadEngineUtils } from './engine-loader';
import { bundledResourceDir } from '../bundled-cjs-loader';

describe('engineParsersDir', () => {
  it('delegates to bundledResourceDir("engine")', () => {
    expect(engineParsersDir()).toBe(bundledResourceDir('engine'));
  });
});

describe('loadEngineParsers', () => {
  it('loads real callable parser functions from the compiled CJS build', () => {
    const parsers = loadEngineParsers();
    expect(typeof parsers.runSox).toBe('function');
    expect(typeof parsers.runFfprobe).toBe('function');
    expect(typeof parsers.runSpectrum).toBe('function');
    expect(typeof parsers.runEbur128).toBe('function');
    expect(typeof parsers.parseEbur128Summary).toBe('function');
    expect(typeof parsers.analyzeAudio).toBe('function');
    expect(typeof parsers.isVideoFile).toBe('function');
    expect(typeof parsers.extractAudioToWav).toBe('function');
    expect(typeof parsers.buildStreamArgs).toBe('function');
    expect(typeof parsers.buildPlaybackArgs).toBe('function');
  });

  it('buildStreamArgs from the loaded module maps a minimal LiveOptions to positional argv', () => {
    const { buildStreamArgs } = loadEngineParsers();
    expect(buildStreamArgs({ windowSecs: 3 })).toEqual(['', '3', '']);
  });

  it('buildPlaybackArgs from the loaded module maps a minimal PlaybackOptions to positional argv', () => {
    const { buildPlaybackArgs } = loadEngineParsers();
    expect(buildPlaybackArgs({ sessionDir: '/tmp/session-1' })).toEqual(['/tmp/session-1']);
  });

  it('isVideoFile from the loaded module recognizes a video extension', () => {
    const { isVideoFile } = loadEngineParsers();
    expect(isVideoFile('/tmp/service.mp4')).toBe(true);
    expect(isVideoFile('/tmp/service.wav')).toBe(false);
  });

  it('memoizes — returns the same object identity on a second call', () => {
    const first = loadEngineParsers();
    const second = loadEngineParsers();
    expect(second).toBe(first);
  });

  it('parseEbur128Summary from the loaded module parses a known summary string', () => {
    const { parseEbur128Summary } = loadEngineParsers();
    const summary = `Summary:

  Integrated loudness:
    I:          -9.0 LUFS

  Loudness range:
    LRA:         0.0 LU

  True peak:
    Peak:       -6.0 dBFS
`;
    const stats = parseEbur128Summary(summary);
    expect(stats.integratedLufs).toBeCloseTo(-9.0, 5);
    expect(stats.loudnessRange).toBeCloseTo(0.0, 5);
    expect(stats.truePeakDbtp).toBeCloseTo(-6.0, 5);
  });
});

describe('loadEngineUtils', () => {
  const collect = (readNdjsonLines: ReturnType<typeof loadEngineUtils>['readNdjsonLines']) => {
    const seen: unknown[] = [];
    const em = new EventEmitter();
    readNdjsonLines(em, (d) => seen.push(d));
    return { em, seen };
  };

  it('loads a real callable readNdjsonLines function from the compiled CJS build', () => {
    const { readNdjsonLines } = loadEngineUtils();
    expect(typeof readNdjsonLines).toBe('function');
  });

  it('parses complete newline-terminated lines, including multiple objects per chunk', () => {
    const { readNdjsonLines } = loadEngineUtils();
    const { em, seen } = collect(readNdjsonLines);
    em.emit('data', Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reassembles a line split across two chunks', () => {
    const { readNdjsonLines } = loadEngineUtils();
    const { em, seen } = collect(readNdjsonLines);
    em.emit('data', Buffer.from('{"win'));
    em.emit('data', Buffer.from('dow":2}\n'));
    expect(seen).toEqual([{ window: 2 }]);
  });

  it('ignores non-JSON lines', () => {
    const { readNdjsonLines } = loadEngineUtils();
    const { em, seen } = collect(readNdjsonLines);
    em.emit('data', Buffer.from('garbage\n{"ok":true}\n'));
    expect(seen).toEqual([{ ok: true }]);
  });

  it('skips blank/whitespace-only lines', () => {
    const { readNdjsonLines } = loadEngineUtils();
    const { em, seen } = collect(readNdjsonLines);
    em.emit('data', Buffer.from('\n   \n{"x":1}\n'));
    expect(seen).toEqual([{ x: 1 }]);
  });

  it('does not deliver a trailing partial line with no newline', () => {
    const { readNdjsonLines } = loadEngineUtils();
    const { em, seen } = collect(readNdjsonLines);
    em.emit('data', Buffer.from('{"x":1}'));
    expect(seen).toEqual([]);
  });

  it('memoizes — returns the same object identity on a second call', () => {
    const first = loadEngineUtils();
    const second = loadEngineUtils();
    expect(second).toBe(first);
  });
});
