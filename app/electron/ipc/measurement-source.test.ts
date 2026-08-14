// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// registerMeasurementSourceHandlers wires every channel into this map so a test
// can invoke a single handler directly without a live ipcMain (same pattern as
// live-capture.test.ts).
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
  app: { isPackaged: false },
}));
vi.mock('../logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
const isEntitledMock = vi.fn();
vi.mock('../license', () => ({ isEntitled: (...a: unknown[]) => isEntitledMock(...a) }));
// Stub the tool-resolution helpers so no bundled/dev Python path is touched.
vi.mock('./shared', () => ({
  pythonBin: () => 'python3',
  childEnv: () => ({}),
  STREAM_SCRIPT: '/fake/stream.py',
}));
// The TCC gate is owned by live-capture.ts (#460 reuses its exact export);
// mock it so this suite drives granted/blocked without an Electron sandbox.
const ensureMicrophoneAccessMock = vi.fn();
vi.mock('./live-capture', () => ({
  ensureMicrophoneAccess: (...a: unknown[]) => ensureMicrophoneAccessMock(...a),
}));
const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  ChildProcess: class {},
}));
// Use the REAL buildStreamArgs (from the engine's built ESM dist) instead of
// hand-copying its mapping logic (see live-capture.test.ts for the same
// pattern) — only the device/windowSecs/channels/intervalSecs branches are
// exercised here since measurement-source.ts never sets
// sessionDir/armTokens/labels.
vi.mock('./engine-loader', async () => {
  const { buildStreamArgs } = await vi.importActual<typeof import('@sound-buddy/audio-engine/dist/stream/index.js')>(
    '@sound-buddy/audio-engine/dist/stream/index.js',
  );
  const { readNdjsonLines } = await vi.importActual<typeof import('@sound-buddy/audio-engine/dist/ndjson.js')>(
    '@sound-buddy/audio-engine/dist/ndjson.js',
  );
  return {
    loadEngineParsers: () => ({ buildStreamArgs }),
    loadEngineUtils: () => ({ readNdjsonLines }),
  };
});

/** A stand-in for the spawned Python child, with a spy-able kill(). */
function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdin = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn> };
  stdin.write = vi.fn();
  proc.stdin = stdin;
  proc.kill = vi.fn();
  return proc;
}

/** A minimal event-sender (renderer webContents) that records `send` calls. */
function fakeSender(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    sent: [] as { channel: string; payload: unknown }[],
    send(channel: string, payload: unknown) {
      this.sent.push({ channel, payload });
    },
  };
}

type Handler = (...args: unknown[]) => Promise<Record<string, unknown>>;

function startMeasurement(opts: Record<string, unknown>, sender: ReturnType<typeof fakeSender>) {
  const handler = handlers.get('start-measurement') as Handler;
  return handler({ sender }, opts);
}

function stopMeasurement() {
  const handler = handlers.get('stop-measurement') as Handler;
  return handler();
}

type MeasurementSource = typeof import('./measurement-source');
let mod: MeasurementSource;

