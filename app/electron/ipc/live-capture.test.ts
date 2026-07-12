// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// registerLiveCaptureHandlers wires every channel into this map so a test can
// invoke a single handler directly without a live ipcMain (same pattern as
// analysis.test.ts / devices.test.ts / playback.test.ts).
const handlers = new Map<string, (...args: unknown[]) => unknown>();

const askForMediaAccessMock = vi.fn();
const getMediaAccessStatusMock = vi.fn();
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
  systemPreferences: {
    getMediaAccessStatus: (...a: unknown[]) => getMediaAccessStatusMock(...a),
    askForMediaAccess: (...a: unknown[]) => askForMediaAccessMock(...a),
  },
}));
vi.mock('../logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
const isEntitledMock = vi.fn();
vi.mock('../license', () => ({ isEntitled: (...a: unknown[]) => isEntitledMock(...a) }));
const getSettingsMock = vi.fn();
vi.mock('../settings', () => ({ getSettings: () => getSettingsMock() }));
const defaultRecordDirMock = vi.fn();
vi.mock('./shared', () => ({
  pythonBin: () => 'python3',
  childEnv: () => ({}),
  STREAM_SCRIPT: '/fake/stream.py',
  defaultRecordDir: () => defaultRecordDirMock(),
}));
const streamLLMMock = vi.fn();
const buildLiveReportMock = vi.fn();
vi.mock('./narrative', () => ({
  streamLLM: (...a: unknown[]) => streamLLMMock(...a),
  buildLiveReport: (...a: unknown[]) => buildLiveReportMock(...a),
}));
const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  ChildProcess: class {},
}));

/** A stand-in for the spawned Python child, with a spy-able kill(). */
function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

/** A minimal event-sender (renderer webContents) that records `send` calls. */
function fakeSender() {
  return {
    isDestroyed: () => false,
    sent: [] as { channel: string; payload: unknown }[],
    send(channel: string, payload: unknown) {
      this.sent.push({ channel, payload });
    },
  };
}

type Handler = (...args: unknown[]) => Promise<Record<string, unknown>>;

function startLive(opts: Record<string, unknown>, sender: ReturnType<typeof fakeSender>) {
  const handler = handlers.get('start-live') as Handler;
  return handler({ sender }, opts);
}

function stopLive() {
  const handler = handlers.get('stop-live') as Handler;
  return handler();
}

function listDevices() {
  const handler = handlers.get('list-devices') as Handler;
  return handler();
}

// list-devices awaits ensureMicrophoneAccess before spawning stream.py, so
// spawn() lands a microtask tick after the handler is invoked — give that
// tick a chance to run before poking the fake child process.
function flushMicrotasks() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

const realPlatform = process.platform;
function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

type LiveCapture = typeof import('./live-capture');
let mod: LiveCapture;
let tmpDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  handlers.clear();
  vi.resetModules();
  setPlatform('darwin');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-live-'));
  mod = await import('./live-capture');
  mod.registerLiveCaptureHandlers();
  isEntitledMock.mockReturnValue(true);
  getMediaAccessStatusMock.mockReturnValue('granted');
  getSettingsMock.mockReturnValue({ aiEnabled: false });
  defaultRecordDirMock.mockReturnValue(path.join(tmpDir, 'default'));
});

afterEach(() => {
  setPlatform(realPlatform);
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('captureStamp', () => {
  it('formats a local Date as YYYYMMDD-HHMMSS-mmm', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 14, 32, 7, 512));
    expect(mod.captureStamp()).toBe('20260703-143207-512');
  });

  it('zero-pads every component', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 3, 4, 5, 7));
    expect(mod.captureStamp()).toBe('20260105-030405-007');
  });

  it('two calls 1ms apart differ only in the millisecond suffix', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 3, 4, 5, 7));
    const first = mod.captureStamp();
    vi.setSystemTime(new Date(2026, 0, 5, 3, 4, 5, 8));
    const second = mod.captureStamp();
    expect(first).not.toBe(second);
    expect(first.slice(0, 15)).toBe(second.slice(0, 15));
  });

  it('matches the expected format', () => {
    expect(mod.captureStamp()).toMatch(/^\d{8}-\d{6}-\d{3}$/);
  });
});

