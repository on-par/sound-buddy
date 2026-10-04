// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// registerRecordTakeHandlers wires every channel into this map so a test can
// invoke a single handler directly without a live ipcMain (same pattern as
// measurement-source.test.ts).
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
  app: { isPackaged: false },
}));
const logWarnMock = vi.fn();
vi.mock('../logger', () => ({ log: vi.fn(), logWarn: (...a: unknown[]) => logWarnMock(...a), logError: vi.fn() }));
const isEntitledMock = vi.fn();
vi.mock('../license', () => ({ isEntitled: (...a: unknown[]) => isEntitledMock(...a) }));
vi.mock('./shared', () => ({
  pythonBin: () => 'python3',
  childEnv: () => ({}),
  STREAM_SCRIPT: '/fake/stream.py',
}));
// The TCC gate and the take-folder naming are live-capture.ts's (reused, not
// duplicated) — mock them so this suite drives granted/blocked and a fixed
// folder without an Electron sandbox.
const ensureMicrophoneAccessMock = vi.fn();
const buildSessionDirMock = vi.fn();
vi.mock('./live-capture', () => ({
  ensureMicrophoneAccess: (...a: unknown[]) => ensureMicrophoneAccessMock(...a),
  buildSessionDir: (...a: unknown[]) => buildSessionDirMock(...a),
}));
const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  ChildProcess: class {},
}));
// The REAL buildStreamArgs, so the asserted argv is what stream.py receives.
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

/** A stand-in for a spawned stream.py child that exits on SIGTERM. */
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
  proc.kill = vi.fn(() => {
    queueMicrotask(() => proc.emit('close', 0, null));
    return true;
  });
  return proc;
}

type Handler = (...args: unknown[]) => Promise<Record<string, unknown>>;

const OPTS = {
  main: { device: '3', channels: '0-1' },
  measurement: { device: '5', channels: '0' },
  windowSecs: 5,
  intervalSecs: 0.1,
};

const sender = { send: vi.fn(), isDestroyed: () => false };

function startTake(opts: Record<string, unknown> = OPTS) {
  return (handlers.get('start-record-take') as Handler)({ sender }, opts);
}

function stopTake() {
  return (handlers.get('stop-record-take') as Handler)();
}

// What stream.py leaves in a finalized --session-dir: a stem + session.json.
function writeFinalizedSession(dir: string, stem: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, stem), 'RIFF');
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ tracks: [{ file: stem }] }));
}

type RecordTake = typeof import('./record-take');
let mod: RecordTake;
let tmp: string;
let takeDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  handlers.clear();
  vi.resetModules();
  mod = await import('./record-take');
  mod.registerRecordTakeHandlers();
  isEntitledMock.mockReturnValue(true);
  ensureMicrophoneAccessMock.mockResolvedValue('granted');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'record-take-'));
  takeDir = path.join(tmp, 'sound-buddy-20261004-101500-000');
  buildSessionDirMock.mockReturnValue(takeDir);
  spawnMock.mockImplementation(() => fakeProc());
});

describe('sourceStreamOptions (#1648)', () => {
  it('records ONE stem for the source into its own session folder, labeled by source', () => {
    expect(mod.sourceStreamOptions({ device: '3', channels: '0-1' }, '/t/main', 'Main', 5, 0.1)).toEqual({
      device: '3',
      windowSecs: 5,
      intervalSecs: 0.1,
      channels: ['0-1'],
      sessionDir: '/t/main',
      armTokens: ['0-1'],
      labels: ['Main'],
    });
  });
});

describe('stemFromManifest (#1648)', () => {
  it('resolves the first track file of a finalized session to an absolute path', () => {
    writeFinalizedSession(path.join(tmp, 'main'), '01-main.wav');
    expect(mod.stemFromManifest(path.join(tmp, 'main'), (p) => fs.readFileSync(p, 'utf8')))
      .toBe(path.join(tmp, 'main', '01-main.wav'));
  });

  it('is null when no session.json was written', () => {
    expect(mod.stemFromManifest(path.join(tmp, 'nothing'), (p) => fs.readFileSync(p, 'utf8'))).toBeNull();
  });

  it('is null for a manifest with no tracks', () => {
    expect(mod.stemFromManifest('/x', () => JSON.stringify({ tracks: [] }))).toBeNull();
  });

  it('is null for a malformed manifest', () => {
    expect(mod.stemFromManifest('/x', () => '{not json')).toBeNull();
  });
});

