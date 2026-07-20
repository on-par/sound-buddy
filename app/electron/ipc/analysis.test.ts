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
const isVideoFileMock = vi.fn();
const extractAudioToWavMock = vi.fn();
vi.mock('./engine-loader', () => ({
  loadEngineParsers: () => ({
    runSox: runSoxMock,
    runFfprobe: runFfprobeMock,
    runSpectrum: runSpectrumMock,
    runEbur128: runEbur128Mock,
    parseEbur128Summary: vi.fn(),
    analyzeAudio: analyzeAudioMock,
    isVideoFile: isVideoFileMock,
    extractAudioToWav: extractAudioToWavMock,
  }),
}));

const recordTelemetryEventMock = vi.hoisted(() => vi.fn());
vi.mock('../telemetry', () => ({
  recordTelemetryEvent: recordTelemetryEventMock,
}));

// save-analysis-summary / list-analysis-summaries delegate to storage.ts, which
// has its own test suite (storage.test.ts) — here we only assert the handlers
// call it with the right folder/args and translate its resolution/rejection.
const saveAnalysisSummaryMock = vi.hoisted(() => vi.fn());
const listAnalysisSummariesMock = vi.hoisted(() => vi.fn());
const setAnalysisSummaryNoteMock = vi.hoisted(() => vi.fn());
vi.mock('../storage', () => ({
  saveAnalysisSummary: saveAnalysisSummaryMock,
  listAnalysisSummaries: listAnalysisSummariesMock,
  setAnalysisSummaryNote: setAnalysisSummaryNoteMock,
}));

const logErrorMock = vi.hoisted(() => vi.fn());
vi.mock('../logger', () => ({ log: vi.fn(), logError: logErrorMock }));

// Partial fs mock: the existing temp-cleanup tests below write/check REAL files
// under os.tmpdir(), so this must pass through to the actual module by default
// and only be overridden per-test via mockImplementationOnce/mockReturnValueOnce.
const { existsSyncSpy, rmSyncSpy } = vi.hoisted(() => ({ existsSyncSpy: vi.fn(), rmSyncSpy: vi.fn() }));
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  existsSyncSpy.mockImplementation(actual.existsSync);
  rmSyncSpy.mockImplementation(actual.rmSync);
  return { ...actual, existsSync: existsSyncSpy, rmSync: rmSyncSpy };
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { registerAnalysisHandlers, runSox, runFfprobe, runSpectrum, runEbur128 } from './analysis';
import { toolBin, pythonBin, childEnv, SPECTRUM_SCRIPT, DEMO_AUDIO, defaultRecordDir } from './shared';