describe('buildSessionDir', () => {
  it('uses defaultRecordDir() when no arg is given, and creates only the parent', () => {
    const defaultDir = path.join(tmpDir, 'default');
    defaultRecordDirMock.mockReturnValue(defaultDir);

    const sessionDir = mod.buildSessionDir();

    expect(sessionDir).toMatch(new RegExp(`^${defaultDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sound-buddy-`));
    expect(fs.existsSync(defaultDir)).toBe(true);
    expect(fs.existsSync(sessionDir)).toBe(false);
  });

  it('uses a custom dir when given', () => {
    const customDir = path.join(tmpDir, 'custom');

    const sessionDir = mod.buildSessionDir(customDir);

    expect(sessionDir.startsWith(path.join(customDir, 'sound-buddy-'))).toBe(true);
    expect(fs.existsSync(customDir)).toBe(true);
    expect(fs.existsSync(sessionDir)).toBe(false);
  });

  it('falls back to the default dir for a whitespace-only string', () => {
    const defaultDir = path.join(tmpDir, 'default');
    defaultRecordDirMock.mockReturnValue(defaultDir);

    const sessionDir = mod.buildSessionDir('  ');

    expect(sessionDir.startsWith(path.join(defaultDir, 'sound-buddy-'))).toBe(true);
  });

  it('throws for a bad path (parent is a regular file)', () => {
    const fileOnDisk = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(fileOnDisk, 'x');
    const badPath = path.join(fileOnDisk, 'sub');

    expect(() => mod.buildSessionDir(badPath)).toThrow();
  });
});

describe('list-devices handler', () => {
  it('happy path: resolves devices merged with granted micAccess', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);

    const promise = listDevices();
    await flushMicrotasks();
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ devices: [{ id: '0', name: 'Mic' }] }) + '\n'));
    proc.emit('close', 0, null);

    await expect(promise).resolves.toEqual({
      success: true,
      devices: [{ id: '0', name: 'Mic' }],
      micAccess: 'granted',
    });
    expect(spawnMock).toHaveBeenCalledWith('python3', ['/fake/stream.py', '--list-devices'], expect.anything());
  });

  it('spawn error surfaces success:false with the error message', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);

    const promise = listDevices();
    await flushMicrotasks();
    proc.emit('error', new Error('spawn ENOENT'));

    await expect(promise).resolves.toEqual({ success: false, error: 'spawn ENOENT', micAccess: 'granted' });
  });

  it('reports micAccess: denied without prompting', async () => {
    getMediaAccessStatusMock.mockReturnValue('denied');
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);

    const promise = listDevices();
    await flushMicrotasks();
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ devices: [] }) + '\n'));
    proc.emit('close', 0, null);

    await expect(promise).resolves.toEqual({ success: true, devices: [], micAccess: 'denied' });
    expect(askForMediaAccessMock).not.toHaveBeenCalled();
  });

  it('reports micAccess: not-determined without prompting', async () => {
    getMediaAccessStatusMock.mockReturnValue('not-determined');
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);

    const promise = listDevices();
    await flushMicrotasks();
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ devices: [] }) + '\n'));
    proc.emit('close', 0, null);

    await expect(promise).resolves.toEqual({ success: true, devices: [], micAccess: 'not-determined' });
    expect(askForMediaAccessMock).not.toHaveBeenCalled();
  });
});

