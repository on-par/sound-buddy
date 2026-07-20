// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// File-analysis domain (#225 split of the former monolithic ipc.ts): the
// analyze-file IPC handler and the bundled demo-audio lookup used by the
// first-run onboarding flow (#69). The sox/ffprobe/spectrum/ebur128 parsing
// itself lives in @sound-buddy/audio-engine (#151) — the functions below are
// thin wrappers that resolve the bundled-vs-PATH binary/script paths (via
// ./shared) and the cancellation AbortSignal, then delegate to the engine's
// CJS build loaded by ./engine-loader.

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { log, logError } from '../logger';
import { recordTelemetryEvent } from '../telemetry';
import { saveAnalysisSummary, listAnalysisSummaries, setAnalysisSummaryNote, type AnalysisSummary } from '../storage';
import { toolBin, pythonBin, childEnv, SPECTRUM_SCRIPT, DEMO_AUDIO, defaultRecordDir } from './shared';
import { MAX_NOTE_LENGTH, type AnalyzeFileOpts, type SetSummaryNoteInput } from './api';
import { loadEngineParsers } from './engine-loader';
import { runAnalysis } from './run-analysis';
import type {
  SoxStats,
  FfprobeResult,
  SpectrumResult,
  SpectrumFrame,
  SpectrumSegment,
  LoudnessStats,
  AudioAnalysis,
} from '@sound-buddy/audio-engine/dist-cjs/types';

export type { SoxStats, FfprobeResult, SpectrumResult, SpectrumFrame, SpectrumSegment, LoudnessStats, AudioAnalysis };

// ─── Parser wrappers ────────────────────────────────────────────────────────
// Same exported names/signatures as before #151 so ipc.ts's re-exports, the
// parser drift-guard test, and the analyze-file handler below stay unchanged
// consumers. Each wrapper injects the bundled-vs-PATH binary/script path (the
// one genuinely environment-dependent bit) into the engine's parameterized
// parser.

export async function runSox(filePath: string, signal?: AbortSignal): Promise<SoxStats> {
  return loadEngineParsers().runSox(filePath, { bin: toolBin('sox'), signal });
}

export async function runFfprobe(filePath: string, signal?: AbortSignal): Promise<FfprobeResult> {
  return loadEngineParsers().runFfprobe(filePath, { bin: toolBin('ffprobe'), signal });
}

export async function runSpectrum(filePath: string, signal?: AbortSignal): Promise<SpectrumResult> {
  return loadEngineParsers().runSpectrum(filePath, {
    scriptPath: SPECTRUM_SCRIPT,
    python: pythonBin(),
    env: childEnv(),
    signal,
  });
}

