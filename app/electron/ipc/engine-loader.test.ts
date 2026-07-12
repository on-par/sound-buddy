// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same packaged-shape electron mock as analysis.test.ts / parser-drift.test.ts:
// mock Electron in the packaged shape and point resourcesPath at the real
// audio-engine package directory (which has no `engine/` subdir on disk — only
// the packaged .app's extraResources step creates one) so engineParsersDir()
// exercises its dev fallback and loadEngineParsers() loads the REAL, just-built
// dist-cjs output from disk — proving the CJS build is genuinely loadable, in
// CI, with no media tools required (these parser entrypoints do no I/O at
// require() time).
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

import { engineParsersDir, loadEngineParsers } from './engine-loader';
import { REPO_ROOT } from './shared';

describe('engineParsersDir', () => {
  it('falls back to the dist-cjs build when the mocked packaged resourcesPath has no engine/ subdir', () => {
    expect(engineParsersDir()).toBe(path.join(REPO_ROOT, 'packages', 'audio-engine', 'dist-cjs'));
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