describe('start-live handler', () => {
  it('blocks when not entitled, without spawning', async () => {
    isEntitledMock.mockReturnValue(false);
    const sender = fakeSender();

    const result = await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    expect(result).toEqual({ success: false, error: 'Live monitoring requires a Pro license.' });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(isEntitledMock).toHaveBeenCalledWith('live-monitoring');
  });

  it('blocks when mic access is denied, without spawning', async () => {
    getMediaAccessStatusMock.mockReturnValue('denied');
    const sender = fakeSender();

    const result = await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    expect(result).toEqual({
      success: false,
      micAccess: 'denied',
      error:
        'Microphone access is not granted. Enable it in System Settings ▸ Privacy & Security ▸ Microphone, then try again.',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('prompts and proceeds when the user grants access', async () => {
    getMediaAccessStatusMock.mockReturnValue('not-determined');
    askForMediaAccessMock.mockResolvedValue(true);
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    const result = await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    expect(result).toEqual({ success: true });
    expect(spawnMock).toHaveBeenCalled();
    expect(askForMediaAccessMock).toHaveBeenCalledWith('microphone');
  });

  it('blocks when the user denies the prompt', async () => {
    getMediaAccessStatusMock.mockReturnValue('not-determined');
    askForMediaAccessMock.mockResolvedValue(false);
    const sender = fakeSender();

    const result = await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    expect(result).toMatchObject({ success: false, micAccess: 'denied' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('blocks with micAccess: unknown when the prompt throws', async () => {
    getMediaAccessStatusMock.mockReturnValue('not-determined');
    askForMediaAccessMock.mockRejectedValue(new Error('tcc'));
    const sender = fakeSender();

    const result = await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    expect(result).toMatchObject({ success: false, micAccess: 'unknown' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('short-circuits the permission gate on non-darwin platforms', async () => {
    setPlatform('linux');
    getMediaAccessStatusMock.mockReturnValue('denied');
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    const result = await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    expect(result).toEqual({ success: true });
    expect(spawnMock).toHaveBeenCalled();
  });

  it('builds full argv from device/windowSecs/channels/intervalSecs', async () => {
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    await startLive(
      { device: '2', windowSecs: 5, channels: ['0', '1-2'], intervalSecs: 0.5, llmIntervalSecs: 0 },
      sender,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      'python3',
      ['/fake/stream.py', '2', '5', '0,1-2', '--interval', '0.5'],
      expect.anything(),
    );
  });

  it('builds argv with empty placeholders when device/channels/intervalSecs are absent', async () => {
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    expect(spawnMock).toHaveBeenCalledWith('python3', ['/fake/stream.py', '', '5', ''], expect.anything());
  });

  it('record mode: adds --session-dir and --arm', async () => {
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    await startLive(
      { windowSecs: 5, llmIntervalSecs: 0, mode: 'record', recordDir: tmpDir, arm: ['0', '2-3'] },
      sender,
    );

    const argv = spawnMock.mock.calls[0][1] as string[];
    const sessionDirIdx = argv.indexOf('--session-dir');
    expect(sessionDirIdx).toBeGreaterThan(-1);
    expect(argv[sessionDirIdx + 1]).toMatch(
      new RegExp(`^${tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sound-buddy-`),
    );
    expect(argv).toContain('--arm');
    expect(argv[argv.indexOf('--arm') + 1]).toBe('0,2-3');
  });

  it('record mode: omits --arm when arm is not given', async () => {
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0, mode: 'record', recordDir: tmpDir }, sender);

    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv).not.toContain('--arm');
  });

  it('record mode: bad recordDir surfaces a friendly error without spawning', async () => {
    const fileOnDisk = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(fileOnDisk, 'x');
    const sender = fakeSender();

    const result = await startLive(
      { windowSecs: 5, llmIntervalSecs: 0, mode: 'record', recordDir: path.join(fileOnDisk, 'sub') },
      sender,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not prepare recording folder/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('kills a prior process before starting a new one', async () => {
    const firstProc = fakeProc();
    const secondProc = fakeProc();
    spawnMock.mockReturnValueOnce(firstProc).mockReturnValueOnce(secondProc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);
    await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    expect(firstProc.kill).toHaveBeenCalled();
  });

  it('forwards parsed stdout lines as live-event, ignores non-JSON, reassembles split lines', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ window: 1, rms: -12 }) + '\n'));
    proc.stdout.emit('data', Buffer.from('garbage\n'));
    proc.stdout.emit('data', Buffer.from('{"win'));
    proc.stdout.emit('data', Buffer.from('dow":2}\n'));

    expect(sender.sent).toEqual([
      { channel: 'live-event', payload: { window: 1, rms: -12 } },
      { channel: 'live-event', payload: { window: 2 } },
    ]);
  });

  it('forwards child spawn errors and non-zero exit codes as live-event errors', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);

    proc.emit('error', new Error('boom'));
    expect(sender.sent).toContainEqual({ channel: 'live-event', payload: { error: 'boom' } });

    proc.emit('close', 3);
    expect(sender.sent).toContainEqual({ channel: 'live-event', payload: { error: 'stream.py exited with code 3' } });
  });

  it('sends nothing extra on a clean close (code 0)', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);
    const sentBeforeClose = sender.sent.length;
    proc.emit('close', 0);

    expect(sender.sent.length).toBe(sentBeforeClose);
  });
});

describe('LLM interval timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('fires at cadence once the collector has data', async () => {
    getSettingsMock.mockReturnValue({ aiEnabled: true });
    buildLiveReportMock.mockReturnValue('REPORT');
    streamLLMMock.mockResolvedValue(undefined);
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 5 }, sender);
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ window: 1 }) + '\n'));

    await vi.advanceTimersByTimeAsync(5000);
    expect(streamLLMMock).toHaveBeenCalledTimes(1);
    expect(streamLLMMock).toHaveBeenCalledWith(
      sender,
      expect.stringContaining('professional audio engineer'),
      'REPORT',
    );
    expect(buildLiveReportMock).toHaveBeenCalledWith([{ window: 1 }]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(streamLLMMock).toHaveBeenCalledTimes(2);
  });

  it('does not tick when the collector is empty', async () => {
    getSettingsMock.mockReturnValue({ aiEnabled: true });
    spawnMock.mockReturnValueOnce(fakeProc());
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 5 }, sender);
    await vi.advanceTimersByTimeAsync(5000);

    expect(streamLLMMock).not.toHaveBeenCalled();
  });

  it('skips silently when entitlement lapses mid-capture', async () => {
    getSettingsMock.mockReturnValue({ aiEnabled: true });
    isEntitledMock.mockImplementation((f: string) => f === 'live-monitoring');
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 5 }, sender);
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ window: 1 }) + '\n'));
    await vi.advanceTimersByTimeAsync(5000);

    expect(streamLLMMock).not.toHaveBeenCalled();
  });

  it('never schedules a timer when llmIntervalSecs is 0', async () => {
    getSettingsMock.mockReturnValue({ aiEnabled: true });
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ window: 1 }) + '\n'));
    await vi.advanceTimersByTimeAsync(5000);

    expect(streamLLMMock).not.toHaveBeenCalled();
  });

  it('never schedules a timer when aiEnabled is false', async () => {
    getSettingsMock.mockReturnValue({ aiEnabled: false });
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 5 }, sender);
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ window: 1 }) + '\n'));
    await vi.advanceTimersByTimeAsync(5000);

    expect(streamLLMMock).not.toHaveBeenCalled();
  });

  it('is cleared on stop', async () => {
    getSettingsMock.mockReturnValue({ aiEnabled: true });
    buildLiveReportMock.mockReturnValue('REPORT');
    streamLLMMock.mockResolvedValue(undefined);
    const proc = fakeProc();
    proc.kill = vi.fn(() => { proc.emit('close', 0); });
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 5 }, sender);
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ window: 1 }) + '\n'));

    await stopLive();
    await vi.advanceTimersByTimeAsync(10000);

    expect(streamLLMMock).not.toHaveBeenCalled();
  });
});