export async function runEbur128(filePath: string, signal?: AbortSignal): Promise<LoudnessStats> {
  return loadEngineParsers().runEbur128(filePath, { bin: toolBin('ffmpeg'), signal });
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────

// One in-flight run per renderer (webContents id), so a Cancel click aborts
// the run started by that same renderer.
const inFlight = new Map<number, AbortController>();

// The single folder save-analysis-summary writes to and list-analysis-summaries
// reads from — factored out so the two handlers can never drift onto different
// paths.
function historyDir(): string {
  return path.join(defaultRecordDir(), 'history');
}

export function registerAnalysisHandlers(): void {
  // analyze-file
  ipcMain.handle('analyze-file', async (event, opts: AnalyzeFileOpts) => {
    const { filePath } = opts;
    const wc = event.sender;
    // Supersede any run still in flight for this renderer (e.g. a second
    // analyze-file triggered via File > Open while one is running) instead of
    // silently overwriting its AbortController and orphaning it — the
    // superseded run's own catch block below sees the abort and resolves
    // cleanly as `cancelled`.
    inFlight.get(wc.id)?.abort();
    const controller = new AbortController();
    inFlight.set(wc.id, controller);
    recordTelemetryEvent('analysis_started');

    // Stage progress (#125): all three stages genuinely run in parallel
    // (Promise.all below), so report them starting together and check each
    // off independently as its subprocess returns — no fake 1→2→3 march.
    const send = (data: { stage?: string; status: string }) => {
      if (!wc.isDestroyed()) wc.send('analysis-progress', data);
    };
    send({ stage: 'reading', status: 'start' });
    send({ stage: 'levels', status: 'start' });
    send({ stage: 'spectrum', status: 'start' });

    try {
      const outcome = await runAnalysis(filePath, {
        engine: loadEngineParsers(),
        tools: {
          soxBin: toolBin('sox'),
          ffprobeBin: toolBin('ffprobe'),
          ffmpegBin: toolBin('ffmpeg'),
          spectrumScript: SPECTRUM_SCRIPT,
          python: pythonBin(),
          env: childEnv(),
        },
        signal: controller.signal,
        onStage: (stage) => send({ stage, status: 'done' }),
        log,
        logError,
      });
      if (outcome.success) {
        wc.send('analysis-result', { type: 'stats', data: outcome.data });
        recordTelemetryEvent('analysis_completed');
      }
      return outcome;
    } finally {
      // Only clear this run's own entry — a supersede above may already have
      // replaced it with a newer run's controller.
      if (inFlight.get(wc.id) === controller) inFlight.delete(wc.id);
    }
  });

  // cancel-analysis — aborts the in-flight run started by this renderer, if any.
  ipcMain.handle('cancel-analysis', (event) => {
    const controller = inFlight.get(event.sender.id);
    if (!controller) return { success: false };
    controller.abort();
    return { success: true };
  });

  // get-demo-audio — path to the bundled demo recording the first-run onboarding
  // flow (#69) analyzes with one click. Returns null if the asset is missing so
  // the renderer can fall back to the file picker rather than erroring.
  ipcMain.handle('get-demo-audio', () => {
    return fs.existsSync(DEMO_AUDIO) ? DEMO_AUDIO : null;
  });

  // save-analysis-summary (#146) — persist a small report-card summary under the
  // configured storage folder so the recent-services list (#147) has a history to
  // read. Write-only; the renderer computes grade/score, main stamps the ISO date
  // and writes. A failure (permissions, full disk) is logged and swallowed: the
  // report card must still display, so this never throws back to the renderer.
  ipcMain.handle('save-analysis-summary', async (_event, payload: Omit<AnalysisSummary, 'date'>) => {
    try {
      const summary: AnalysisSummary = {
        date: new Date().toISOString(),
        sourceFilename: String(payload?.sourceFilename ?? ''),
        gradeLetter: String(payload?.gradeLetter ?? ''),
        score: Number(payload?.score ?? 0),
        recordingType: String(payload?.recordingType ?? ''),
        topFixes: Array.isArray(payload?.topFixes) ? payload.topFixes.map(String) : [],
        // Spread-omit (not `note: ''`) so a no-note record is byte-identical
        // to today's — the renderer doesn't supply one up front yet, but a
        // future caller might (#267).
        ...(payload?.note ? { note: String(payload.note).trim().slice(0, MAX_NOTE_LENGTH) } : {}),
        // Same spread-omit for source (#261): a file-analysis record stays
        // byte-identical to today's — only a live-capture session payload
        // adds the key.
        ...(payload?.source === 'live' ? { source: 'live' as const } : {}),
      };
      const file = await saveAnalysisSummary(historyDir(), summary);
      log(`saved analysis summary: ${file}`);
      return { success: true, file: path.basename(file) };
    } catch (err) {
      logError('save-analysis-summary failed', err);
      return { success: false, error: String(err) };
    }
  });

  // list-analysis-summaries (#147) — the last 10 persisted report-card summaries,
  // newest-first, for the Recent Services list. A failure (permissions, corrupt
  // folder) is logged and returned as an empty list rather than thrown, so the
  // Recent tab always has an empty state to fall back to instead of an error.
  ipcMain.handle('list-analysis-summaries', async () => {
    try {
      return { success: true, summaries: await listAnalysisSummaries(historyDir(), 10) };
    } catch (err) {
      logError('list-analysis-summaries failed', err);
      return { success: false, error: String(err), summaries: [] };
    }
  });

  // set-analysis-summary-note (#267) — patch a single already-saved record's
  // optional handoff note. Never throws to the renderer: a bad/stale file
  // reference (deleted history, storage-folder change mid-session) is logged
  // and reported as a normal failure result instead.
  ipcMain.handle('set-analysis-summary-note', async (_event, payload: SetSummaryNoteInput) => {
    try {
      await setAnalysisSummaryNote(historyDir(), String(payload?.file ?? ''), String(payload?.note ?? ''));
      return { success: true };
    } catch (err) {
      logError('set-analysis-summary-note failed', err);
      return { success: false, error: String(err) };
    }
  });
}
