// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Virtual-soundcheck playback domain (#225 split of the former monolithic
// ipc.ts): reveal/read a captured session folder and drive playback.py for
// the Virtual Soundcheck feature (#45/#46).

import { ipcMain, shell, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { log, logWarn, logError } from '../logger';
import { isEntitled } from '../license';
import { pythonBin, childEnv, PLAYBACK_SCRIPT, WAVEFORM_PEAKS_SCRIPT } from './shared';
import { loadEngineParsers, loadEngineUtils } from './engine-loader';
import { createPythonStreamSlot } from './python-stream';
import { runWaveformPeaks, peaksSlot } from './waveform-peaks';
import type { StartPlaybackOpts, SetPlaybackRoutesOpts } from './api';

// The current virtual-soundcheck playback child (playback.py). Held at module
// scope — like start-live's liveSlot — so stop-playback can SIGTERM it for a
// clean close.
const playbackSlot = createPythonStreamSlot({
  log,
  logWarn,
  logError,
  readNdjsonLines: (source, onLine) => loadEngineUtils().readNdjsonLines(source, onLine),
});

export function registerPlaybackHandlers(): void {
  // reveal-path — open a captured session folder in the OS file manager (#43).
  // openPath opens the folder itself; returns '' on success or an error string.
  ipcMain.handle('reveal-path', async (_event, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') return { success: false, error: 'no path' };
    const err = await shell.openPath(targetPath);
    if (err) {
      logWarn(`reveal-path: ${err}`);
      return { success: false, error: err };
    }
    return { success: true };
  });

  // read-session — load a captured session's session.json manifest so the
  // Virtual Soundcheck UI (#46) can list its tracks. Read-only, renderer-driven.
  ipcMain.handle('read-session', async (_event, sessionDir: string) => {
    if (!sessionDir || typeof sessionDir !== 'string') return { success: false, error: 'No session directory provided.' };
    try {
      const raw = fs.readFileSync(path.join(sessionDir, 'session.json'), 'utf8');
      const manifest = JSON.parse(raw);
      if (!manifest || !Array.isArray(manifest.tracks)) return { success: false, error: 'session.json has no tracks.' };
      return { success: true, manifest };
    } catch (err) {
      logWarn(`read-session: ${(err as Error).message}`);
      return { success: false, error: `Could not read session.json: ${(err as Error).message}` };
    }
  });

  // start-playback — virtual soundcheck (#45). Spawn playback.py to play a
  // captured session's stems through the chosen output device with per-track
  // routing (or a stereo master fold when the device is too small / master is
  // set), forwarding its JSON-line events to the renderer as `playback-event`.
  // Modeled on start-live: a module-level process handle, line-buffered stdout,
  // SIGTERM on stop. No microphone grant (output only).
  ipcMain.handle('start-playback', async (event, opts: StartPlaybackOpts) => {
    // Virtual soundcheck is a Pro feature (#54) — enforced here as well as in
    // the renderer. Reading a session manifest stays free (data never locks).
    if (!isEntitled('virtual-soundcheck')) {
      return { success: false, error: 'Virtual soundcheck requires a Pro license.' };
    }
    if (!opts.sessionDir) {
      return { success: false, error: 'No session directory provided.' };
    }

    const args = loadEngineParsers().buildPlaybackArgs({
      sessionDir: opts.sessionDir,
      device: opts.device,
      route: opts.route,
      intervalSecs: opts.intervalSecs,
      startOffsetSecs: opts.startOffsetSecs,
      master: opts.master,
    });
    log(`start-playback: spawned playback.py (session="${opts.sessionDir}" device="${opts.device ?? ''}" route="${opts.route ?? ''}" start=${opts.startOffsetSecs ?? 0} master=${opts.master ?? false})`);

    const wc = event.sender;
    // A new playback replaces any in-flight one — playbackSlot.start() kills
    // the old child so its finalize() closes the stream before we open a
    // second one on the device.
    playbackSlot.start({
      command: pythonBin(),
      args: [PLAYBACK_SCRIPT, ...args],
      env: childEnv(),
      label: 'start-playback',
      onLine: (data) => {
        if (!wc.isDestroyed()) wc.send('playback-event', data);
      },
      onError: (err) => {
        if (!wc.isDestroyed()) wc.send('playback-event', { error: err.message });
      },
      onExit: ({ code }) => {
        if (code !== 0 && code !== null) {
          logError(`start-playback: playback.py exited with code ${code}`);
          if (!wc.isDestroyed()) wc.send('playback-event', { error: `playback.py exited with code ${code}` });
        } else {
          log('start-playback: playback.py closed cleanly');
        }
      },
    });

    return { success: true };
  });

  // generate-session-peaks — Soundcheck per-track waveform data (#734). Decode
  // every track's stem into ADR-0004 min/max peak buckets via waveform_peaks.py
  // in a background child (never blocking the renderer on a multi-minute
  // decode), cached under userData/soundcheck-peaks so re-loads are instant.
  // No Pro-gate: like read-session ("data never locks"), waveform data is
  // derived local data; the Soundcheck feature UI is already Pro-gated in the
  // renderer.
  ipcMain.handle('generate-session-peaks', async (_event, sessionDir: string) => {
    if (!sessionDir || typeof sessionDir !== 'string') {
      return { success: false, error: 'No session directory provided.' };
    }
    return runWaveformPeaks(sessionDir, {
      python: pythonBin(),
      script: WAVEFORM_PEAKS_SCRIPT,
      env: childEnv(),
      cacheDir: path.join(app.getPath('userData'), 'soundcheck-peaks'),
      slot: peaksSlot,
      stat: (p) => {
        try {
          return fs.statSync(p).mtimeMs;
        } catch {
          return null;
        }
      },
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
      log,
      logWarn,
      logError,
      onProgress: (line) => log(`generate-session-peaks: ${JSON.stringify(line)}`),
    });
  });

  // stop-playback — SIGTERM the playback child so playback.py's signal handler
  // closes the output stream cleanly; SIGKILL as a fallback if it doesn't exit.
  ipcMain.handle('stop-playback', async () => {
    await playbackSlot.stop();
    return { success: true };
  });

  // set-playback-routes — live re-route while playing (#759). Pushes the full
  // routing spec as an NDJSON set-routes command to the running playback.py
  // child's stdin; playback.py swaps the mix map atomically between blocks.
  // Fire-and-forget: no entitlement re-check (no device/lock change; we only
  // write to our own child's stdin), and { success: true } even when no child
  // is running (the slot no-ops). playback.py validates the spec itself and
  // logs a rejection to stderr — the renderer never sees a failure surface.
  ipcMain.handle('set-playback-routes', async (_event, opts: SetPlaybackRoutesOpts) => {
    if (!opts || typeof opts.route !== 'string' || !opts.route.trim()) {
      return { success: false, error: 'A routing spec is required.' };
    }
    playbackSlot.send(JSON.stringify({ type: 'set-routes', spec: opts.route }) + '\n');
    return { success: true };
  });
}
