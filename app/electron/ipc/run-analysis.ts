// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, Electron-free run orchestration extracted from the analyze-file IPC
// handler (#275): video-detection + audio extraction, the analyzeAudio option
// assembly, the AnalyzeStage -> UI stage mapping, success/cancel/error
// translation, and scratch-WAV cleanup. Everything environment-dependent is
// injected so this is unit-testable without a fake Electron event.sender.

import * as fs from 'fs';
import { isAbortError } from './timeout';
import type { AudioAnalysis } from '@sound-buddy/audio-engine/dist-cjs/types';
import type { AnalyzeStage, AnalyzeAudioOptions } from '@sound-buddy/audio-engine/dist-cjs/analyze/orchestrate';

export type UiStage = 'reading' | 'levels' | 'spectrum';

/** AnalyzeStage → renderer-facing UI stage. `ebur128` is deliberately absent:
 *  it has no progress row in the UI. */
export const UI_STAGE: Partial<Record<AnalyzeStage, UiStage>> = {
  ffprobe: 'reading',
  sox: 'levels',
  spectrum: 'spectrum',
};

/** The engine surface runAnalysis needs — a structural subset of EngineParsers
 *  so callers can pass loadEngineParsers() directly and tests can pass stubs. */
export interface AnalysisEngine {
  isVideoFile: (filePath: string) => boolean;
  extractAudioToWav: (filePath: string, opts: { bin: string; signal?: AbortSignal }) => Promise<string>;
  analyzeAudio: (filePath: string, opts: AnalyzeAudioOptions) => Promise<AudioAnalysis>;
}

/** Resolved bundled-vs-PATH tool locations, injected by the IPC adapter. */
export interface AnalysisTools {
  soxBin: string;
  ffprobeBin: string;
  ffmpegBin: string;
  spectrumScript: string;
  python: string;
  env: NodeJS.ProcessEnv;
}

export interface RunAnalysisOptions {
  engine: AnalysisEngine;
  tools: AnalysisTools;
  noSpectrum?: boolean;
  signal?: AbortSignal;
  /** Called once per completed stage that has a UI row. */
  onStage?: (stage: UiStage) => void;
  log: (msg: string) => void;
  logError: (msg: string, err: unknown) => void;
  /** Injected so tests can assert cleanup without touching disk.
   *  Defaults to fs.rmSync(p, { force: true }). */
  removeFile?: (filePath: string) => void;
}

export type AnalysisOutcome =
  | { success: true; data: AudioAnalysis }
  | { success: false; cancelled: true }
  | { success: false; error: string };

export async function runAnalysis(filePath: string, opts: RunAnalysisOptions): Promise<AnalysisOutcome> {
  const { tools } = opts;
  let analyzePath = filePath;
  let extractedWav: string | null = null;

  try {
    if (opts.engine.isVideoFile(filePath)) {
      opts.log(`analyze-file extracting audio from video: ${filePath}`);
      extractedWav = await opts.engine.extractAudioToWav(filePath, { bin: opts.tools.ffmpegBin, signal: opts.signal });
      analyzePath = extractedWav;
    }

    const analysis = await opts.engine.analyzeAudio(analyzePath, {
      sox: { bin: tools.soxBin },
      ffprobe: { bin: tools.ffprobeBin },
      spectrum: { scriptPath: tools.spectrumScript, python: tools.python, env: tools.env },
      ebur128: { bin: tools.ffmpegBin },
      signal: opts.signal,
      noSpectrum: opts.noSpectrum,
      onProgress: (stage) => {
        const ui = UI_STAGE[stage];
        if (ui) opts.onStage?.(ui);
      },
      onEbur128Error: (err) => opts.log(`ebur128 unavailable for ${filePath}: ${String(err)}`),
    });

    opts.log(`analyze-file ok: ${filePath}`);
    return { success: true, data: analysis };
  } catch (err) {
    if (isAbortError(err)) {
      // No terminal progress event here: the renderer that started this
      // specific run already learns of the cancellation from this
      // invoke()'s own resolution (`result.cancelled`) — a stage-keyed
      // 'done'/'start' event has nowhere to attach without a stage.
      opts.log(`analyze-file cancelled: ${filePath}`);
      return { success: false, cancelled: true };
    }
    opts.logError(`analyze-file failed for ${filePath}`, err);
    return { success: false, error: String(err) };
  } finally {
    // The extracted WAV is a scratch intermediate — remove it regardless of
    // outcome. Best-effort: a removal failure (already gone, permissions)
    // must not shadow the real success/error result above.
    if (extractedWav) {
      try {
        (opts.removeFile ?? ((p: string) => fs.rmSync(p, { force: true })))(extractedWav);
      } catch (err) {
        opts.logError(`failed to remove extracted audio temp file ${extractedWav}`, err);
      }
    }
  }
}
