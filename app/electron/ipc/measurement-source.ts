// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Secondary measurement-source domain (#460, ADR 0003): a second, measurement-
// only stream.py monitor process reading a dedicated room mic (USB measurement
// mic or the Mac's built-in mic) independently of the board's multitrack
// capture. Mirrors live-capture.ts's single-process model, doubled — losing
// the mic can't perturb the board recording process, since the two child
// processes have fully independent lifecycles.
//
// This stream is metering-only: it never gets `--session-dir` and never
// produces stems (that would need sample-accurate alignment ADR 0003 defers).
// Its events travel on a separate `measurement-event` IPC channel, never mixed
// with live-capture's `live-event` (ADR 0003's event-namespacing requirement).

import { ipcMain } from 'electron';
import { log, logWarn, logError } from '../logger';
import { isEntitled } from '../license';
import { pythonBin, childEnv, STREAM_SCRIPT } from './shared';
import { ensureMicrophoneAccess } from './live-capture';
import { loadEngineParsers, loadEngineUtils } from './engine-loader';
import { createPythonStreamSlot } from './python-stream';
import type { StartMeasurementOpts } from './api';

const measurementSlot = createPythonStreamSlot({
  log,
  logWarn,
  logError,
  readNdjsonLines: (source, onLine) => loadEngineUtils().readNdjsonLines(source, onLine),
});

// The measurement source is always the device's first input, captured as one
// mono strip — it's a metering source only (a single room mic), never a
// multitrack rig, so it needs exactly one channel token and never a stereo
// pair or an arm list.
const MEASUREMENT_CHANNEL_TOKEN = '0';

export function registerMeasurementSourceHandlers(): void {
  // start-measurement — spawn the measurement-only stream.py monitor. Gated by
  // the same Pro entitlement and TCC microphone grant as start-live; a missing
  // grant is a surfaced BLOCKED state (never a silent fallback to another
  // source), and the board capture is never touched.
  ipcMain.handle('start-measurement', async (event, opts: StartMeasurementOpts) => {
    // Live monitoring is a Pro feature (#54) — enforce in the main process so
    // the gate holds even if the renderer's CSS gating is bypassed. Same gate
    // and message pattern as start-live.
    if (!isEntitled('live-monitoring')) {
      return { success: false, error: 'Live monitoring requires a Pro license.' };
    }

    // The user actively started a measurement source, so prompt if the mic
    // permission hasn't been decided yet, then BLOCK (never substitute a
    // source) if it isn't granted. stream.py would otherwise meter silence.
    const micAccess = await ensureMicrophoneAccess(true);
    if (micAccess !== 'granted') {
      logWarn(`start-measurement blocked: microphone access is "${micAccess}"`);
      return {
        success: false,
        micAccess,
        error:
          'Microphone access is not granted. Enable it in System Settings ▸ Privacy & Security ▸ Microphone, then try again.',
      };
    }

    const args = loadEngineParsers().buildStreamArgs({
      device: opts.device,
      windowSecs: opts.windowSecs,
      channels: [MEASUREMENT_CHANNEL_TOKEN],
      intervalSecs: opts.intervalSecs,
    });
    // Log the interval we actually pass; when omitted, stream.py applies its own
    // default, so say "default" rather than duplicating that value here.
    const intervalLabel = opts.intervalSecs && opts.intervalSecs > 0 ? `${opts.intervalSecs}s` : 'default';
    log(`start-measurement: spawned stream.py (device="${opts.device}" window=${opts.windowSecs}s interval=${intervalLabel})`);

    const wc = event.sender;
    measurementSlot.start({
      command: pythonBin(),
      args: [STREAM_SCRIPT, ...args],
      env: childEnv(),
      label: 'start-measurement',
      onLine: (data) => {
        if (!wc.isDestroyed()) wc.send('measurement-event', data);
      },
      onError: (err) => {
        if (!wc.isDestroyed()) wc.send('measurement-event', { error: err.message });
      },
      onExit: ({ code, expected }) => {
        // An unexpected exit (e.g. a mid-session USB unplug makes stream.py exit)
        // is the renderer's DISCONNECT trigger — a distinct, non-fatal state that
        // never touches the board capture. A clean stop needs no event.
        if (!expected) {
          logWarn(`start-measurement: stream.py ended unexpectedly (code ${code})`);
          if (!wc.isDestroyed()) wc.send('measurement-event', { measurementEnded: true, code });
        } else {
          log('start-measurement: stream.py closed after stop');
        }
      },
    });

    return { success: true };
  });

  // stop-measurement — explicit stop clears only the running stream, never the
  // persisted device preference (that lives in settings). SIGTERM, then SIGKILL
  // after a grace window if the child doesn't exit. Mirrors stop-live's
  // shutdown, minus the session-dir finalize logic (measurement never records).
  ipcMain.handle('stop-measurement', async () => {
    await measurementSlot.stop();
    return { success: true };
  });
}
