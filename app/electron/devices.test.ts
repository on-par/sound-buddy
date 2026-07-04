import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// registerIpcHandlers wires every channel through this map so a test can invoke a
// single handler directly without a live ipcMain.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

// ipc.ts touches these Electron/main-process surfaces at import + registration
// time; stub them so the module loads headless. Only `app` (paths) and
// `systemPreferences` (mic status, read by list-devices) matter here.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/sound-buddy-test' },
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
  dialog: {},
  BrowserWindow: class {},
  systemPreferences: { getMediaAccessStatus: () => 'granted' },
}));
vi.mock('./logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock('./llm', () => ({ streamNarrative: vi.fn() }));

// The device-enumeration helper is the whole unit under test: it spawns stream.py
// and shapes the result. Stub child_process so we drive the fake process's
// stdout/stderr/close/error by hand.
const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: (...args: unknown[]) => spawnMock(...args),
  ChildProcess: class {},
}));

import { enumerateDevices, registerIpcHandlers } from './ipc';

/** A stand-in for the spawned Python child: EventEmitter with stdout/stderr. */
function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

const OUTPUT_DEVICE = { index: 1, name: 'Built-in Output', channels: 2, default_sr: 44100 };

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
});

describe('enumerateDevices', () => {
  it('resolves the parsed device list on a clean exit', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ devices: [OUTPUT_DEVICE] })));
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ success: true, devices: [OUTPUT_DEVICE] });
  });

  it('spawns stream.py with the requested enumeration flag', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.stdout.emit('data', Buffer.from('{"devices":[]}'));
    proc.emit('close', 0);
    await p;
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [expect.stringContaining('stream.py'), '--list-output-devices'],
      expect.anything(),
    );
  });

  it('returns an empty list (not an error) when no output devices are present', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.stdout.emit('data', Buffer.from('{"devices":[]}'));
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ success: true, devices: [] });
  });

  it('defaults a missing "devices" key to an empty list', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.stdout.emit('data', Buffer.from('{}'));
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ success: true, devices: [] });
  });

  it('still parses stdout when the process exits non-zero but printed a payload', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ devices: [OUTPUT_DEVICE] })));
    proc.emit('close', 3);
    await expect(p).resolves.toEqual({ success: true, devices: [OUTPUT_DEVICE] });
  });

  it('tolerates stderr warnings alongside a valid payload', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.stderr.emit('data', Buffer.from('ALSA lib noise'));
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ devices: [OUTPUT_DEVICE] })));
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ success: true, devices: [OUTPUT_DEVICE] });
  });

  it('fails cleanly when the process exits non-zero with no parseable stdout', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.stderr.emit('data', Buffer.from('boom'));
    proc.emit('close', 1);
    await expect(p).resolves.toEqual({ success: false, error: 'stream.py exited with code 1' });
  });

  it('fails cleanly on unparseable stdout', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.stdout.emit('data', Buffer.from('not json'));
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ success: false, error: 'Failed to parse device list' });
  });

  it('fails cleanly when the process cannot be spawned', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = enumerateDevices('--list-output-devices', 'list-output-devices');
    proc.emit('error', new Error('spawn ENOENT'));
    await expect(p).resolves.toEqual({ success: false, error: 'spawn ENOENT' });
  });
});

describe('list-output-devices IPC handler', () => {
  it('delegates to enumerateDevices and returns the device list without micAccess', async () => {
    registerIpcHandlers();
    const handler = handlers.get('list-output-devices');
    expect(handler).toBeTypeOf('function');

    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const p = (handler as (...args: unknown[]) => Promise<unknown>)({});
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ devices: [OUTPUT_DEVICE] })));
    proc.emit('close', 0);

    const result = await p;
    expect(result).toEqual({ success: true, devices: [OUTPUT_DEVICE] });
    expect(result).not.toHaveProperty('micAccess');
  });
});