beforeEach(async () => {
  vi.clearAllMocks();
  handlers.clear();
  vi.resetModules();
  mod = await import('./measurement-source');
  mod.registerMeasurementSourceHandlers();
  isEntitledMock.mockReturnValue(true);
  ensureMicrophoneAccessMock.mockResolvedValue('granted');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('start-measurement handler', () => {
  it('blocks when not entitled, without spawning', async () => {
    isEntitledMock.mockReturnValue(false);
    const sender = fakeSender();

    const result = await startMeasurement({ device: '2', windowSecs: 5 }, sender);

    expect(result).toEqual({ success: false, error: 'Live monitoring requires a Pro license.' });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(isEntitledMock).toHaveBeenCalledWith('live-monitoring');
  });

  it.each(['denied', 'restricted', 'not-determined', 'unknown'])(
    'blocks with a surfaced state and actionable error when mic access is "%s", never spawning or substituting a source',
    async (access) => {
      ensureMicrophoneAccessMock.mockResolvedValue(access);
      const sender = fakeSender();

      const result = await startMeasurement({ device: '2', windowSecs: 5 }, sender);

      expect(result).toEqual({
        success: false,
        micAccess: access,
        error:
          'Microphone access is not granted. Enable it in System Settings ▸ Privacy & Security ▸ Microphone, then try again.',
      });
      expect(spawnMock).not.toHaveBeenCalled();
      expect(ensureMicrophoneAccessMock).toHaveBeenCalledWith(true);
    },
  );

  it('spawns stream.py with buildMeasurementArgs on the happy path', async () => {
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    const result = await startMeasurement({ device: '2', windowSecs: 5, intervalSecs: 0.5 }, sender);

    expect(result).toEqual({ success: true });
    expect(spawnMock).toHaveBeenCalledWith(
      'python3',
      ['/fake/stream.py', '2', '5', '0', '--interval', '0.5'],
      expect.anything(),
    );
  });

  it('never passes --session-dir (monitor mode only)', async () => {
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5, mode: 'record', recordDir: '/tmp' }, sender);

    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv).not.toContain('--session-dir');
  });

  it('forwards parsed stdout lines as measurement-event', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ window: 1, rms: -12 }) + '\n'));
    proc.stdout.emit('data', Buffer.from('garbage\n'));

    expect(sender.sent).toEqual([{ channel: 'measurement-event', payload: { window: 1, rms: -12 } }]);
  });

  it('forwards a child spawn error as a measurement-event error', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    proc.emit('error', new Error('boom'));

    expect(sender.sent).toContainEqual({ channel: 'measurement-event', payload: { error: 'boom' } });
  });

  it('emits measurementEnded on an unexpected close (mid-session disconnect)', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    proc.emit('close', 1);

    expect(sender.sent).toContainEqual({
      channel: 'measurement-event',
      payload: { measurementEnded: true, code: 1 },
    });
  });

  it('does NOT emit measurementEnded after an explicit stop', async () => {
    const proc = fakeProc();
    proc.kill = vi.fn(() => proc.emit('close', 0));
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    await stopMeasurement();

    expect(sender.sent).not.toContainEqual(
      expect.objectContaining({ channel: 'measurement-event', payload: expect.objectContaining({ measurementEnded: true }) }),
    );
  });

  it('logs non-empty stderr and ignores whitespace-only stderr', async () => {
    const { logWarn } = await import('../logger');
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    proc.stderr.emit('data', Buffer.from('numpy warning\n'));
    proc.stderr.emit('data', Buffer.from('   \n'));

    expect(logWarn).toHaveBeenCalledWith('start-measurement stderr: numpy warning');
    expect(vi.mocked(logWarn).mock.calls.filter((c) => String(c[0]).includes('stderr'))).toHaveLength(1);
  });

  it('never sends to a destroyed renderer (stdout tick, error, and close all guarded)', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender(true);

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ window: 1 }) + '\n'));
    proc.emit('error', new Error('boom'));
    proc.emit('close', 1);

    expect(sender.sent).toEqual([]);
  });

  it('kills a prior process before starting a new one', async () => {
    const firstProc = fakeProc();
    const secondProc = fakeProc();
    spawnMock.mockReturnValueOnce(firstProc).mockReturnValueOnce(secondProc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    await startMeasurement({ device: '3', windowSecs: 5 }, sender);

    expect(firstProc.kill).toHaveBeenCalled();
  });
});

describe('stop-measurement handler', () => {
  it('resolves success:true when nothing is running', async () => {
    const result = await stopMeasurement();
    expect(result).toEqual({ success: true });
  });

  it('SIGTERMs a running process and resolves success:true', async () => {
    const proc = fakeProc();
    proc.kill = vi.fn(() => proc.emit('close', 0));
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    const result = await stopMeasurement();

    expect(result).toEqual({ success: true });
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalledWith();
  });

  it('does not SIGKILL when the child already exited before the grace timer fires', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    proc.kill = vi.fn(() => proc.emit('close', 0)); // SIGTERM exits cleanly at once
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    const result = await stopMeasurement();
    // The grace timer still fires later, but the child is already gone — no SIGKILL.
    await vi.advanceTimersByTimeAsync(2000);

    expect(result).toEqual({ success: true });
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL');
  });

  it('force-kills an unresponsive child after the grace window', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    proc.kill = vi.fn();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startMeasurement({ device: '2', windowSecs: 5 }, sender);
    const stopPromise = stopMeasurement();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result).toEqual({ success: true });
  });
});
