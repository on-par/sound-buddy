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

const defaultRecordDirMock = vi.hoisted(() => vi.fn());
vi.mock('./shared', () => ({
  pythonBin: () => 'python3',
  childEnv: () => ({}),
  PLAYBACK_SCRIPT: '/fake/playback.py',
  WAVEFORM_PEAKS_SCRIPT: '/fake/waveform-peaks.py',
  defaultRecordDir: () => defaultRecordDirMock(),
}));

const isEntitledMock = vi.hoisted(() => vi.fn(() => true));
vi.mock('../license', () => ({ isEntitled: isEntitledMock }));

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args), ChildProcess: class {} }));
// Use the REAL buildPlaybackArgs (from the engine's built ESM dist) instead of
// hand-copying its mapping logic (see live-capture.test.ts for the same
// pattern), so this mock can't drift from the source of truth in
// packages/audio-engine/src/playback/index.ts.
vi.mock('./engine-loader', async () => {
  const { buildPlaybackArgs } = await vi.importActual<
    typeof import('@sound-buddy/audio-engine/dist/playback/index.js')
  >('@sound-buddy/audio-engine/dist/playback/index.js');
  const { readNdjsonLines } = await vi.importActual<typeof import('@sound-buddy/audio-engine/dist/ndjson.js')>(
    '@sound-buddy/audio-engine/dist/ndjson.js',
  );
  return {
    loadEngineParsers: () => ({ buildPlaybackArgs }),
    loadEngineUtils: () => ({ readNdjsonLines }),
  };
});

import { registerPlaybackHandlers } from './playback';
import { log, logWarn, logError } from '../logger';
import { peakCachePathFor } from './waveform-peaks';
import { WAVEFORM_PEAKS_SCRIPT } from './shared';
import type { SessionPeaksDto } from './api';

const PEAKS: SessionPeaksDto = {
  bucketsPerSecond: 50,
  tracks: [{ index: 0, label: 'Kick', kind: 'mono', bucketCount: 5, data: 'AA==' }],
};

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
  defaultRecordDirMock.mockReturnValue(path.join(os.tmpdir(), 'sound-buddy-no-recordings'));
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

  // The on-disk fixture every Session-timeline e2e spec loads. Held to the same
  // key contract write_session_manifest emits (see
  // docs/session-file-format-verification.md) so a timeline spec can never be made
  // to pass by inventing a manifest field.
  const MANIFEST_TRACK_KEYS = ['id', 'label', 'kind', 'sourceChannels', 'file', 'frames'];

  it('reads the real e2e fixture manifest and its tracks carry only writer-emitted keys', async () => {
    const fixtureDir = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'session');
    const handler = handlers.get('read-session') as Handler;
    const result = (await handler(null, fixtureDir)) as {
      success: boolean;
      manifest: { sampleRate: number; tracks: Record<string, unknown>[] };
    };
    expect(result.success).toBe(true);
    expect(result.manifest.sampleRate).toBe(48000);
    expect(result.manifest.tracks).toHaveLength(2);
    for (const track of result.manifest.tracks) {
      expect(Object.keys(track).every((k) => MANIFEST_TRACK_KEYS.includes(k))).toBe(true);
      expect(typeof track.kind).toBe('string');
      expect(Array.isArray(track.sourceChannels)).toBe(true);
      expect(typeof track.file).toBe('string');
      expect(path.isAbsolute(track.file as string)).toBe(false);
    }
  });
});

