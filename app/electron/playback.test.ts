import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// registerIpcHandlers wires every channel into this map so a test can invoke a
// single handler directly without a live ipcMain (same pattern as devices.test).
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/sound-buddy-test' },
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
  dialog: {},
  BrowserWindow: class {},
  systemPreferences: { getMediaAccessStatus: () => 'granted' },
}));
vi.mock('./logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
// Playback is Pro-gated (#54); these tests cover the spawn/stream mechanics,
// so entitle everything. license.test.ts owns the gate itself.
vi.mock('./license', () => ({
  isEntitled: () => true,
  getLicenseState: () => ({ tier: 'pro', status: 'valid' }),
  activateLicense: vi.fn(),
  removeLicense: vi.fn(),
}));

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: (...args: unknown[]) => spawnMock(...args),
  ChildProcess: class {},
}));

import { registerIpcHandlers } from './ipc';

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

type Handler = (...args: unknown[]) => Promise<{ success: boolean; error?: string }>;

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  registerIpcHandlers();
});

describe('start-playback IPC handler', () => {
  it('spawns playback.py with routing args and forwards JSON lines as playback-event', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();

    const start = handlers.get('start-playback') as Handler;
    const result = await start({ sender }, {
      sessionDir: '/sessions/friday',
      device: '1',
      route: '0:0,1:2-3',
      intervalSecs: 0.1,
    });
    expect(result).toEqual({ success: true });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        expect.stringContaining('playback.py'),
        '/sessions/friday',
        '--device', '1',
        '--route', '0:0,1:2-3',
        '--interval', '0.1',
      ],
      expect.anything(),
    );

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'mixdown', active: false }) + '\n'));
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'ended' }) + '\n'));
    expect(sender.sent).toEqual([
      { channel: 'playback-event', payload: { type: 'mixdown', active: false } },
      { channel: 'playback-event', payload: { type: 'ended' } },
    ]);
  });

  it('passes --master as a bare flag and omits an absent route', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const start = handlers.get('start-playback') as Handler;
    await start({ sender: fakeSender() }, { sessionDir: '/s', master: true });

    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv).toContain('--master');
    expect(argv).not.toContain('--route');
    expect(argv).not.toContain('--device');
  });

  it('rejects a start with no session directory', async () => {
    const start = handlers.get('start-playback') as Handler;
    const result = await start({ sender: fakeSender() }, { sessionDir: '' });
    expect(result.success).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('forwards a spawn error to the renderer', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const sender = fakeSender();
    const start = handlers.get('start-playback') as Handler;
    await start({ sender }, { sessionDir: '/s', route: '0:0' });

    proc.emit('error', new Error('spawn ENOENT'));
    expect(sender.sent).toEqual([
      { channel: 'playback-event', payload: { error: 'spawn ENOENT' } },
    ]);
  });
});

describe('stop-playback IPC handler', () => {
  it('SIGTERMs the running child and resolves once it closes', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    await (handlers.get('start-playback') as Handler)({ sender: fakeSender() }, {
      sessionDir: '/s', route: '0:0',
    });

    const stop = handlers.get('stop-playback') as Handler;
    const p = stop();
    expect(proc.kill).toHaveBeenCalled();      // SIGTERM sent
    proc.emit('close', 0);                      // child exits cleanly
    await expect(p).resolves.toEqual({ success: true });
  });

  it('is a no-op when nothing is playing', async () => {
    const stop = handlers.get('stop-playback') as Handler;
    await expect(stop()).resolves.toEqual({ success: true });
  });
});
