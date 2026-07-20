// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runAnalysis, UI_STAGE, type AnalysisEngine, type AnalysisTools } from './run-analysis';

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
} as unknown as import('@sound-buddy/audio-engine/dist-cjs/types').AudioAnalysis;

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function fakeTools(): AnalysisTools {
  return {
    soxBin: '/bin/sox',
    ffprobeBin: '/bin/ffprobe',
    ffmpegBin: '/bin/ffmpeg',
    spectrumScript: '/scripts/spectrum.py',
    python: '/bin/python3',
    env: { PATH: '/usr/bin' },
  };
}

function fakeEngine(overrides: Partial<AnalysisEngine> = {}): AnalysisEngine {
  return {
    isVideoFile: vi.fn().mockReturnValue(false),
    extractAudioToWav: vi.fn().mockResolvedValue('/tmp/sb-extract-abc123.wav'),
    analyzeAudio: vi.fn().mockResolvedValue(ANALYSIS_STUB),
    ...overrides,
  };
}

describe('runAnalysis', () => {
  it('resolves { success: true, data } and calls analyzeAudio with the exact injected option object', async () => {
    const engine = fakeEngine();
    const tools = fakeTools();
    const log = vi.fn();
    const logError = vi.fn();
    const signal = new AbortController().signal;

    const result = await runAnalysis('/tmp/service.wav', { engine, tools, signal, log, logError });

    expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
    expect(engine.analyzeAudio).toHaveBeenCalledWith('/tmp/service.wav', {
      sox: { bin: tools.soxBin },
      ffprobe: { bin: tools.ffprobeBin },
      spectrum: { scriptPath: tools.spectrumScript, python: tools.python, env: tools.env },
      ebur128: { bin: tools.ffmpegBin },
      signal,
      onProgress: expect.any(Function),
      onEbur128Error: expect.any(Function),
    });
  });

  it('maps sox/ffprobe/spectrum onProgress stages to UI stages and ignores ebur128', async () => {
    const seen: string[] = [];
    const engine = fakeEngine({
      analyzeAudio: vi.fn().mockImplementation(async (_path: string, opts: { onProgress?: (s: string) => void }) => {
        opts.onProgress?.('sox');
        opts.onProgress?.('ffprobe');
        opts.onProgress?.('spectrum');
        opts.onProgress?.('ebur128');
        return ANALYSIS_STUB;
      }),
    });
    const onStage = vi.fn((s: string) => seen.push(s));

    await runAnalysis('/tmp/service.wav', { engine, tools: fakeTools(), onStage, log: vi.fn(), logError: vi.fn() });

    expect(seen).toEqual(['levels', 'reading', 'spectrum']);
    expect(UI_STAGE.ebur128).toBeUndefined();
  });

  it('does not throw when onStage is omitted', async () => {
    const engine = fakeEngine({
      analyzeAudio: vi.fn().mockImplementation(async (_path: string, opts: { onProgress?: (s: string) => void }) => {
        opts.onProgress?.('sox');
        return ANALYSIS_STUB;
      }),
    });

    await expect(
      runAnalysis('/tmp/service.wav', { engine, tools: fakeTools(), log: vi.fn(), logError: vi.fn() }),
    ).resolves.toEqual({ success: true, data: ANALYSIS_STUB });
  });

  it('does not pass a noSpectrum key to analyzeAudio', async () => {
    const engine = fakeEngine();

    await runAnalysis('/tmp/service.wav', {
      engine,
      tools: fakeTools(),
      log: vi.fn(),
      logError: vi.fn(),
    });

    const passedOpts = (engine.analyzeAudio as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(Object.keys(passedOpts)).not.toContain('noSpectrum');
  });

  it('resolves { success: false, cancelled: true } on abort, without calling logError', async () => {
    const controller = new AbortController();
    const engine = fakeEngine({
      analyzeAudio: vi.fn().mockImplementation(
        (_path: string, opts: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => reject(abortError()));
          }),
      ),
    });
    const logError = vi.fn();

    const promise = runAnalysis('/tmp/service.wav', {
      engine,
      tools: fakeTools(),
      signal: controller.signal,
      log: vi.fn(),
      logError,
    });
    controller.abort();

    await expect(promise).resolves.toEqual({ success: false, cancelled: true });
    expect(logError).not.toHaveBeenCalled();
  });

  it('resolves { success: false, error } and calls logError once when analyzeAudio rejects with a plain error', async () => {
    const engine = fakeEngine({ analyzeAudio: vi.fn().mockRejectedValue(new Error('sox exploded')) });
    const logError = vi.fn();

    const result = await runAnalysis('/tmp/service.wav', { engine, tools: fakeTools(), log: vi.fn(), logError });

    expect(result).toEqual({ success: false, error: 'Error: sox exploded' });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  describe('video pre-extraction', () => {
    it('extracts audio and analyzes the extracted wav, then removes it on success', async () => {
      const removeFile = vi.fn();
      const engine = fakeEngine({
        isVideoFile: vi.fn().mockReturnValue(true),
        extractAudioToWav: vi.fn().mockResolvedValue('/tmp/sb-extract-abc123.wav'),
      });
      const tools = fakeTools();
      const signal = new AbortController().signal;

      const result = await runAnalysis('/tmp/service.mp4', {
        engine,
        tools,
        signal,
        removeFile,
        log: vi.fn(),
        logError: vi.fn(),
      });

      expect(engine.extractAudioToWav).toHaveBeenCalledWith('/tmp/service.mp4', { bin: tools.ffmpegBin, signal });
      expect(engine.analyzeAudio).toHaveBeenCalledWith('/tmp/sb-extract-abc123.wav', expect.anything());
      expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
      expect(removeFile).toHaveBeenCalledWith('/tmp/sb-extract-abc123.wav');
    });

    it('removes the extracted wav even when analyzeAudio fails', async () => {
      const removeFile = vi.fn();
      const engine = fakeEngine({
        isVideoFile: vi.fn().mockReturnValue(true),
        analyzeAudio: vi.fn().mockRejectedValue(new Error('boom')),
      });

      const result = await runAnalysis('/tmp/service.mp4', {
        engine,
        tools: fakeTools(),
        removeFile,
        log: vi.fn(),
        logError: vi.fn(),
      });

      expect(result).toEqual({ success: false, error: 'Error: boom' });
      expect(removeFile).toHaveBeenCalledWith('/tmp/sb-extract-abc123.wav');
    });

    it('removes the extracted wav even when the run is cancelled', async () => {
      const removeFile = vi.fn();
      const controller = new AbortController();
      const engine = fakeEngine({
        isVideoFile: vi.fn().mockReturnValue(true),
        analyzeAudio: vi.fn().mockImplementation(
          (_path: string, opts: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              // extractAudioToWav has already resolved by the time this mock
              // runs, so the signal may already be aborted — check first
              // rather than relying solely on a future 'abort' event.
              if (opts.signal?.aborted) {
                reject(abortError());
                return;
              }
              opts.signal?.addEventListener('abort', () => reject(abortError()));
            }),
        ),
      });

      const promise = runAnalysis('/tmp/service.mp4', {
        engine,
        tools: fakeTools(),
        signal: controller.signal,
        removeFile,
        log: vi.fn(),
        logError: vi.fn(),
      });
      controller.abort();

      await expect(promise).resolves.toEqual({ success: false, cancelled: true });
      expect(removeFile).toHaveBeenCalledWith('/tmp/sb-extract-abc123.wav');
    });

    it('swallows a removeFile failure and still returns the success outcome, logging the removal error', async () => {
      const removeFile = vi.fn().mockImplementation(() => {
        throw new Error('EACCES');
      });
      const engine = fakeEngine({ isVideoFile: vi.fn().mockReturnValue(true) });
      const logError = vi.fn();

      const result = await runAnalysis('/tmp/service.mp4', {
        engine,
        tools: fakeTools(),
        removeFile,
        log: vi.fn(),
        logError,
      });

      expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('/tmp/sb-extract-abc123.wav'), expect.any(Error));
    });

    it('swallows a removeFile failure and still returns the error outcome, logging the removal error', async () => {
      const removeFile = vi.fn().mockImplementation(() => {
        throw new Error('EACCES');
      });
      const engine = fakeEngine({
        isVideoFile: vi.fn().mockReturnValue(true),
        analyzeAudio: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const logError = vi.fn();

      const result = await runAnalysis('/tmp/service.mp4', {
        engine,
        tools: fakeTools(),
        removeFile,
        log: vi.fn(),
        logError,
      });

      expect(result).toEqual({ success: false, error: 'Error: boom' });
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('/tmp/sb-extract-abc123.wav'), expect.any(Error));
      expect(logError).toHaveBeenCalledWith('analyze-file failed for /tmp/service.mp4', expect.any(Error));
    });

    it('uses the default fs.rmSync-based removeFile when none is injected', async () => {
      const extractedPath = path.join(os.tmpdir(), 'sb-run-analysis-default-cleanup.wav');
      fs.writeFileSync(extractedPath, '');
      const engine = fakeEngine({
        isVideoFile: vi.fn().mockReturnValue(true),
        extractAudioToWav: vi.fn().mockResolvedValue(extractedPath),
      });

      const result = await runAnalysis('/tmp/service.mp4', { engine, tools: fakeTools(), log: vi.fn(), logError: vi.fn() });

      expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
      expect(fs.existsSync(extractedPath)).toBe(false);
    });
  });

  it('invokes onEbur128Error via log and does not change the outcome', async () => {
    const boom = new Error('ffmpeg not found');
    const engine = fakeEngine({
      analyzeAudio: vi.fn().mockImplementation(
        async (_path: string, opts: { onEbur128Error?: (err: unknown) => void }) => {
          opts.onEbur128Error?.(boom);
          return ANALYSIS_STUB;
        },
      ),
    });
    const log = vi.fn();

    const result = await runAnalysis('/tmp/service.wav', { engine, tools: fakeTools(), log, logError: vi.fn() });

    expect(result).toEqual({ success: true, data: ANALYSIS_STUB });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ebur128 unavailable for /tmp/service.wav'));
  });
});