describe('stop-live handler', () => {
  it('resolves sessionDir: null when nothing is running', async () => {
    const result = await stopLive();

    expect(result).toEqual({ success: true, sessionDir: null });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('SIGTERMs a running monitor-mode process and resolves sessionDir: null', async () => {
    const proc = fakeProc();
    proc.kill = vi.fn(() => { proc.emit('close', 0); });
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0 }, sender);
    const result = await stopLive();

    expect(result).toEqual({ success: true, sessionDir: null });
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalledWith();
  });

  it('returns the session dir when record mode wrote a manifest', async () => {
    const proc = fakeProc();
    proc.kill = vi.fn(() => { proc.emit('close', 0); });
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0, mode: 'record', recordDir: tmpDir }, sender);
    const argv = spawnMock.mock.calls[0][1] as string[];
    const sessionDir = argv[argv.indexOf('--session-dir') + 1];
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'session.json'), '{}');

    const result = await stopLive();

    expect(result).toEqual({ success: true, sessionDir });
  });

  it('returns sessionDir: null when record mode never wrote a manifest', async () => {
    const proc = fakeProc();
    proc.kill = vi.fn(() => { proc.emit('close', 0); });
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0, mode: 'record', recordDir: tmpDir }, sender);
    const argv = spawnMock.mock.calls[0][1] as string[];
    const sessionDir = argv[argv.indexOf('--session-dir') + 1];
    fs.mkdirSync(sessionDir, { recursive: true });

    const result = await stopLive();

    expect(result).toEqual({ success: true, sessionDir: null });
  });

  it('force-kills an unresponsive child after the timeout and returns sessionDir: null', async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    proc.kill = vi.fn();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    await startLive({ windowSecs: 5, llmIntervalSecs: 0, mode: 'record', recordDir: tmpDir }, sender);
    const argv = spawnMock.mock.calls[0][1] as string[];
    const sessionDir = argv[argv.indexOf('--session-dir') + 1];
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'session.json'), '{}');

    const stopPromise = stopLive();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result).toEqual({ success: true, sessionDir: null });
  });
});
