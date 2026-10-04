// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The header Record take (#1648): Main (the board's mix out) + Measurement
// (the room / crowd mic) — two sources, each mono or stereo, never a
// multitrack rig. Each source is its own stream.py record process (the
// existing --session-dir record mode, one armed stem) writing into
// `<take>/main` and `<take>/measurement`, so the two inputs can live on
// different devices. Both run on slots of their own: start-live (Session) and
// start-measurement (the Live RTA listen) are never touched, so recording can
// neither stop nor retarget the live analyzer. Meter lines from these
// processes are dropped — the RTA is fed only by its own stream. See ADR-0160.

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { log, logWarn, logError } from '../logger';
import { isEntitled } from '../license';
import { pythonBin, childEnv, STREAM_SCRIPT } from './shared';
import { buildSessionDir, ensureMicrophoneAccess } from './live-capture';
import { loadEngineParsers, loadEngineUtils, type LiveOptions } from './engine-loader';
import { createPythonStreamSlot, type PythonStreamSlot } from './python-stream';
import type { RecordTakeFiles, RecordTakeSource, StartRecordTakeOpts } from './api';

type SourceKey = keyof RecordTakeFiles;

// Sub-folder + stem label per source, in spawn order.
const SOURCES: ReadonlyArray<{ key: SourceKey; subdir: string; label: string }> = [
  { key: 'main', subdir: 'main', label: 'Main' },
  { key: 'measurement', subdir: 'measurement', label: 'Measurement' },
];

const BUSY_ERROR = 'A recording is already running — press Stop first, then Record again.';
const NOT_ENTITLED_ERROR = 'Recording requires a Pro license.';
const MIC_DENIED_ERROR =
  'Microphone access is not granted. Enable it in System Settings ▸ Privacy & Security ▸ Microphone, then try again.';

function newSlot(): PythonStreamSlot {
  return createPythonStreamSlot({
    log,
    logWarn,
    logError,
    readNdjsonLines: (source, onLine) => loadEngineUtils().readNdjsonLines(source, onLine),
  });
}

const slots: Record<SourceKey, PythonStreamSlot> = { main: newSlot(), measurement: newSlot() };
// The running take's folder; null while idle.
let takeDir: string | null = null;

// stream.py options for one source: a single armed strip recorded into its
// own session folder.
export function sourceStreamOptions(
  source: RecordTakeSource,
  sessionDir: string,
  label: string,
  windowSecs: number,
  intervalSecs: number | undefined,
): LiveOptions {
  return {
    device: source.device,
    windowSecs,
    intervalSecs,
    channels: [source.channels],
    sessionDir,
    armTokens: [source.channels],
    labels: [label],
  };
}

// The absolute stem path a finalized session folder holds, or null. stream.py
// writes session.json last, after every stem header is closed, so its presence
// marks a coherent stem.
export function stemFromManifest(sessionDir: string, readFile: (p: string) => string): string | null {
  try {
    const manifest = JSON.parse(readFile(path.join(sessionDir, 'session.json'))) as { tracks?: { file?: unknown }[] };
    const file = manifest.tracks?.[0]?.file;
    return typeof file === 'string' && file !== '' ? path.join(sessionDir, file) : null;
  } catch {
    return null;
  }
}

export function registerRecordTakeHandlers(): void {
  ipcMain.handle('start-record-take', async (_event, opts: StartRecordTakeOpts) => {
    if (takeDir !== null) return { success: false, error: BUSY_ERROR };
    // Same Pro gate as start-live — enforced here so it holds even if the
    // renderer's CSS gating is bypassed.
    if (!isEntitled('live-monitoring')) return { success: false, error: NOT_ENTITLED_ERROR };

    const micAccess = await ensureMicrophoneAccess(true);
    if (micAccess !== 'granted') {
      logWarn(`start-record-take blocked: microphone access is "${micAccess}"`);
      return { success: false, micAccess, error: MIC_DENIED_ERROR };
    }

    let dir: string;
    try {
      dir = buildSessionDir(opts.recordDir);
    } catch (err) {
      logError('start-record-take: could not prepare recording folder', err);
      return {
        success: false,
        error: `Could not prepare the recording folder (${String(err)}) — pick a writable folder in Settings ▸ Storage, then press Record again.`,
      };
    }
    takeDir = dir;

    for (const { key, subdir, label } of SOURCES) {
      const source = opts[key];
      const args = loadEngineParsers().buildStreamArgs(
        sourceStreamOptions(source, path.join(dir, subdir), label, opts.windowSecs, opts.intervalSecs),
      );
      log(`start-record-take: spawned ${key} stream.py (device="${source.device ?? ''}" channels=${source.channels})`);
      slots[key].start({
        command: pythonBin(),
        args: [STREAM_SCRIPT, ...args],
        env: childEnv(),
        label: `record-take:${key}`,
        // Meter ticks are dropped: recording never feeds the Live RTA.
        onLine: () => {},
        onExit: ({ code, expected }) => {
          if (!expected) logWarn(`record-take:${key}: stream.py ended before Stop (code ${code})`);
        },
      });
    }
    return { success: true };
  });

  ipcMain.handle('stop-record-take', async () => {
    const dir = takeDir;
    takeDir = null;
    const files: RecordTakeFiles = { main: null, measurement: null };
    if (dir === null) return { success: true, takeDir: null, files };

    // SIGTERM makes each stream.py close its stem and write session.json;
    // stop() waits for the exit (force-killing after a grace period).
    await Promise.all(SOURCES.map(({ key }) => slots[key].stop()));
    for (const { key, subdir } of SOURCES) {
      files[key] = stemFromManifest(path.join(dir, subdir), (p) => fs.readFileSync(p, 'utf8'));
    }
    const saved = files.main !== null || files.measurement !== null;
    return { success: true, takeDir: saved ? dir : null, files };
  });
}
