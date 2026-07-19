// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Handler-map capture pattern (mirrors app/electron/playback.test.ts, which
// exercises the same handlers through the legacy ./ipc aggregator — this file
// registers via registerPlaybackHandlers() directly instead).
const handlers = new Map<string, (...args: unknown[]) => unknown>();

const openPathMock = vi.hoisted(() => vi.fn(async () => ''));
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/sound-buddy-test' },
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
  shell: { openPath: openPathMock },
}));

vi.mock('../logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

const isEntitledMock = vi.hoisted(() => vi.fn(() => true));
vi.mock('../license', () => ({ isEntitled: isEntitledMock }));

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args), ChildProcess: class {} }));

import { registerPlaybackHandlers } from './playback';
import { logWarn, logError } from '../logger';

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

type Handler = (...args: unknown[]) => Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  openPathMock.mockResolvedValue('');
  isEntitledMock.mockReturnValue(true);
  registerPlaybackHandlers();
});

describe('reveal-path', () => {
  it('returns an error when no path is given', async () => {
    const handler = handlers.get('reveal-path') as Handler;
    const result = await handler(null, '');
    expect(result).toEqual({ success: false, error: 'no path' });
  });

  it('returns an error and logs when shell.openPath resolves an error string', async () => {
    openPathMock.mockResolvedValueOnce('could not open path');
    const handler = handlers.get('reveal-path') as Handler;
    const result = await handler(null, '/some/dir');
    expect(result).toEqual({ success: false, error: 'could not open path' });
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('could not open path'));
  });

  it('returns success when shell.openPath resolves empty', async () => {
    const handler = handlers.get('reveal-path') as Handler;
    const result = await handler(null, '/some/dir');
    expect(result).toEqual({ success: true });
  });
});

describe('read-session', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-playback-session-'));
  });

  afterEach(() => {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });

  it('returns an error when no session directory is given', async () => {
    const handler = handlers.get('read-session') as Handler;
    const result = await handler(null, '');
    expect(result).toEqual({ success: false, error: 'No session directory provided.' });
  });

  it('parses a valid manifest with a tracks array', async () => {
    const manifest = { tracks: [{ name: 'kick.wav' }] };
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(manifest));

    const handler = handlers.get('read-session') as Handler;
    const result = await handler(null, sessionDir);
    expect(result).toEqual({ success: true, manifest });
  });

  it('rejects a manifest whose tracks is not an array', async () => {
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({ tracks: 'nope' }));

    const handler = handlers.get('read-session') as Handler;
    const result = await handler(null, sessionDir);
    expect(result).toEqual({ success: false, error: 'session.json has no tracks.' });
  });

  it('logs a warning and returns an error for an unreadable/corrupt manifest', async () => {
    fs.writeFileSync(path.join(sessionDir, 'session.json'), '{not json');

    const handler = handlers.get('read-session') as Handler;
    const result = (await handler(null, sessionDir)) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not read session.json');
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('read-session'));
  });
});

describe('start-playback', () => {
  it('rejects when not entitled (Pro gate)', async () => {
    isEntitledMock.mockReturnValue(false);
    const handler = handlers.get('start-playback') as Handler;
    const result = await handler({ sender: fakeSender() }, { sessionDir: '/s' });
    expect(result).toEqual({ success: false, error: 'Virtual soundcheck requires a Pro license.' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('kills a prior in-flight child before starting a new one', async () => {
    const first = fakeProc();
    const second = fakeProc();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const handler = handlers.get('start-playback') as Handler;
    await handler({ sender: fakeSender() }, { sessionDir: '/first' });
    await handler({ sender: fakeSender() }, { sessionDir: '/second' });

    expect(first.kill).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('forwards stderr output via logWarn', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const handler = handlers.get('start-playback') as Handler;
    await handler({ sender: fakeSender() }, { sessionDir: '/s' });

    proc.stderr.emit('data', Buffer.from('a python warning\n'));

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('a python warning'));
  });

  it('ignores blank stderr chunks', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const handler = handlers.get('start-playback') as Handler;
    await handler({ sender: fakeSender() }, { sessionDir: '/s' });

    proc.stderr.emit('data', Buffer.from('   \n'));

    expect(logWarn).not.toHaveBeenCalled();
  });

  it('logs an error and notifies the renderer when the child exits with a non-zero code', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();
    const handler = handlers.get('start-playback') as Handler;
    await handler({ sender }, { sessionDir: '/s' });

    proc.emit('close', 1);

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('exited with code 1'));
    expect(sender.sent).toContainEqual({
      channel: 'playback-event',
      payload: { error: 'playback.py exited with code 1' },
    });
  });

  it('does not notify the renderer when the child closes cleanly (code 0)', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();
    const handler = handlers.get('start-playback') as Handler;
    await handler({ sender }, { sessionDir: '/s' });

    proc.emit('close', 0);

    expect(logError).not.toHaveBeenCalled();
    expect(sender.sent).toEqual([]);
  });
});

describe('stop-playback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SIGKILLs the child when it does not exit within the timeout', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const start = handlers.get('start-playback') as Handler;
    await start({ sender: fakeSender() }, { sessionDir: '/s' });

    const stop = handlers.get('stop-playback') as Handler;
    const p = stop();
    expect(proc.kill).toHaveBeenCalledTimes(1); // SIGTERM

    await vi.advanceTimersByTimeAsync(2000);

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(p).resolves.toEqual({ success: true });
  });
});
