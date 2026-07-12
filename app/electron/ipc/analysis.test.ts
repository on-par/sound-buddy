// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

// Same packaged-shape electron mock as parser-drift.test.ts (#150): importing
// ipc/analysis.ts pulls in ipc/shared.ts, which reads app.isPackaged /
// process.resourcesPath / app.getPath at module load, so those must be mocked
// before the import — even for testing the pure parser below.
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

const executeMock = vi.hoisted(() => vi.fn());
vi.mock('./timeout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./timeout')>();
  return { ...actual, execFileWithTimeout: executeMock };
});

import { parseEbur128Summary, runEbur128 } from './analysis';

const TONE_SUMMARY = `[Parsed_ebur128_0 @ 0x1] t: 0.999977   TARGET:-23 LUFS    M:  -9.0 S:-120.7     I:  -9.0 LUFS       LRA:   0.0 LU  FTPK:  -6.0 dBFS  TPK:  -6.0 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:          -9.0 LUFS
    Threshold: -19.0 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:       -6.0 dBFS
`;

describe('parseEbur128Summary (app copy)', () => {
  it('parses the captured summary block', () => {
    const stats = parseEbur128Summary(TONE_SUMMARY);
    expect(stats.integratedLufs).toBeCloseTo(-9.0, 5);
    expect(stats.loudnessRange).toBeCloseTo(0.0, 5);
    expect(stats.truePeakDbtp).toBeCloseTo(-6.0, 5);
  });

  it('parses a realistic summary with negative LRA-adjacent, multi-digit values', () => {
    const output = `Summary:

  Integrated loudness:
    I:         -23.0 LUFS
    Threshold: -33.2 LUFS

  Loudness range:
    LRA:        10.5 LU
    Threshold:  -43.1 LUFS
    LRA low:    -33.0 LUFS
    LRA high:   -22.5 LUFS

  True peak:
    Peak:       -3.5 dBFS
`;
    const stats = parseEbur128Summary(output);
    expect(stats.integratedLufs).toBeCloseTo(-23.0, 5);
    expect(stats.loudnessRange).toBeCloseTo(10.5, 5);
    expect(stats.truePeakDbtp).toBeCloseTo(-3.5, 5);
  });

  it('ignores per-frame I:/LRA: lines and uses only the summary block', () => {
    const output = `[Parsed_ebur128_0 @ 0x1] t: 0.1 TARGET:-23 LUFS M: -30.0 S:-120.7 I: -30.0 LUFS LRA: 99.0 LU FTPK: -40.0 dBFS TPK: -40.0 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:          -9.0 LUFS
    Threshold: -19.0 LUFS

  Loudness range:
    LRA:         0.0 LU

  True peak:
    Peak:       -6.0 dBFS
`;
    const stats = parseEbur128Summary(output);
    expect(stats.integratedLufs).toBeCloseTo(-9.0, 5);
    expect(stats.loudnessRange).toBeCloseTo(0.0, 5);
    expect(stats.truePeakDbtp).toBeCloseTo(-6.0, 5);
  });

  it('throws an actionable error when Summary: is missing', () => {
    expect(() => parseEbur128Summary('no summary here at all')).toThrow(
      /ffmpeg ebur128.*could not parse/i,
    );
  });

  it('throws when the summary reports a non-finite integrated loudness (nan)', () => {
    const output = `Summary:

  Integrated loudness:
    I:          nan LUFS

  Loudness range:
    LRA:         0.0 LU

  True peak:
    Peak:       -6.0 dBFS
`;
    expect(() => parseEbur128Summary(output)).toThrow(/ffmpeg ebur128.*could not parse/i);
  });

  it('throws on empty input', () => {
    expect(() => parseEbur128Summary('')).toThrow(/ffmpeg ebur128.*could not parse/i);
  });

  it('parses a -inf true peak (fully silent audio) as -Infinity instead of throwing', () => {
    const output = `Summary:

  Integrated loudness:
    I:         -70.0 LUFS

  Loudness range:
    LRA:         0.0 LU

  True peak:
    Peak:       -inf dBFS
`;
    const stats = parseEbur128Summary(output);
    expect(stats.integratedLufs).toBeCloseTo(-70.0, 5);
    expect(stats.loudnessRange).toBeCloseTo(0.0, 5);
    expect(stats.truePeakDbtp).toBe(-Infinity);
  });
});

describe('runEbur128 (app copy)', () => {
  it("passes a maxBuffer large enough for multi-hour recordings — ebur128 writes a stderr progress line roughly every 100ms, which can exceed Node's 1MB execFile default well before a long service recording finishes", async () => {
    executeMock.mockResolvedValueOnce({ stdout: '', stderr: TONE_SUMMARY });
    await runEbur128('/tmp/service.wav');
    const options = executeMock.mock.calls[0][2];
    expect(options.maxBuffer).toBeGreaterThanOrEqual(16 * 1024 * 1024);
  });
});
