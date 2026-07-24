// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Virtual-soundcheck playback domain (#225 split of the former monolithic
// ipc.ts): reveal/read a captured session folder and drive playback.py for
// the Virtual Soundcheck feature (#45/#46).

import { ipcMain, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { log, logWarn, logError } from '../logger';
import { isEntitled } from '../license';
import { pythonBin, childEnv, PLAYBACK_SCRIPT, readNdjsonLines } from './shared';
import type { StartPlaybackOpts } from './api';

// The current virtual-soundcheck playback child (playback.py). Held at module
// scope — like start-live's liveProcess — so stop-playback can SIGTERM it for
// a clean close.
let playbackProcess: ChildProcess | null = null;

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

    // A new playback replaces any in-flight one — SIGTERM the old child so its
    // finalize() closes the stream before we open a second one on the device.
    if (playbackProcess) {
      playbackProcess.kill();
      playbackProcess = null;
    }

    const args: string[] = [opts.sessionDir];
    if (opts.device) args.push('--device', opts.device);
    if (opts.route) args.push('--route', opts.route);
    if (opts.intervalSecs && opts.intervalSecs > 0) {
      args.push('--interval', String(opts.intervalSecs));
    }
    if (opts.master) args.push('--master');

    const py = spawn(pythonBin(), [PLAYBACK_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    });
    log(`start-playback: spawned playback.py (session="${opts.sessionDir}" device="${opts.device ?? ''}" route="${opts.route ?? ''}" master=${opts.master ?? false})`);

    playbackProcess = py;
    const wc = event.sender;

    py.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) logWarn(`start-playback stderr: ${text}`);
    });

    readNdjsonLines(py.stdout, (data) => {
      if (!wc.isDestroyed()) {
        wc.send('playback-event', data);
      }
    });

    py.on('error', (err: Error) => {
      logError('start-playback: playback.py process error', err);
      if (!wc.isDestroyed()) {
        wc.send('playback-event', { error: err.message });
      }
    });

    py.on('close', (code: number | null) => {
      // Only clear the handle if this child is still the current one — a rapid
      // restart may have already replaced it.
      if (playbackProcess === py) playbackProcess = null;
      if (code !== 0 && code !== null) {
        logError(`start-playback: playback.py exited with code ${code}`);
        if (!wc.isDestroyed()) {
          wc.send('playback-event', { error: `playback.py exited with code ${code}` });
        }
      } else {
        log('start-playback: playback.py closed cleanly');
      }
    });

    return { success: true };
  });

  // stop-playback — SIGTERM the playback child so playback.py's signal handler
  // closes the output stream cleanly; SIGKILL as a fallback if it doesn't exit.
  ipcMain.handle('stop-playback', async () => {
    const proc = playbackProcess;
    playbackProcess = null;
    if (!proc) return { success: true };

    await new Promise<void>((resolveStop) => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolveStop(); } };
      proc.once('close', settle);
      proc.kill(); // SIGTERM
      setTimeout(() => {
        if (!settled) {
          logWarn('stop-playback: playback.py did not exit in time; sending SIGKILL');
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        }
        settle();
      }, 2000);
    });
    return { success: true };
  });
}
