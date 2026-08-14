// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, Electron-free orchestration of the Soundcheck per-track waveform-peak
// generation step (#734): cache key/freshness math plus the spawn-and-read flow
// that drives packages/audio-engine/scripts/waveform_peaks.py. Everything
// environment-dependent (python path, script path, env, cache dir, python
// child slot, fs stat/readFile/mkdir, logger) is injected — the run-analysis.ts
// pattern — so this module is unit-testable without a fake Electron
// event.sender. The module-level `peaksSlot` is the one ADR-0010 slot that
// owns the waveform-peaks child's lifecycle; playback.ts's thin handler injects
// it into runWaveformPeaks.

import * as path from 'path';
import { createHash } from 'crypto';
import { log, logWarn, logError } from '../logger';
import { createPythonStreamSlot } from './python-stream';
import { loadEngineUtils } from './engine-loader';
import type { PythonStreamExitInfo, PythonStreamSlot } from './python-stream';
import type { SessionPeaksDto } from './api';

export type { SessionPeaksDto, TrackPeaksDto } from './api';

/** The IPC envelope the renderer receives. `cached` distinguishes a fresh
 *  on-disk cache hit from a freshly generated document. */
export type WaveformPeaksOutcome =
  | { success: true; cached: boolean; peaks: SessionPeaksDto }
  | { success: false; error: string };

/** Injected capabilities runWaveformPeaks needs — no electron, no global fs. */
export interface WaveformPeaksRunOptions {
  python: string;
  script: string;
  env: NodeJS.ProcessEnv;
  cacheDir: string;
  slot: PythonStreamSlot;
  stat: (p: string) => number | null;
  readFile: (p: string) => string;
  mkdir: (p: string) => void;
  log: (m: string) => void;
  logWarn: (m: string) => void;
  logError: (m: string, ...extra: unknown[]) => void;
  onProgress?: (line: Record<string, unknown>) => void;
}

/** The waveform-peaks child (waveform_peaks.py), held at module scope like
 *  playback.ts's playbackSlot so the Python child-process lifecycle stays in
 *  one place (ADR-0010). playback.ts's thin handler injects this into
 *  runWaveformPeaks. */
export const peaksSlot = createPythonStreamSlot({
  log,
  logWarn,
  logError,
  readNdjsonLines: (source, onLine) => loadEngineUtils().readNdjsonLines(source, onLine),
});

/** argv passed to waveform_peaks.py (the script path is prepended by the
 *  caller, mirroring playback.ts's [PLAYBACK_SCRIPT, ...args]). */
export function buildWaveformPeaksArgs(sessionDir: string, outPath: string): string[] {
  return [sessionDir, '--out', outPath];
}

/** Deterministic cache file for a session dir: a short sha256 of the dir under
 *  the cache root, so app-owned writes stay under userData (never a sidecar in
 *  the user's session folder). */
export function peakCachePathFor(sessionDir: string, cacheDir: string): string {
  return path.join(
    cacheDir,
    createHash('sha256').update(sessionDir).digest('hex').slice(0, 24) + '.json',
  );
}

/** A cache is fresh when it exists and is newer than (or as new as) every
 *  source file. A missing source (null mtime) means stale — a re-capture or an
 *  edited stem must force regeneration. */
export function isPeakCacheFresh(cacheMtime: number | null, sourceMtimes: (number | null)[]): boolean {
  if (cacheMtime === null) return false;
  return sourceMtimes.every((m) => m !== null && m <= cacheMtime);
}

/**
 * Generate (or serve from a fresh cache) the per-track peak document for a
 * Soundcheck session. Never spawns when session.json is unreadable or has no
 * tracks; a fresh cache short-circuits the Python decode entirely.
 */
export async function runWaveformPeaks(
  sessionDir: string,
  opts: WaveformPeaksRunOptions,
): Promise<WaveformPeaksOutcome> {
  const cachePath = peakCachePathFor(sessionDir, opts.cacheDir);

  let tracks: Array<{ file?: string }>;
  try {
    const manifest = JSON.parse(opts.readFile(path.join(sessionDir, 'session.json'))) as {
      tracks?: Array<{ file?: string }>;
    };
    if (!manifest || !Array.isArray(manifest.tracks) || manifest.tracks.length === 0) {
      throw new Error('session.json has no tracks array');
    }
    tracks = manifest.tracks;
  } catch (err) {
    return { success: false, error: `Could not read session.json: ${(err as Error).message}` };
  }

  const cacheMtime = opts.stat(cachePath);
  const sessionMtime = opts.stat(path.join(sessionDir, 'session.json'));
  const stemMtimes = tracks.map((t) => opts.stat(path.join(sessionDir, t.file ?? '')));

  if (isPeakCacheFresh(cacheMtime, [sessionMtime, ...stemMtimes])) {
    opts.log('generate-session-peaks: serving fresh cache');
    const peaks = JSON.parse(opts.readFile(cachePath)) as SessionPeaksDto;
    return { success: true, cached: true, peaks };
  }

  opts.mkdir(opts.cacheDir);
  opts.log(`generate-session-peaks: spawning waveform_peaks.py for ${sessionDir}`);

  const exit = await new Promise<PythonStreamExitInfo>((resolve) => {
    opts.slot.start({
      command: opts.python,
      args: [opts.script, ...buildWaveformPeaksArgs(sessionDir, cachePath)],
      env: opts.env,
      label: 'generate-session-peaks',
      onLine: (data) => opts.onProgress?.(data),
      onError: (err) => {
        opts.logError('generate-session-peaks: process error', err);
        resolve({ code: null, signal: null, expected: false });
      },
      onExit: (info) => resolve(info),
    });
  });

  if (exit.code !== 0) {
    return { success: false, error: `waveform peak generation failed (exit ${exit.code}).` };
  }

  try {
    const peaks = JSON.parse(opts.readFile(cachePath)) as SessionPeaksDto;
    return { success: true, cached: false, peaks };
  } catch (err) {
    return { success: false, error: `Could not read generated peaks: ${(err as Error).message}` };
  }
}