/** A minimal event-sender (renderer webContents) that records `send` calls. */
function fakeSender(opts: { destroyed?: boolean } = {}) {
  return {
    id: 1,
    isDestroyed: () => opts.destroyed ?? false,
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
  isVideoFileMock.mockReturnValue(false);
  extractAudioToWavMock.mockResolvedValue('/tmp/sb-extract-abc123.wav');
  saveAnalysisSummaryMock.mockResolvedValue('/tmp/sound-buddy-test/history/x.json');
  listAnalysisSummariesMock.mockResolvedValue([]);
  setAnalysisSummaryNoteMock.mockResolvedValue(undefined);
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

  it('skips analysis-progress sends to a destroyed webContents but still sends analysis-result and resolves normally', async () => {
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender({ destroyed: true });

    const result = await handler({ sender }, { filePath: '/tmp/service.wav' });

    expect(sender.sent.filter((s) => s.channel === 'analysis-progress')).toHaveLength(0);
    expect(sender.sent.filter((s) => s.channel === 'analysis-result')).toHaveLength(1);
    expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
  });

  it('supersedes an in-flight run for the same renderer, aborting the first and letting the second complete', async () => {
    analyzeAudioMock.mockImplementationOnce(
      (_path: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(abortError()));
        }),
    );
    const handler = handlers.get('analyze-file') as AnalyzeHandler;
    const sender = fakeSender();

    const firstRun = handler({ sender }, { filePath: '/tmp/a.wav' });
    const secondResult = await handler({ sender }, { filePath: '/tmp/b.wav' });

    expect(secondResult).toEqual({ success: true, data: ANALYSIS_STUB });
    await expect(firstRun).resolves.toEqual({ success: false, cancelled: true });
  });

  describe('telemetry (#474)', () => {
    it('records analysis_started on entry, always', async () => {
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      await handler({ sender }, { filePath: '/tmp/service.wav' });

      expect(recordTelemetryEventMock).toHaveBeenCalledWith('analysis_started');
    });

    it('records analysis_completed on success', async () => {
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      await handler({ sender }, { filePath: '/tmp/service.wav' });

      expect(recordTelemetryEventMock).toHaveBeenCalledWith('analysis_completed');
    });

    it('does not record analysis_completed on cancellation', async () => {
      analyzeAudioMock.mockRejectedValueOnce(abortError());
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      await handler({ sender }, { filePath: '/tmp/service.wav' });

      expect(recordTelemetryEventMock).toHaveBeenCalledWith('analysis_started');
      expect(recordTelemetryEventMock).not.toHaveBeenCalledWith('analysis_completed');
    });

    it('does not record analysis_completed on error', async () => {
      analyzeAudioMock.mockRejectedValueOnce(new Error('boom'));
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      await handler({ sender }, { filePath: '/tmp/service.wav' });

      expect(recordTelemetryEventMock).toHaveBeenCalledWith('analysis_started');
      expect(recordTelemetryEventMock).not.toHaveBeenCalledWith('analysis_completed');
    });
  });

  describe('video pre-extraction', () => {
    it('extracts audio and analyzes the extracted wav when the file is a video', async () => {
      isVideoFileMock.mockReturnValue(true);
      extractAudioToWavMock.mockResolvedValue('/tmp/sb-extract-abc123.wav');
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      const result = await handler({ sender }, { filePath: '/tmp/service.mp4' });

      expect(isVideoFileMock).toHaveBeenCalledWith('/tmp/service.mp4');
      expect(extractAudioToWavMock).toHaveBeenCalledWith('/tmp/service.mp4', {
        bin: toolBin('ffmpeg'),
        signal: expect.any(AbortSignal),
      });
      expect(analyzeAudioMock).toHaveBeenCalledWith('/tmp/sb-extract-abc123.wav', expect.anything());
      expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
    });

    it('never calls extractAudioToWav for a non-video file', async () => {
      isVideoFileMock.mockReturnValue(false);
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      await handler({ sender }, { filePath: '/tmp/service.wav' });

      expect(extractAudioToWavMock).not.toHaveBeenCalled();
      expect(analyzeAudioMock).toHaveBeenCalledWith('/tmp/service.wav', expect.anything());
    });

    it('removes the extracted temp wav after a successful analysis', async () => {
      const extractedPath = path.join(os.tmpdir(), 'sb-extract-cleanup-success.wav');
      fs.writeFileSync(extractedPath, '');
      isVideoFileMock.mockReturnValue(true);
      extractAudioToWavMock.mockResolvedValue(extractedPath);
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      await handler({ sender }, { filePath: '/tmp/service.mp4' });

      expect(fs.existsSync(extractedPath)).toBe(false);
    });

    it('removes the extracted temp wav even when analyzeAudio fails', async () => {
      const extractedPath = path.join(os.tmpdir(), 'sb-extract-cleanup-failure.wav');
      fs.writeFileSync(extractedPath, '');
      isVideoFileMock.mockReturnValue(true);
      extractAudioToWavMock.mockResolvedValue(extractedPath);
      analyzeAudioMock.mockRejectedValueOnce(new Error('boom'));
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      const result = await handler({ sender }, { filePath: '/tmp/service.mp4' });

      expect(result).toEqual({ success: false, error: 'Error: boom' });
      expect(fs.existsSync(extractedPath)).toBe(false);
    });

    it('resolves { success: false, error } with the actionable message when extraction fails', async () => {
      isVideoFileMock.mockReturnValue(true);
      extractAudioToWavMock.mockRejectedValueOnce(
        new Error('Could not extract an audio track from "service.mp4" — make sure the video has sound, or export the audio as a WAV and analyze that instead'),
      );
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      const result = await handler({ sender }, { filePath: '/tmp/service.mp4' });

      expect(result).toEqual({
        success: false,
        error: 'Error: Could not extract an audio track from "service.mp4" — make sure the video has sound, or export the audio as a WAV and analyze that instead',
      });
      expect(analyzeAudioMock).not.toHaveBeenCalled();
    });

    it('resolves { success: false, cancelled: true } when extraction is aborted', async () => {
      isVideoFileMock.mockReturnValue(true);
      extractAudioToWavMock.mockRejectedValueOnce(abortError());
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      const result = await handler({ sender }, { filePath: '/tmp/service.mp4' });

      expect(result).toEqual({ success: false, cancelled: true });
      expect(analyzeAudioMock).not.toHaveBeenCalled();
    });

    it('logs but does not fail the analysis when removing the extracted temp file throws', async () => {
      isVideoFileMock.mockReturnValue(true);
      rmSyncSpy.mockImplementationOnce(() => {
        throw new Error('EACCES');
      });
      const handler = handlers.get('analyze-file') as AnalyzeHandler;
      const sender = fakeSender();

      const result = await handler({ sender }, { filePath: '/tmp/service.mp4' });

      expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
      expect(logErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/sb-extract-abc123.wav'),
        expect.any(Error),
      );
    });
  });
});

