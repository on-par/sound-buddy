// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// registerAnalysisHandlers wires every channel into this map so a test can
// invoke a single handler directly without a live ipcMain (same pattern as
// devices.test.ts / playback.test.ts).
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/sound-buddy-test' },
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
}));

// The parser logic itself is now @sound-buddy/audio-engine's job (#151),
// covered by that package's own tests. What belongs to the app is: does
// analyze-file wire the four parsers together correctly (parallel dispatch,
// progress events, noSpectrum stub, cancellation, loudness-failure fallback)
// and does each wrapper pass the right bundled-path/env options through. Both
// are exercised here against a mocked engine-loader.
const runSoxMock = vi.fn();
const runFfprobeMock = vi.fn();
const runSpectrumMock = vi.fn();
const runEbur128Mock = vi.fn();
vi.mock('./engine-loader', () => ({
  loadEngineParsers: () => ({
    runSox: runSoxMock,
    runFfprobe: runFfprobeMock,
    runSpectrum: runSpectrumMock,
    runEbur128: runEbur128Mock,
    parseEbur128Summary: vi.fn(),
  }),
}));

import { registerAnalysisHandlers } from './analysis';
import { toolBin, pythonBin, childEnv, SPECTRUM_SCRIPT } from './shared';

/** A minimal event-sender (renderer webContents) that records `send` calls. */
function fakeSender() {
  return {
    id: 1,
    isDestroyed: () => false,
    sent: [] as { channel: string; payload: unknown }[],
    send(channel: string, payload: unknown) {
      this.sent.push({ channel, payload });
    },
  };
}

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

const SOX_STUB = { rmsDbfs: -9, peakDbfs: -6 };
const FFPROBE_STUB = { stream: { channels: 1 } };
const SPECTRUM_STUB = { bands: { subBass: -3 }, spectralCentroid: 1000, spectralRolloff85: 1200, dynamicRange: 10 };
const LOUDNESS_STUB = { integratedLufs: -14, loudnessRange: 2, truePeakDbtp: -1 };

type AnalyzeHandler = (
  event: { sender: ReturnType<typeof fakeSender> },
  opts: { filePath: string; noSpectrum?: boolean },
) => Promise<{ success: boolean; cancelled?: boolean; error?: string; data?: unknown }>;

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  registerAnalysisHandlers();
  runSoxMock.mockResolvedValue(SOX_STUB);
  runFfprobeMock.mockResolvedValue(FFPROBE_STUB);
  runSpectrumMock.mockResolvedValue(SPECTRUM_STUB);
  runEbur128Mock.mockResolvedValue(LOUDNESS_STUB);
});

describe('analyze-file IPC handler', () => {
  it('resolves { success: true, data } assembled from all four parsers and sends per-stage progress events', async () => {
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const result = await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(result).toEqual({
      success: true,
      data: {
        filePath: '/tmp/service.wav',
        sox: SOX_STUB,
        ffprobe: FFPROBE_STUB,
        spectrum: SPECTRUM_STUB,
        loudness: LOUDNESS_STUB,
      },
    });

    const progress = sender.sent.filter((s) => s.channel === 'analysis-progress').map((s) => s.payload);
    expect(progress).toContainEqual({ stage: 'reading', status: 'start' });
    expect(progress).toContainEqual({ stage: 'levels', status: 'start' });
    expect(progress).toContainEqual({ stage: 'spectrum', status: 'start' });
    expect(progress).toContainEqual({ stage: 'reading', status: 'done' });
    expect(progress).toContainEqual({ stage: 'levels', status: 'done' });
    expect(progress).toContainEqual({ stage: 'spectrum', status: 'done' });

    const results = sender.sent.filter((s) => s.channel === 'analysis-result');
    expect(results).toHaveLength(1);
  });

  it('noSpectrum: true skips the engine spectrum call and uses the -120 dB placeholder bands', async () => {
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const result = await handler({ sender }, { filePath: '/tmp/service.wav', noSpectrum: true });

    expect(runSpectrumMock).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      spectrum: {
        bands: { subBass: -120, bass: -120, lowMid: -120, mid: -120, highMid: -120, presence: -120, brilliance: -120 },
        spectralCentroid: 0,
        spectralRolloff85: 0,
        dynamicRange: 0,
      },
    });
  });

  it('falls back to loudness: null (still success) when the ebur128 stub rejects with a non-abort error', async () => {
    runEbur128Mock.mockRejectedValueOnce(new Error('ffmpeg not found'));
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const result = await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(result.success).toBe(true);
    expect((result.data as { loudness: unknown }).loudness).toBeNull();
  });

  it('resolves { success: false, cancelled: true } when a parser rejects with an AbortError', async () => {
    runSoxMock.mockRejectedValueOnce(abortError());
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const result = await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(result).toEqual({ success: false, cancelled: true });
  });

  it('wrappers pass toolBin/SPECTRUM_SCRIPT/pythonBin/childEnv values through to the engine parsers', async () => {
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(runSoxMock).toHaveBeenCalledWith('/tmp/service.wav', { bin: toolBin('sox'), signal: expect.any(AbortSignal) });
    expect(runFfprobeMock).toHaveBeenCalledWith('/tmp/service.wav', {
      bin: toolBin('ffprobe'),
      signal: expect.any(AbortSignal),
    });
    expect(runEbur128Mock).toHaveBeenCalledWith('/tmp/service.wav', {
      bin: toolBin('ffmpeg'),
      signal: expect.any(AbortSignal),
    });
    expect(runSpectrumMock).toHaveBeenCalledWith('/tmp/service.wav', {
      scriptPath: SPECTRUM_SCRIPT,
      python: pythonBin(),
      env: childEnv(),
      signal: expect.any(AbortSignal),
    });
  });
});
