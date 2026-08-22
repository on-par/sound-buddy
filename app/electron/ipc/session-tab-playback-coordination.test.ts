// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const lifecycle: string[] = [];

const isEntitledMock = vi.hoisted(() => vi.fn(() => true));
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/sound-buddy-test', isPackaged: false },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
  shell: { openPath: vi.fn(async () => '') },
  systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: vi.fn() },
}));
vi.mock('../logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock('../license', () => ({ isEntitled: isEntitledMock }));
vi.mock('./shared', () => ({
  pythonBin: () => 'python3',
  childEnv: () => ({}),
  STREAM_SCRIPT: '/fake/stream.py',
  PLAYBACK_SCRIPT: '/fake/playback.py',
  WAVEFORM_PEAKS_SCRIPT: '/fake/waveform-peaks.py',
  defaultRecordDir: () => '/tmp/sound-buddy-recordings',
}));
vi.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args), ChildProcess: class {} }));
vi.mock('./engine-loader', () => ({
  loadEngineParsers: () => ({
    buildStreamArgs: () => [],
    buildPlaybackArgs: () => [],
  }),
  loadEngineUtils: () => ({
    readNdjsonLines: (source: EventEmitter, onLine: (data: Record<string, unknown>) => void) => {
      source.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().trim().split('\n')) {
          if (line) onLine(JSON.parse(line) as Record<string, unknown>);
        }
      });
    },
  }),
}));

type Handler = (...args: unknown[]) => Promise<Record<string, unknown>>;

function fakeProcess(name: string, closeOnKill = true) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    closeCleanly(signal?: NodeJS.Signals): void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
  proc.closeCleanly = (signal?: NodeJS.Signals) => {
    lifecycle.push(`${name}:close`);
    proc.emit('close', 0, signal ?? null);
  };
  proc.kill = vi.fn((signal?: NodeJS.Signals) => {
    lifecycle.push(`${name}:kill${signal ? `:${signal}` : ''}`);
    if (closeOnKill) proc.closeCleanly(signal);
    return true;
  });
  return proc;
}

function fakeSender() {
  return {
    isDestroyed: () => false,
    sent: [] as Array<{ channel: string; payload: unknown }>,
    send(channel: string, payload: unknown) {
      this.sent.push({ channel, payload });
    },
  };
}

describe('Session tab playback and capture coordination (#1074)', () => {
  let recordDir: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    handlers.clear();
    lifecycle.length = 0;
    recordDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-session-coordination-'));
    isEntitledMock.mockReturnValue(true);
    const { registerPlaybackHandlers } = await import('./playback');
    const { registerLiveCaptureHandlers } = await import('./live-capture');
    registerPlaybackHandlers();
    registerLiveCaptureHandlers();
  });

  afterEach(() => {
    fs.rmSync(recordDir, { recursive: true, force: true });
  });

  it('keeps monitor meters live during playback, serializes record promotion, and permits replay', async () => {
    const monitor = fakeProcess('monitor');
    const playback = fakeProcess('playback', false);
    const recording = fakeProcess('recording');
    const replay = fakeProcess('replay');
    const children = [monitor, playback, recording, replay];
    let nextChild = 0;
    spawnMock.mockImplementation((_python: string, _args: string[]) => {
      const child = children[nextChild++];
      const name = child === monitor ? 'monitor'
        : child === playback ? 'playback'
          : child === recording ? 'recording' : 'replay';
      lifecycle.push(`${name}:spawn`);
      return child;
    });
    const sender = fakeSender();
    const startLive = handlers.get('start-live') as Handler;
    const startPlayback = handlers.get('start-playback') as Handler;
    const stopLive = handlers.get('stop-live') as Handler;

    await startLive({ sender }, { windowSecs: 5 });
    await startPlayback({ sender }, { sessionDir: '/fixture-session' });
    monitor.stdout.emit('data', Buffer.from('{"rms":-18}\n{"rms":-12}\n'));
    expect(sender.sent).toEqual([
      { channel: 'live-event', payload: { rms: -18 } },
      { channel: 'live-event', payload: { rms: -12 } },
    ]);
    expect(playback.kill).not.toHaveBeenCalled();

    const recordStart = startLive({ sender }, { windowSecs: 5, mode: 'record', recordDir });
    await Promise.resolve();
    expect(lifecycle).toContain('playback:kill');
    expect(lifecycle).not.toContain('recording:spawn');
    playback.closeCleanly();
    await recordStart;
    expect(lifecycle.indexOf('playback:close')).toBeLessThan(lifecycle.indexOf('recording:spawn'));
    expect(recording.kill).not.toHaveBeenCalled();

    await stopLive();
    expect(recording.kill).toHaveBeenCalledTimes(1);
    await startPlayback({ sender }, { sessionDir: '/fixture-session', startOffsetSecs: 3 });
    expect(replay.kill).not.toHaveBeenCalled();
    expect(lifecycle).toContain('playback:spawn');
    expect(lifecycle).toContain('replay:spawn');
  });

  it('leaves playback running when a record request fails its entitlement gate', async () => {
    const playback = fakeProcess('playback');
    spawnMock.mockReturnValue(playback);
    const sender = fakeSender();
    const startPlayback = handlers.get('start-playback') as Handler;
    const startLive = handlers.get('start-live') as Handler;

    await startPlayback({ sender }, { sessionDir: '/fixture-session' });
    isEntitledMock.mockImplementation((feature: string) => feature !== 'live-monitoring');

    await expect(startLive({ sender }, { windowSecs: 5, mode: 'record', recordDir })).resolves.toEqual({
      success: false,
      error: 'Live monitoring requires a Pro license.',
    });
    expect(playback.kill).not.toHaveBeenCalled();
  });
});