type CancelHandler = (event: { sender: { id: number } }) => { success: boolean };
type GetDemoAudioHandler = () => string | null;
type SaveSummaryHandler = (
  event: unknown,
  payload?: Record<string, unknown>,
) => Promise<{ success: boolean; error?: string; file?: string }>;
type ListSummariesHandler = () => Promise<{ success: boolean; summaries: unknown[]; error?: string }>;
type SetSummaryNoteHandler = (
  event: unknown,
  payload?: Record<string, unknown>,
) => Promise<{ success: boolean; error?: string }>;

describe('cancel-analysis IPC handler', () => {
  it('resolves { success: false } when no run is in flight for this renderer', () => {
    const handler = handlers.get('cancel-analysis') as CancelHandler;
    const sender = fakeSender();

    const result = handler({ sender });

    expect(result).toEqual({ success: false });
  });

  it('aborts the in-flight run for this renderer and resolves { success: true }, letting the run resolve cancelled', async () => {
    analyzeAudioMock.mockImplementationOnce(
      (_path: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(abortError()));
        }),
    );
    const analyzeHandler = handlers.get('analyze-file') as AnalyzeHandler;
    const cancelHandler = handlers.get('cancel-analysis') as CancelHandler;
    const sender = fakeSender();

    const runPromise = analyzeHandler({ sender }, { filePath: '/tmp/a.wav' });
    const cancelResult = cancelHandler({ sender });

    expect(cancelResult).toEqual({ success: true });
    await expect(runPromise).resolves.toEqual({ success: false, cancelled: true });
  });
});

describe('get-demo-audio IPC handler', () => {
  it('returns DEMO_AUDIO when the bundled asset exists on disk', () => {
    existsSyncSpy.mockReturnValueOnce(true);
    const handler = handlers.get('get-demo-audio') as GetDemoAudioHandler;

    const result = handler();

    expect(result).toBe(DEMO_AUDIO);
    expect(existsSyncSpy).toHaveBeenCalledWith(DEMO_AUDIO);
  });

  it('returns null when the bundled asset is missing', () => {
    existsSyncSpy.mockReturnValueOnce(false);
    const handler = handlers.get('get-demo-audio') as GetDemoAudioHandler;

    const result = handler();

    expect(result).toBeNull();
  });
});