describe('list-recorded-sessions', () => {
  let recordRoot: string;

  beforeEach(() => {
    recordRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-recorded-sessions-'));
    defaultRecordDirMock.mockReturnValue(recordRoot);
  });

  afterEach(() => {
    fs.rmSync(recordRoot, { recursive: true, force: true });
  });

  it('returns an empty successful list when the recording root has not been created', async () => {
    defaultRecordDirMock.mockReturnValue(path.join(recordRoot, 'missing'));

    const handler = handlers.get('list-recorded-sessions') as Handler;
    await expect(handler()).resolves.toEqual({ success: true, sessions: [] });
  });

  it('returns valid manifest summaries newest first with metadata and folder-name fallback', async () => {
    const named = path.join(recordRoot, 'sunday');
    const fallback = path.join(recordRoot, 'rehearsal');
    fs.mkdirSync(named);
    fs.mkdirSync(fallback);
    fs.writeFileSync(path.join(named, 'session.json'), JSON.stringify({ tracks: [], name: 'Sunday AM', createdAt: '2026-08-17T10:00:00.000Z' }));
    fs.writeFileSync(path.join(fallback, 'session.json'), JSON.stringify({ tracks: [], createdAt: '2026-08-18T10:00:00.000Z' }));

    const handler = handlers.get('list-recorded-sessions') as Handler;
    await expect(handler()).resolves.toEqual({
      success: true,
      sessions: [
        { sessionDir: fallback, name: 'rehearsal', createdAt: '2026-08-18T10:00:00.000Z' },
        { sessionDir: named, name: 'Sunday AM', createdAt: '2026-08-17T10:00:00.000Z' },
      ],
    });
  });

  it('ignores files and folders without readable valid manifests and orders missing timestamps by directory name', async () => {
    const alpha = path.join(recordRoot, 'alpha');
    const zulu = path.join(recordRoot, 'zulu');
    fs.mkdirSync(alpha);
    fs.mkdirSync(zulu);
    fs.mkdirSync(path.join(recordRoot, 'malformed'));
    fs.mkdirSync(path.join(recordRoot, 'missing'));
    fs.writeFileSync(path.join(alpha, 'session.json'), JSON.stringify({ tracks: [] }));
    fs.writeFileSync(path.join(zulu, 'session.json'), JSON.stringify({ tracks: [] }));
    fs.writeFileSync(path.join(recordRoot, 'malformed', 'session.json'), '{bad json');
    fs.writeFileSync(path.join(recordRoot, 'plain-file'), 'not a directory');

    const handler = handlers.get('list-recorded-sessions') as Handler;
    const result = await handler() as { success: boolean; sessions: Array<{ name: string }> };
    expect(result).toEqual({ success: true, sessions: [{ sessionDir: alpha, name: 'alpha' }, { sessionDir: zulu, name: 'zulu' }] });
  });

  it('omits invalid creation metadata and falls back from a blank manifest name to the folder name', async () => {
    const session = path.join(recordRoot, 'fallback-name');
    fs.mkdirSync(session);
    fs.writeFileSync(path.join(session, 'session.json'), JSON.stringify({ tracks: [], name: '   ', createdAt: 'not-a-date' }));

    const handler = handlers.get('list-recorded-sessions') as Handler;
    await expect(handler()).resolves.toEqual({
      success: true,
      sessions: [{ sessionDir: session, name: 'fallback-name' }],
    });
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

  it('passes --start-at through to the spawned child when startOffsetSecs is set', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const handler = handlers.get('start-playback') as Handler;
    await handler({ sender: fakeSender() }, { sessionDir: '/s', startOffsetSecs: 5 });

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).toContain('--start-at');
    expect(args[args.indexOf('--start-at') + 1]).toBe('5');
  });

  it('omits --start-at when startOffsetSecs is not provided', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const handler = handlers.get('start-playback') as Handler;
    await handler({ sender: fakeSender() }, { sessionDir: '/s' });

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).not.toContain('--start-at');
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

describe('generate-session-peaks', () => {
  // Mirrors the mocked app.getPath('userData') in the electron mock above.
  const cacheDir = '/tmp/sound-buddy-test/soundcheck-peaks';
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-peaks-session-'));
  });

  afterEach(() => {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });

  it('returns an error when no session directory is given', async () => {
    const handler = handlers.get('generate-session-peaks') as Handler;
    const result = await handler(null, '');
    expect(result).toEqual({ success: false, error: 'No session directory provided.' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('serves a fresh cache without spawning', async () => {
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({ tracks: [{ file: 'a.wav' }] }));
    fs.writeFileSync(path.join(sessionDir, 'a.wav'), 'stem');
    const cachePath = peakCachePathFor(sessionDir, cacheDir);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(PEAKS));
    const future = Date.now() + 60_000;
    fs.utimesSync(cachePath, new Date(future), new Date(future));

    const handler = handlers.get('generate-session-peaks') as Handler;
    const result = await handler(null, sessionDir);
    expect(result).toEqual({ success: true, cached: true, peaks: PEAKS });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns waveform_peaks.py on a cache miss and serves the generated document', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({ tracks: [{ file: 'a.wav' }] }));
    fs.writeFileSync(path.join(sessionDir, 'a.wav'), 'stem');
    const cachePath = peakCachePathFor(sessionDir, cacheDir);

    const handler = handlers.get('generate-session-peaks') as Handler;
    const p = handler(null, sessionDir);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).toEqual([WAVEFORM_PEAKS_SCRIPT, sessionDir, '--out', cachePath]);

    // A progress line on the child's stdout is forwarded to onProgress and
    // logged (the handler's onProgress → log wiring).
    proc.stdout.emit('data', Buffer.from('{"type":"done","tracks":1}\n'));
    expect(log).toHaveBeenCalledWith('generate-session-peaks: {"type":"done","tracks":1}');

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(PEAKS));
    proc.emit('close', 0);

    const result = await p;
    expect(result).toEqual({ success: true, cached: false, peaks: PEAKS });
  });

  it('returns an actionable error when the child exits non-zero', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({ tracks: [{ file: 'a.wav' }] }));

    const handler = handlers.get('generate-session-peaks') as Handler;
    const p = handler(null, sessionDir);
    proc.emit('close', 1);

    const result = await p;
    expect(result).toEqual({ success: false, error: 'waveform peak generation failed (exit 1).' });
  });
});

describe('set-playback-routes', () => {
  it('writes the full set-routes command to the running child stdin and returns success', async () => {
    const proc = fakeProc();
    spawnMock.mockReturnValueOnce(proc);
    const start = handlers.get('start-playback') as Handler;
    await start({ sender: fakeSender() }, { sessionDir: '/s' });

    const handler = handlers.get('set-playback-routes') as Handler;
    const result = await handler(null, { route: '0:1,1:2-3' });
    expect(result).toEqual({ success: true });
    expect(proc.stdin.write).toHaveBeenCalledWith('{"type":"set-routes","spec":"0:1,1:2-3"}\n');
  });

  it('rejects a missing, empty, or non-string route with the required-spec error', async () => {
    const handler = handlers.get('set-playback-routes') as Handler;
    const missing = await handler(null, undefined);
    expect(missing).toEqual({ success: false, error: 'A routing spec is required.' });
    const emptyOpts = await handler(null, {});
    expect(emptyOpts).toEqual({ success: false, error: 'A routing spec is required.' });
    const emptyRoute = await handler(null, { route: '' });
    expect(emptyRoute).toEqual({ success: false, error: 'A routing spec is required.' });
    const whitespaceRoute = await handler(null, { route: '   ' });
    expect(whitespaceRoute).toEqual({ success: false, error: 'A routing spec is required.' });
    const nonStringRoute = await handler(null, { route: 42 });
    expect(nonStringRoute).toEqual({ success: false, error: 'A routing spec is required.' });
  });

  it('returns success (no-op) when nothing is running', async () => {
    const handler = handlers.get('set-playback-routes') as Handler;
    const result = await handler(null, { route: '0:0' });
    expect(result).toEqual({ success: true });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
