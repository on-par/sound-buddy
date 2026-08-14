// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const childProcessSpawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: (...args: unknown[]) => childProcessSpawnMock(...args) }));

import { createPythonStreamSlot, DEFAULT_STOP_GRACE_MS, type PythonStreamChild, type PythonStreamExitInfo } from './python-stream';
// python-stream.ts takes readNdjsonLines as an injected dependency (callers
// wire it to loadEngineUtils().readNdjsonLines) rather than importing
// ./engine-loader itself — python-stream.ts stays free of the Electron `app`
// import and built dist-cjs artifact that engine-loader.ts requires. Use the
// real implementation here (from the engine's built ESM dist) so this suite
// exercises real NDJSON parsing instead of a hand-copied stand-in.
import { readNdjsonLines } from '@sound-buddy/audio-engine/dist/ndjson.js';

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
  return proc as unknown as PythonStreamChild & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
}

function fakeDeps(spawnMock: ReturnType<typeof vi.fn>) {
  return {
    spawn: spawnMock as unknown as Parameters<typeof createPythonStreamSlot>[0]['spawn'],
    readNdjsonLines,
    log: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createPythonStreamSlot', () => {
  it('rapid restart: a stale prior child close never clobbers the new child (the orphaned-process race)', () => {
    const procA = fakeProc();
    const procB = fakeProc();
    const spawnMock = vi.fn().mockReturnValueOnce(procA).mockReturnValueOnce(procB);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    const onExitA = vi.fn();
    const onExitB = vi.fn();

    slot.start({
      command: 'python3', args: ['a.py'], env: {}, label: 'a',
      onLine: vi.fn(), onExit: onExitA,
    });
    // Start B before A's close fires — A's kill() call from start() doesn't
    // synchronously emit close in this test double, simulating a slow-to-exit
    // old child racing against a fast new start().
    slot.start({
      command: 'python3', args: ['b.py'], env: {}, label: 'b',
      onLine: vi.fn(), onExit: onExitB,
    });

    // A's close arrives late, after B already owns the slot.
    procA.emit('close', 0, null);

    expect(onExitA).not.toHaveBeenCalled();
    expect(slot.isRunning()).toBe(true);

    procB.emit('close', 0, null);

    expect(onExitB).toHaveBeenCalledWith({ code: 0, signal: null, expected: false });
    expect(slot.isRunning()).toBe(false);
  });

  it('forwards parsed NDJSON stdout lines and ignores non-JSON', () => {
    const proc = fakeProc();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);
    const onLine = vi.fn();

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine, onExit: vi.fn() });
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ a: 1 }) + '\n'));
    proc.stdout.emit('data', Buffer.from('garbage\n'));

    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith({ a: 1 });
  });

  it('logs non-empty stderr chunks with the label prefix and ignores whitespace-only chunks', () => {
    const proc = fakeProc();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'start-x', onLine: vi.fn(), onExit: vi.fn() });
    proc.stderr.emit('data', Buffer.from('a warning\n'));
    proc.stderr.emit('data', Buffer.from('   \n'));

    expect(deps.logWarn).toHaveBeenCalledWith('start-x stderr: a warning');
    expect(deps.logWarn).toHaveBeenCalledTimes(1);
  });

  it('onError: logs and invokes opts.onError with the same Error on a process error event', () => {
    const proc = fakeProc();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);
    const onError = vi.fn();
    const err = new Error('spawn ENOENT');

    slot.start({ command: 'python3', args: [], env: {}, label: 'start-x', onLine: vi.fn(), onError, onExit: vi.fn() });
    proc.emit('error', err);

    expect(deps.logError).toHaveBeenCalledWith('start-x: process error', err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('stop(): SIGTERM followed by a synchronous close resolves { closedCleanly: true }, kill called once with no args', async () => {
    const proc = fakeProc();
    proc.kill = vi.fn(() => { proc.emit('close', 0, null); return true; });
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    const result = await slot.stop();

    expect(result).toEqual({ closedCleanly: true });
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalledWith();
  });

  it('stop(): SIGTERM timeout escalates to SIGKILL and resolves { closedCleanly: false }', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    proc.kill = vi.fn();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    const stopPromise = slot.stop();
    await vi.advanceTimersByTimeAsync(DEFAULT_STOP_GRACE_MS);
    const result = await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result).toEqual({ closedCleanly: false });
  });

  it('onExit receives expected: true when the exit follows a stop() call', async () => {
    const proc = fakeProc();
    proc.kill = vi.fn(() => { proc.emit('close', 0, null); return true; });
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);
    const onExit = vi.fn();

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit });
    await slot.stop();

    expect(onExit).toHaveBeenCalledWith({ code: 0, signal: null, expected: true });
  });

  it('onExit receives expected: false on an unrequested exit', () => {
    const proc = fakeProc();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);
    const onExit = vi.fn();

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit });
    proc.emit('close', 1, null);

    expect(onExit).toHaveBeenCalledWith({ code: 1, signal: null, expected: false });
  });

  it('stop() with nothing running resolves { closedCleanly: false } immediately without killing or scheduling', async () => {
    const spawnMock = vi.fn();
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    const result = await slot.stop();

    expect(result).toEqual({ closedCleanly: false });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('isRunning() reflects start()/close lifecycle', () => {
    const proc = fakeProc();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    expect(slot.isRunning()).toBe(false);
    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    expect(slot.isRunning()).toBe(true);
    proc.emit('close', 0, null);
    expect(slot.isRunning()).toBe(false);
  });

  it('honors a custom graceMs argument to stop()', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    proc.kill = vi.fn();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    const stopPromise = slot.stop(500);
    await vi.advanceTimersByTimeAsync(499);
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL');
    await vi.advanceTimersByTimeAsync(1);
    const result = await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result).toEqual({ closedCleanly: false });
  });

  it('stop(): swallows an exception from a SIGKILL on an already-gone process', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    proc.kill = vi.fn((signal?: NodeJS.Signals) => {
      if (signal === 'SIGKILL') throw new Error('ESRCH: no such process');
      return true;
    });
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    const stopPromise = slot.stop();
    await vi.advanceTimersByTimeAsync(DEFAULT_STOP_GRACE_MS);

    await expect(stopPromise).resolves.toEqual({ closedCleanly: false });
  });

  it('stop(): a late close after the SIGKILL grace window already settled is a no-op (no double resolve)', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    proc.kill = vi.fn();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    const stopPromise = slot.stop();
    await vi.advanceTimersByTimeAsync(DEFAULT_STOP_GRACE_MS);
    await expect(stopPromise).resolves.toEqual({ closedCleanly: false });

    // The child finally exits after the grace window already forced settle().
    expect(() => proc.emit('close', null, 'SIGKILL')).not.toThrow();
  });

  it('stop(): does not SIGKILL when the child already exited before the grace timer fires', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    proc.kill = vi.fn(() => { proc.emit('close', 0, null); return true; });
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    const result = await slot.stop();
    // The grace timer still fires later, but the child is already gone — no SIGKILL.
    await vi.advanceTimersByTimeAsync(DEFAULT_STOP_GRACE_MS);

    expect(result).toEqual({ closedCleanly: true });
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL');
  });

  it('start() kills a previously running child before spawning the replacement', () => {
    const procA = fakeProc();
    const procB = fakeProc();
    const spawnMock = vi.fn().mockReturnValueOnce(procA).mockReturnValueOnce(procB);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'a', onLine: vi.fn(), onExit: vi.fn() });
    slot.start({ command: 'python3', args: [], env: {}, label: 'b', onLine: vi.fn(), onExit: vi.fn() });

    expect(procA.kill).toHaveBeenCalledTimes(1);
  });

  it('default spawn wraps child_process.spawn when deps.spawn is omitted', () => {
    const proc = fakeProc();
    childProcessSpawnMock.mockReturnValueOnce(proc);
    const deps = { readNdjsonLines, log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() };
    const slot = createPythonStreamSlot(deps);

    slot.start({
      command: 'python3',
      args: ['stream.py'],
      env: { FOO: 'bar' },
      label: 'default-spawn',
      onLine: vi.fn(),
      onExit: vi.fn(),
    });

    expect(childProcessSpawnMock).toHaveBeenCalledWith(
      'python3',
      ['stream.py'],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { FOO: 'bar' } },
    );
    expect(slot.isRunning()).toBe(true);
  });

  it('send() writes the exact payload to the running child stdin', () => {
    const proc = fakeProc();
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    slot.send('{"type":"set-routes","spec":"0:1,1:2-3"}\n');

    expect(proc.stdin.write).toHaveBeenCalledTimes(1);
    expect(proc.stdin.write).toHaveBeenCalledWith('{"type":"set-routes","spec":"0:1,1:2-3"}\n');
  });

  it('send() is a safe no-op with nothing running', () => {
    const spawnMock = vi.fn();
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    expect(() => slot.send('anything')).not.toThrow();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('send() swallows an exception from a dead child stdin write', () => {
    const proc = fakeProc();
    proc.stdin.write = vi.fn(() => { throw new Error('EPIPE'); });
    const spawnMock = vi.fn().mockReturnValueOnce(proc);
    const deps = fakeDeps(spawnMock);
    const slot = createPythonStreamSlot(deps);

    slot.start({ command: 'python3', args: [], env: {}, label: 'x', onLine: vi.fn(), onExit: vi.fn() });
    expect(() => slot.send('data')).not.toThrow();
  });
});

// Type-only sanity check that PythonStreamExitInfo shape matches usage above.
const _typeCheck: PythonStreamExitInfo = { code: 0, signal: null, expected: false };
void _typeCheck;