describe('save-analysis-summary IPC handler', () => {
  it('saves the summary under the history folder with a stamped ISO date', async () => {
    const handler = handlers.get('save-analysis-summary') as SaveSummaryHandler;

    const result = await handler(undefined, {
      sourceFilename: 'sunday.wav',
      gradeLetter: 'B',
      score: 87,
      recordingType: 'service',
      topFixes: ['cut 400Hz'],
    });

    expect(saveAnalysisSummaryMock).toHaveBeenCalledWith(
      path.join(defaultRecordDir(), 'history'),
      expect.objectContaining({
        sourceFilename: 'sunday.wav',
        gradeLetter: 'B',
        score: 87,
        recordingType: 'service',
        topFixes: ['cut 400Hz'],
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
    expect(result).toEqual({ success: true, file: 'x.json' });
    expect(result.file).not.toMatch(/[/\\]/);
  });

  it('persists a trimmed, clamped note when the payload supplies one (#267)', async () => {
    const handler = handlers.get('save-analysis-summary') as SaveSummaryHandler;

    await handler(undefined, {
      sourceFilename: 'sunday.wav',
      gradeLetter: 'B',
      score: 87,
      recordingType: 'service',
      topFixes: [],
      note: `  ${'x'.repeat(500)}  `,
    });

    expect(saveAnalysisSummaryMock).toHaveBeenCalledWith(
      path.join(defaultRecordDir(), 'history'),
      expect.objectContaining({ note: 'x'.repeat(200) }),
    );
  });

  it('writes a record with no note key at all when the payload has no note (#267)', async () => {
    const handler = handlers.get('save-analysis-summary') as SaveSummaryHandler;

    await handler(undefined, {
      sourceFilename: 'sunday.wav',
      gradeLetter: 'B',
      score: 87,
      recordingType: 'service',
      topFixes: [],
    });

    const written = saveAnalysisSummaryMock.mock.calls[0][1];
    expect('note' in written).toBe(false);
  });

  it('defaults every field to its empty/zero value when the payload is undefined', async () => {
    const handler = handlers.get('save-analysis-summary') as SaveSummaryHandler;

    await handler(undefined, undefined);

    expect(saveAnalysisSummaryMock).toHaveBeenCalledWith(
      path.join(defaultRecordDir(), 'history'),
      expect.objectContaining({
        sourceFilename: '',
        gradeLetter: '',
        score: 0,
        recordingType: '',
        topFixes: [],
      }),
    );
  });

  it('coerces a non-array topFixes to [] and a numeric-string score to a number, even with a truthy payload', async () => {
    const handler = handlers.get('save-analysis-summary') as SaveSummaryHandler;

    await handler(undefined, {
      sourceFilename: 'x.wav',
      gradeLetter: 'A',
      score: '92',
      recordingType: 'rehearsal',
      topFixes: 'not-an-array',
    });

    expect(saveAnalysisSummaryMock).toHaveBeenCalledWith(
      path.join(defaultRecordDir(), 'history'),
      expect.objectContaining({ score: 92, topFixes: [] }),
    );
  });

  it('resolves { success: false, error } and logs when storage rejects', async () => {
    saveAnalysisSummaryMock.mockRejectedValueOnce(new Error('disk full'));
    const handler = handlers.get('save-analysis-summary') as SaveSummaryHandler;

    const result = await handler(undefined, {
      sourceFilename: 'a.wav',
      gradeLetter: 'A',
      score: 90,
      recordingType: 'service',
      topFixes: [],
    });

    expect(result).toEqual({ success: false, error: 'Error: disk full' });
    expect(logErrorMock).toHaveBeenCalled();
  });
});

describe('list-analysis-summaries IPC handler', () => {
  it('resolves the summaries returned by storage, reading the history folder with limit 10', async () => {
    const summaries = [
      {
        date: '2026-07-19T00:00:00.000Z',
        sourceFilename: 'a.wav',
        gradeLetter: 'A',
        score: 95,
        recordingType: 'service',
        topFixes: [],
      },
    ];
    listAnalysisSummariesMock.mockResolvedValueOnce(summaries);
    const handler = handlers.get('list-analysis-summaries') as ListSummariesHandler;

    const result = await handler();

    expect(listAnalysisSummariesMock).toHaveBeenCalledWith(path.join(defaultRecordDir(), 'history'), 10);
    expect(result).toEqual({ success: true, summaries });
  });

  it('resolves { success: false, error, summaries: [] } and logs when storage rejects', async () => {
    listAnalysisSummariesMock.mockRejectedValueOnce(new Error('EACCES'));
    const handler = handlers.get('list-analysis-summaries') as ListSummariesHandler;

    const result = await handler();

    expect(result).toEqual({ success: false, error: 'Error: EACCES', summaries: [] });
    expect(logErrorMock).toHaveBeenCalled();
  });
});

describe('set-analysis-summary-note IPC handler', () => {
  it('delegates to storage with the history folder, file, and note, and resolves { success: true }', async () => {
    const handler = handlers.get('set-analysis-summary-note') as SetSummaryNoteHandler;

    const result = await handler(undefined, { file: 'x.json', note: 'used the new wireless pack today' });

    expect(setAnalysisSummaryNoteMock).toHaveBeenCalledWith(
      path.join(defaultRecordDir(), 'history'),
      'x.json',
      'used the new wireless pack today',
    );
    expect(result).toEqual({ success: true });
  });

  it('resolves { success: false, error } and logs, without throwing, when storage rejects', async () => {
    setAnalysisSummaryNoteMock.mockRejectedValueOnce(new Error('History record "missing.json" is missing or unreadable — the note was not saved.'));
    const handler = handlers.get('set-analysis-summary-note') as SetSummaryNoteHandler;

    const result = await handler(undefined, { file: 'missing.json', note: 'x' });

    expect(result).toEqual({
      success: false,
      error: 'Error: History record "missing.json" is missing or unreadable — the note was not saved.',
    });
    expect(logErrorMock).toHaveBeenCalled();
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
