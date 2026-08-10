// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// One deep module owning the Python child-process transport that
// live-capture.ts, measurement-source.ts, and playback.ts each used to
// hand-copy: spawn with the shared stdio/env conventions, forward NDJSON
// stdout lines, log stderr, and stop with SIGTERM followed by a SIGKILL after
// a grace period (#744). Domain policy (argv, entitlement gates, session-dir
// bookkeeping, event channel names) stays in each of those three modules —
// this file knows nothing about Electron, IPC channels, or webContents, so it
// is fully testable with a fake EventEmitter-based child process.
//
// The identity-guarded `close` listener below is what makes the orphaned-
// process race (a rapid restart's OLD child clobbering the NEW child's
// handle) impossible by construction: `start()` always registers its
// persistent `close` listener before any later `stop()` can register its own
// `once('close', ...)`, so a stale child from a prior start() can never touch
// the handle a later start() already installed.

import { spawn } from 'child_process';
import type { NdjsonSource } from '@sound-buddy/audio-engine/dist-cjs/ndjson';

export type PythonStreamSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: ['ignore', 'pipe', 'pipe']; env: NodeJS.ProcessEnv },
) => PythonStreamChild;

export interface PythonStreamChild {
  stdout: NdjsonSource;
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown };
  on(event: string, listener: (...a: unknown[]) => void): unknown;
  once(event: string, listener: (...a: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type PythonStreamReadNdjsonLines = (
  source: NdjsonSource,
  onLine: (data: Record<string, unknown>) => void,
) => void;

export interface PythonStreamDeps {
  spawn?: PythonStreamSpawn;
  readNdjsonLines: PythonStreamReadNdjsonLines;
  log: (msg: string) => void;
  logWarn: (msg: string, ...extra: unknown[]) => void;
  logError: (msg: string, ...extra: unknown[]) => void;
}

export interface PythonStreamExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  expected: boolean;
}

export interface PythonStreamStartOptions {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  label: string;
  onLine: (data: Record<string, unknown>) => void;
  onError?: (err: Error) => void;
  onExit: (info: PythonStreamExitInfo) => void;
}

export interface PythonStreamStopResult {
  closedCleanly: boolean;
}

export interface PythonStreamSlot {
  start(opts: PythonStreamStartOptions): void;
  stop(graceMs?: number): Promise<PythonStreamStopResult>;
  isRunning(): boolean;
}

export const DEFAULT_STOP_GRACE_MS = 2000;

// child_process.spawn's overload set doesn't structurally narrow to
// PythonStreamChild without a cast, even though a real
// ChildProcessWithoutNullStreams satisfies every member of that interface at
// runtime.
function defaultSpawn(
  command: string,
  args: readonly string[],
  options: { stdio: ['ignore', 'pipe', 'pipe']; env: NodeJS.ProcessEnv },
): PythonStreamChild {
  return spawn(command, args as string[], options) as unknown as PythonStreamChild;
}

export function createPythonStreamSlot(deps: PythonStreamDeps): PythonStreamSlot {
  const spawnFn = deps.spawn ?? defaultSpawn;
  let current: PythonStreamChild | null = null;
  let stopRequested = false;

  function start(opts: PythonStreamStartOptions): void {
    if (current) current.kill();

    const py = spawnFn(opts.command, opts.args, { stdio: ['ignore', 'pipe', 'pipe'], env: opts.env });
    current = py;
    stopRequested = false;

    py.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) deps.logWarn(`${opts.label} stderr: ${text}`);
    });

    deps.readNdjsonLines(py.stdout, opts.onLine);

    py.on('error', (...a: unknown[]) => {
      const err = a[0] as Error;
      deps.logError(`${opts.label}: process error`, err);
      opts.onError?.(err);
    });

    py.on('close', (...a: unknown[]) => {
      const code = a[0] as number | null;
      const signal = a[1] as NodeJS.Signals | null;
      if (current !== py) return; // superseded by a later start(); stale, ignore
      current = null;
      const expected = stopRequested;
      stopRequested = false;
      opts.onExit({ code, signal, expected });
    });
  }

  function stop(graceMs = DEFAULT_STOP_GRACE_MS): Promise<PythonStreamStopResult> {
    const proc = current;
    if (!proc) return Promise.resolve({ closedCleanly: false });
    stopRequested = true;
    return new Promise<PythonStreamStopResult>((resolve) => {
      let settled = false;
      const settle = (closedCleanly: boolean) => {
        if (settled) return;
        settled = true;
        resolve({ closedCleanly });
      };
      proc.once('close', () => settle(true));
      proc.kill(); // SIGTERM
      setTimeout(() => {
        if (!settled) {
          deps.logWarn('python-stream: process did not exit in time; sending SIGKILL');
          try {
            proc.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }
        settle(false);
      }, graceMs);
    });
  }

  return { start, stop, isRunning: () => current !== null };
}
