// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Live-capture domain (#225 split of the former monolithic ipc.ts): Core Audio
// device enumeration, the microphone-permission gate, session-folder naming
// for Record mode, and the start-live/stop-live IPC handlers that drive
// stream.py.

import { ipcMain, systemPreferences } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { log, logWarn, logError } from '../logger';
import { getSettings } from '../settings';
import { isEntitled } from '../license';
import { pythonBin, childEnv, STREAM_SCRIPT, defaultRecordDir } from './shared';
import { streamLLM, buildLiveReport } from './narrative';
import type { StartLiveOpts } from './api';

let liveProcess: ChildProcess | null = null;
let liveIntervalTimer: NodeJS.Timeout | null = null;
// Directory of the current/last multitrack session (Record mode) — per-strip
// stems + session.json — so stop-live can hand it back to the renderer. null in
// Monitor mode.
let liveSessionDir: string | null = null;

// A timestamp like 20260703-143207-512, stable within one capture. Milliseconds
// keep two captures started in the same second from colliding on one folder.
export function captureStamp(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}` +
    `-${String(now.getMilliseconds()).padStart(3, '0')}`
  );
}

// Compute a timestamped session *folder* path inside the chosen (or default)
// record folder — stream.py fills it with one stem WAV per armed strip and a
// session.json, and creates the folder itself when capture actually starts.
// Only the shared parent is created here (so a bad recordDir surfaces a friendly
// error up front); the per-capture child is left to stream.py so a failed or
// aborted start never leaves an empty session folder behind. The main process
// owns the path so stop-live can hand the folder back once session.json exists.
export function buildSessionDir(dir?: string): string {
  const target = dir && dir.trim() ? dir : defaultRecordDir();
  fs.mkdirSync(target, { recursive: true });
  return path.join(target, `sound-buddy-${captureStamp()}`);
}

// ─── Microphone (Core Audio) permission ─────────────────────────────────────
type MicAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

// macOS gates Core Audio microphone capture behind TCC. Device *enumeration*
// works without it, but capture (start-live) yields silence unless the app holds
// the grant — and the Python child that actually records is attributed to this
// app as the responsible process.
//
// `prompt` controls whether an undecided ('not-determined') state triggers the
// system permission dialog. Listing devices only *reads* the status (no dialog,
// so opening the Live tab never surprises the user or blocks automation); the
// dialog is requested lazily from start-live, when the user actively records.
async function ensureMicrophoneAccess(prompt: boolean): Promise<MicAccess> {
  if (process.platform !== 'darwin') return 'granted';
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return 'granted';
  if (status === 'not-determined') {
    if (!prompt) return 'not-determined';
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      log(`microphone access ${granted ? 'granted' : 'denied'} by user`);
      return granted ? 'granted' : 'denied';
    } catch (err) {
      logWarn(`microphone access request failed: ${String(err)}`);
      return 'unknown';
    }
  }
  return status as MicAccess; // 'denied' | 'restricted'
}

// ─── Device enumeration ─────────────────────────────────────────────────────

export interface DeviceListResult {
  success: boolean;
  devices?: unknown[];
  error?: string;
}

// Spawn stream.py with an enumeration flag and resolve the parsed device list.
// Shared by list-devices and list-output-devices: same stdout/stderr collection,
// close/error handling, and JSON-parse guard. Callers layer on any extra fields
// (e.g. list-devices' micAccess). Never rejects — enumeration failures surface as
// { success: false, error } so the renderer can degrade gracefully. `label`
// prefixes log lines so the two callers stay distinguishable.
export function enumerateDevices(
  flag: '--list-devices' | '--list-output-devices',
  label: string,
): Promise<DeviceListResult> {
  return new Promise<DeviceListResult>((resolve) => {
    let output = '';
    let errOutput = '';
    const py = spawn(pythonBin(), [STREAM_SCRIPT, flag], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    });

    py.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    // stderr was previously piped but never read (lost errors + risked backpressure).
    py.stderr.on('data', (chunk: Buffer) => { errOutput += chunk.toString(); });

    py.on('close', (code, signal) => {
      if (code !== 0 && !output.trim()) {
        // A signal kill (OOM, SIGTERM on app quit) reports code === null; name the
        // signal instead of surfacing a bare "exited with code null" to the picker.
        const reason = code === null ? `terminated by signal ${signal}` : `exited with code ${code}`;
        logError(`${label}: stream.py ${reason}`, errOutput.trim() || undefined);
        resolve({ success: false, error: `stream.py ${reason}` });
        return;
      }
      try {
        const parsed = JSON.parse(output.trim()) as { devices?: unknown[] };
        if (errOutput.trim()) logWarn(`${label} stderr: ${errOutput.trim()}`);
        resolve({ success: true, devices: parsed.devices ?? [] });
      } catch (err) {
        logError(`${label}: failed to parse device list`, errOutput.trim() || err);
        resolve({ success: false, error: 'Failed to parse device list' });
      }
    });

    py.on('error', (err) => {
      logError(`${label}: failed to spawn ${pythonBin()}`, err);
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────

export function registerLiveCaptureHandlers(): void {
  // list-devices
  ipcMain.handle('list-devices', async () => {
    // Read (don't prompt for) the Core Audio permission alongside enumeration.
    // Enumeration works without the grant; reporting the status lets the renderer
    // distinguish a blocked mic from genuinely absent input hardware.
    const micAccess = await ensureMicrophoneAccess(false);
    const result = await enumerateDevices('--list-devices', 'list-devices');
    return { ...result, micAccess };
  });

  // list-output-devices — playback devices for the virtual-soundcheck output
  // picker (#44). Mirrors list-devices but carries no micAccess: choosing an
  // output interface doesn't touch the microphone grant.
  ipcMain.handle('list-output-devices', () =>
    enumerateDevices('--list-output-devices', 'list-output-devices'));

  // start-live
  ipcMain.handle('start-live', async (event, opts: StartLiveOpts) => {
    // Live monitoring is a Pro feature (#54) — enforce in the main process so
    // the gate holds even if the renderer's CSS gating is bypassed.
    if (!isEntitled('live-monitoring')) {
      return { success: false, error: 'Live monitoring requires a Pro license.' };
    }

    // Clear any stale session dir up front so a failed/aborted start (e.g. mic
    // denied below) can't leave a prior capture's folder to be offered on stop.
    liveSessionDir = null;

    // Refuse to "record" silence: a denied Core Audio grant means stream.py
    // captures nothing. This is the user-initiated moment, so prompt if the
    // permission hasn't been decided yet, then block if it isn't granted.
    const micAccess = await ensureMicrophoneAccess(true);
    if (micAccess !== 'granted') {
      logWarn(`start-live blocked: microphone access is "${micAccess}"`);
      return {
        success: false,
        micAccess,
        error:
          'Microphone access is not granted. Enable it in System Settings ▸ Privacy & Security ▸ Microphone, then try again.',
      };
    }

    if (liveProcess) {
      liveProcess.kill();
      liveProcess = null;
    }

    const args: string[] = [];
    if (opts.device) args.push(opts.device);
    else args.push('');
    args.push(String(opts.windowSecs));
    if (opts.channels && opts.channels.length > 0) {
      args.push(opts.channels.join(','));
    } else {
      args.push('');
    }

    if (opts.intervalSecs && opts.intervalSecs > 0) {
      args.push('--interval', String(opts.intervalSecs));
    }

    // Record mode: derive a session folder and tell stream.py to capture one
    // stem per armed strip into it (plus session.json). Arm tokens select which
    // strips; omitted ⇒ stream.py arms all configured strips.
    if (opts.mode === 'record') {
      try {
        liveSessionDir = buildSessionDir(opts.recordDir);
        args.push('--session-dir', liveSessionDir);
        if (opts.arm && opts.arm.length > 0) {
          args.push('--arm', opts.arm.join(','));
        }
      } catch (err) {
        logError('start-live: could not prepare recording folder', err);
        return { success: false, error: `Could not prepare recording folder: ${String(err)}` };
      }
    }

    const py = spawn(pythonBin(), [STREAM_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    });
    log(`start-live: spawned stream.py (device="${opts.device ?? ''}" window=${opts.windowSecs}s interval=${opts.intervalSecs ?? 0.1}s mode=${opts.mode ?? 'monitor'} llmInterval=${opts.llmIntervalSecs}s)`);

    liveProcess = py;
    const wc = event.sender;
    const windowCollector: unknown[] = [];

    // stderr was previously piped but never read (lost errors + risked backpressure).
    py.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) logWarn(`start-live stderr: ${text}`);
    });

    let lineBuffer = '';
    py.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as Record<string, unknown>;
          // Forward to renderer
          if (!wc.isDestroyed()) {
            wc.send('live-event', data);
          }
          // Collect for LLM
          if ('window' in data) {
            windowCollector.push(data);
            if (windowCollector.length > 10) windowCollector.shift();
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    py.on('error', (err: Error) => {
      logError('start-live: stream.py process error', err);
      if (!wc.isDestroyed()) {
        wc.send('live-event', { error: err.message });
      }
    });

    py.on('close', (code: number | null) => {
      liveProcess = null;
      if (code !== 0 && code !== null) {
        logError(`start-live: stream.py exited with code ${code}`);
        if (!wc.isDestroyed()) {
          wc.send('live-event', { error: `stream.py exited with code ${code}` });
        }
      } else {
        log('start-live: stream.py closed cleanly');
      }
    });

    // LLM interval timer
    if (liveIntervalTimer) {
      clearInterval(liveIntervalTimer);
      liveIntervalTimer = null;
    }

    if (opts.llmIntervalSecs > 0 && getSettings().aiEnabled) {
      liveIntervalTimer = setInterval(async () => {
        if (windowCollector.length === 0 || wc.isDestroyed()) return;
        // Entitlement can lapse mid-capture (grace period ending). Skip the
        // tick silently — streamLLM's lock message is for explicit requests;
        // repeating it every interval would spam the AI panel.
        if (!isEntitled('ai-narrative')) return;
        const snapshot = [...windowCollector];

        const systemPrompt = `You are a professional audio engineer monitoring a live mix. You are given consecutive analysis windows. Identify trends, flag developing problems (frequency buildup, approaching clipping, dynamic issues), and give real-time mixing recommendations. Be concise — this is live monitoring.`;
        const userMessage = buildLiveReport(snapshot);

        try {
          await streamLLM(wc, systemPrompt, userMessage);
        } catch {
          // non-fatal
        }
      }, opts.llmIntervalSecs * 1000);
    }

    return { success: true };
  });

  // stop-live
  ipcMain.handle('stop-live', async () => {
    if (liveIntervalTimer) {
      clearInterval(liveIntervalTimer);
      liveIntervalTimer = null;
    }
    const proc = liveProcess;
    liveProcess = null;
    const sessionDirPath = liveSessionDir;
    liveSessionDir = null;

    let closedCleanly = false;
    if (proc) {
      // SIGTERM triggers stream.py's signal handler, which closes every stem
      // header and writes session.json. Wait for the child to actually exit
      // before we inspect the folder, so we never offer a half-written session.
      // If it doesn't exit in time, force-kill it (so the mic is released and the
      // process isn't orphaned) and don't offer the possibly-incomplete session.
      closedCleanly = await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
        proc.once('close', () => settle(true));
        proc.kill(); // SIGTERM
        setTimeout(() => {
          if (!settled) {
            logWarn('stop-live: stream.py did not exit in time; sending SIGKILL');
            try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          }
          settle(false);
        }, 2000);
      });
    }

    // Only offer the session if the child finalized cleanly and actually wrote a
    // manifest — session.json is the completion marker (stream.py writes it last,
    // after every stem header is closed), so its presence means the folder holds
    // a coherent, movable session.
    let sessionDir: string | null = null;
    if (sessionDirPath && closedCleanly) {
      try {
        if (fs.statSync(path.join(sessionDirPath, 'session.json')).isFile()) {
          sessionDir = sessionDirPath;
        }
      } catch {
        // no manifest written (record failed to start, or captured nothing)
      }
    }
    return { success: true, sessionDir };
  });
}
