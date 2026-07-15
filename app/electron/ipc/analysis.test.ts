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

// The parser logic itself is now @sound-buddy/audio-engine's job (#151), and
// as of TD-010 (#404) so is the sox/ffprobe/spectrum/ebur128 fan-out — both
// covered by that package's own tests. What belongs to the app is: does the
// handler resolve bundled-vs-PATH options and thread them into
// engine.analyzeAudio, forward its per-stage progress onto the renderer's UI
// stage names, forward noSpectrum, and translate success/cancel/error
// outcomes. The four wrapper exports are tested directly further down.
const runSoxMock = vi.fn();
const runFfprobeMock = vi.fn();
const runSpectrumMock = vi.fn();
const runEbur128Mock = vi.fn();
const analyzeAudioMock = vi.fn();
vi.mock('./engine-loader', () => ({
  loadEngineParsers: () => ({
    runSox: runSoxMock,
    runFfprobe: runFfprobeMock,
    runSpectrum: runSpectrumMock,
    runEbur128: runEbur128Mock,
    parseEbur128Summary: vi.fn(),
    analyzeAudio: analyzeAudioMock,
  }),
}));

import { registerAnalysisHandlers, runSox, runFfprobe, runSpectrum, runEbur128 } from './analysis';
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
const ANALYSIS_STUB = {
  filePath: '/tmp/service.wav',
  sox: SOX_STUB,
  ffprobe: FFPROBE_STUB,
  spectrum: SPECTRUM_STUB,
  loudness: LOUDNESS_STUB,
};

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
  analyzeAudioMock.mockResolvedValue(ANALYSIS_STUB);
});

describe('analyze-file IPC handler', () => {
  it('calls analyzeAudio with the injected bundled-path options, signal, and observer callbacks', async () => {
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(analyzeAudioMock).toHaveBeenCalledWith('/tmp/service.wav', {
      sox: { bin: toolBin('sox') },
      ffprobe: { bin: toolBin('ffprobe') },
      spectrum: { scriptPath: SPECTRUM_SCRIPT, python: pythonBin(), env: childEnv() },
      ebur128: { bin: toolBin('ffmpeg') },
      signal: expect.any(AbortSignal),
      noSpectrum: undefined,
      onProgress: expect.any(Function),
      onEbur128Error: expect.any(Function),
    });
  });

  it('forwards onProgress stages onto renderer-facing analysis-progress "done" events, and ignores stages with no UI mapping', async () => {
    analyzeAudioMock.mockImplementation(async (_filePath: string, opts: { onProgress?: (stage: string) => void }) => {
      opts.onProgress?.('sox');
      opts.onProgress?.('ffprobe');
      opts.onProgress?.('spectrum');
      opts.onProgress?.('ebur128'); // no UI_STAGE mapping — must not send anything
      return ANALYSIS_STUB;
    });
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    await handler({ sender }, { filePath: '/tmp/service.wav' });

    const progress = sender.sent.filter((s) => s.channel === 'analysis-progress').map((s) => s.payload);
    expect(progress).toContainEqual({ stage: 'reading', status: 'start' });
    expect(progress).toContainEqual({ stage: 'levels', status: 'start' });
    expect(progress).toContainEqual({ stage: 'spectrum', status: 'start' });
    expect(progress).toContainEqual({ stage: 'levels', status: 'done' });
    expect(progress).toContainEqual({ stage: 'reading', status: 'done' });
    expect(progress).toContainEqual({ stage: 'spectrum', status: 'done' });
    // 3 "start" + 3 "done" — the ebur128 progress call produced no extra event.
    expect(progress).toHaveLength(6);

    const results = sender.sent.filter((s) => s.channel === 'analysis-result');
    expect(results).toHaveLength(1);
  });

  it('invokes onEbur128Error, which logs — exercising the injected callback body', async () => {
    const boom = new Error('ffmpeg not found');
    analyzeAudioMock.mockImplementation(
      async (_filePath: string, opts: { onEbur128Error?: (err: unknown) => void }) => {
        opts.onEbur128Error?.(boom);
        return ANALYSIS_STUB;
      },
    );
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const result = await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
  });

  it('forwards noSpectrum: true to analyzeAudio', async () => {
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    await handler({ sender }, { filePath: '/tmp/service.wav', noSpectrum: true });

    expect(analyzeAudioMock).toHaveBeenCalledWith('/tmp/service.wav', expect.objectContaining({ noSpectrum: true }));
  });

  it('resolves { success: true, data } with the analysis analyzeAudio resolved', async () => {
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const result = await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
  });

  it('resolves { success: false, cancelled: true } when analyzeAudio rejects with an AbortError', async () => {
    analyzeAudioMock.mockRejectedValueOnce(abortError());
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const result = await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(result).toEqual({ success: false, cancelled: true });
  });

  it('resolves { success: false, error } when analyzeAudio rejects with a plain error', async () => {
    analyzeAudioMock.mockRejectedValueOnce(new Error('boom'));
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const result = await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(result).toEqual({ success: false, error: 'Error: boom' });
  });
});

describe('parser wrappers', () => {
  it('runSox injects the bundled sox bin and passed signal', async () => {
    const controller = new AbortController();
    await runSox('/tmp/service.wav', controller.signal);
    expect(runSoxMock).toHaveBeenCalledWith('/tmp/service.wav', { bin: toolBin('sox'), signal: controller.signal });
  });

  it('runFfprobe injects the bundled ffprobe bin and passed signal', async () => {
    const controller = new AbortController();
    await runFfprobe('/tmp/service.wav', controller.signal);
    expect(runFfprobeMock).toHaveBeenCalledWith('/tmp/service.wav', {
      bin: toolBin('ffprobe'),
      signal: controller.signal,
    });
  });

  it('runSpectrum injects the bundled script/python/env and passed signal', async () => {
    const controller = new AbortController();
    await runSpectrum('/tmp/service.wav', controller.signal);
    expect(runSpectrumMock).toHaveBeenCalledWith('/tmp/service.wav', {
      scriptPath: SPECTRUM_SCRIPT,
      python: pythonBin(),
      env: childEnv(),
      signal: controller.signal,
    });
  });

  it('runEbur128 injects the bundled ffmpeg bin and passed signal', async () => {
    const controller = new AbortController();
    await runEbur128('/tmp/service.wav', controller.signal);
    expect(runEbur128Mock).toHaveBeenCalledWith('/tmp/service.wav', { bin: toolBin('ffmpeg'), signal: controller.signal });
  });
});