describe('start-record-take handler (#1648)', () => {
  it('blocks when not entitled, without spawning', async () => {
    isEntitledMock.mockReturnValue(false);

    expect(await startTake()).toEqual({ success: false, error: 'Recording requires a Pro license.' });
    expect(isEntitledMock).toHaveBeenCalledWith('live-monitoring');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('blocks with an actionable error when mic access is not granted, without spawning', async () => {
    ensureMicrophoneAccessMock.mockResolvedValue('denied');

    const result = await startTake();

    expect(result).toMatchObject({ success: false, micAccess: 'denied' });
    expect(result.error).toMatch(/System Settings ▸ Privacy & Security ▸ Microphone/);
    expect(ensureMicrophoneAccessMock).toHaveBeenCalledWith(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reports a recording folder it cannot prepare', async () => {
    buildSessionDirMock.mockImplementation(() => { throw new Error('EACCES'); });

    const result = await startTake();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Could not prepare the recording folder.*EACCES.*Settings ▸ Storage/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns exactly two record processes — Main into <take>/main, Measurement into <take>/measurement', async () => {
    const result = await startTake({ ...OPTS, recordDir: '/chosen' });

    expect(result).toEqual({ success: true });
    expect(buildSessionDirMock).toHaveBeenCalledWith('/chosen');
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0][1]).toEqual([
      '/fake/stream.py', '3', '5', '0-1', '--interval', '0.1',
      '--session-dir', path.join(takeDir, 'main'), '--arm', '0-1', '--labels', '["Main"]',
    ]);
    expect(spawnMock.mock.calls[1][1]).toEqual([
      '/fake/stream.py', '5', '5', '0', '--interval', '0.1',
      '--session-dir', path.join(takeDir, 'measurement'), '--arm', '0', '--labels', '["Measurement"]',
    ]);
  });

  it('never forwards the record processes\' meter ticks to the renderer (the Live RTA has its own stream)', async () => {
    await startTake();
    const main = spawnMock.mock.results[0].value as ReturnType<typeof fakeProc>;

    main.stdout.emit('data', Buffer.from('{"type":"meter","channels":[]}\n'));
    await new Promise((r) => setTimeout(r, 0));

    expect(sender.send).not.toHaveBeenCalled();
  });

  it('logs a source whose stream.py dies before Stop', async () => {
    await startTake();
    const measurement = spawnMock.mock.results[1].value as ReturnType<typeof fakeProc>;

    measurement.emit('close', 1, null);

    expect(logWarnMock).toHaveBeenCalledWith('record-take:measurement: stream.py ended before Stop (code 1)');
  });

  it('refuses a second take while one is recording', async () => {
    await startTake();

    expect(await startTake()).toEqual({
      success: false,
      error: 'A recording is already running — press Stop first, then Record again.',
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});

describe('stop-record-take handler (#1648)', () => {
  it('stops both processes and hands back the take folder with both stems', async () => {
    await startTake();
    writeFinalizedSession(path.join(takeDir, 'main'), '01-main.wav');
    writeFinalizedSession(path.join(takeDir, 'measurement'), '01-measurement.wav');

    const result = await stopTake();

    expect(result).toEqual({
      success: true,
      takeDir,
      files: {
        main: path.join(takeDir, 'main', '01-main.wav'),
        measurement: path.join(takeDir, 'measurement', '01-measurement.wav'),
      },
    });
    for (const call of spawnMock.mock.results) expect(call.value.kill).toHaveBeenCalled();
  });

  it('keeps the take when only one source finalized, nulling the other', async () => {
    await startTake();
    writeFinalizedSession(path.join(takeDir, 'main'), '01-main.wav');

    const result = await stopTake();

    expect(result).toEqual({
      success: true,
      takeDir,
      files: { main: path.join(takeDir, 'main', '01-main.wav'), measurement: null },
    });
  });

  it('offers no take folder when neither source wrote a stem', async () => {
    await startTake();

    expect(await stopTake()).toEqual({ success: true, takeDir: null, files: { main: null, measurement: null } });
  });

  it('is a no-op success when nothing is recording', async () => {
    expect(await stopTake()).toEqual({ success: true, takeDir: null, files: { main: null, measurement: null } });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('frees the slot so a new take can start after stop', async () => {
    await startTake();
    await stopTake();

    expect(await startTake()).toEqual({ success: true });
    expect(spawnMock).toHaveBeenCalledTimes(4);
  });
});
