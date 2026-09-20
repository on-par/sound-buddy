// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const createSocketMock = vi.hoisted(() => vi.fn());
vi.mock('dgram', () => ({ createSocket: (...args: unknown[]) => createSocketMock(...args) }));

import {
  captureSceneFromConsole,
  captureSceneToFile,
  type SceneCaptureDeps,
  type SceneCaptureWalkDeps,
} from './console-scene-capture';
import type { ConsoleDiscoverySocket, ConsoleDiscoveryDeps } from './console-discovery';
import { ConsoleNetworkConsentError } from '../console-network-consent';
import {
  CONSECUTIVE_FAILURE_BREAKER_LIMIT,
  DEFERRED_PATH_CAP,
  SWEEP_SETTLE_PAUSE_MS,
} from './scene-capture-retry';
import {
  encodeOscMessage,
  decodeOscMessage,
  SCENE_NODE_PATHS,
  SCENE_NODE_PATH_COUNT,
  buildSceneHeader,
  assembleSceneFile,
} from '@sound-buddy/console/dist-cjs/index.js';

type FakeSocket = ConsoleDiscoverySocket & {
  bind: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit: EventEmitter['emit'];
};

// Every query gets a fresh socket — reusing one emitter across 2103 queries
// would stack 4206 listeners and make each emit O(n).
function makeRespondingSocket(respond: (path: string, socket: FakeSocket) => void): FakeSocket {
  const emitter = new EventEmitter();
  const socket = emitter as unknown as FakeSocket;
  socket.bind = vi.fn((cb: () => void) => cb());
  socket.close = vi.fn();
  // queryConsole assigns its retry timer *after* socket.send() returns, so a
  // synchronous reply would resolve the promise before the timer exists and
  // leak an uncleared timer that later re-sends on a closed socket.
  socket.send = vi.fn((msg: Uint8Array) => {
    const decoded = decodeOscMessage(new Uint8Array(msg));
    const path = decoded.args[0] && decoded.args[0].type === 's' ? decoded.args[0].value : '';
    queueMicrotask(() => respond(path, socket));
  });
  return socket;
}

function syntheticLine(path: string): string {
  return `${path} +0.0`;
}

function replyDatagram(line: string): Uint8Array {
  return encodeOscMessage({ address: '/node', args: [{ type: 's', value: `${line}\n` }] });
}

function fullResponder(sockets: FakeSocket[]): ConsoleDiscoveryDeps['createSocket'] {
  return () => {
    const socket = makeRespondingSocket((path, s) => {
      s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
    });
    sockets.push(socket);
    return socket;
  };
}

const GRANTED = { consoleNetworkConsentGranted: true };
const DENIED = { consoleNetworkConsentGranted: false };
// The sweep pass's settle pause defaults to a real setTimeout; tests inject
// a no-op so a deferred-path scenario doesn't add SWEEP_SETTLE_PAUSE_MS of
// real wall-clock time to every run.
const NO_WAIT = async () => {};

afterEach(() => {
  createSocketMock.mockReset();
});

describe('captureSceneFromConsole', () => {
  it('rejects with ConsoleNetworkConsentError before any socket is created when consent is not granted', async () => {
    const createSocket = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket, log: vi.fn() };

    await expect(
      captureSceneFromConsole(deps, DENIED, '192.168.1.77', { name: 'n', note: 'note' })
    ).rejects.toBeInstanceOf(ConsoleNetworkConsentError);
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('aborting the signal mid-walk rejects with the cancellation message and stops short of the full table', async () => {
    const controller = new AbortController();
    const abortAfterPath = SCENE_NODE_PATHS[3];
    let sendCount = 0;
    const deps: SceneCaptureWalkDeps = {
      createSocket: () =>
        makeRespondingSocket((path, s) => {
          sendCount++;
          if (path === abortAfterPath) controller.abort();
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        }),
      log: vi.fn(),
    };

    await expect(
      captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
        name: 'n',
        note: 'note',
        signal: controller.signal,
      })
    ).rejects.toThrow('Scene capture cancelled. Nothing was saved.');

    expect(sendCount).toBeLessThan(SCENE_NODE_PATH_COUNT);
  });

  it('captures every path and assembles a scene identical to assembleSceneFile of the same synthetic map (AC1)', async () => {
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = { createSocket: fullResponder(sockets), log: vi.fn() };

    const text = await captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
      name: 'Sunday AM',
      note: 'pre-service',
    });

    const expectedMap = new Map(SCENE_NODE_PATHS.map((p) => [p, syntheticLine(p)]));
    const expected = assembleSceneFile(buildSceneHeader('Sunday AM', 'pre-service'), expectedMap);
    expect(text).toBe(expected);
    expect(text.startsWith(buildSceneHeader('Sunday AM', 'pre-service'))).toBe(true);
    const nonEmptyLines = text.split('\n').filter((l) => l.length > 0);
    expect(nonEmptyLines).toHaveLength(SCENE_NODE_PATH_COUNT + 1);
  }, 20000);

  it('rejects when a path never replies to either the walk or the sweep, naming that path (AC2)', async () => {
    const droppedPath = SCENE_NODE_PATHS[500];
    const sockets: FakeSocket[] = [];
    const deps: SceneCaptureWalkDeps = {
      createSocket: () => {
        const socket = makeRespondingSocket((path, s) => {
          if (path === droppedPath) return; // drop every reply for this path, walk and sweep alike
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        });
        sockets.push(socket);
        return socket;
      },
      log: vi.fn(),
      wait: NO_WAIT,
    };

    await expect(
      captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
        name: 'n',
        note: 'note',
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      })
    ).rejects.toThrow(droppedPath);
  }, 20000);

  it('recovers via the sweep when a path misses only its first (walk-phase) attempt (AC1 fix)', async () => {
    const recoveredPath = SCENE_NODE_PATHS[500];
    let firstAttemptDropped = false;
    const sockets: FakeSocket[] = [];
    const deps: SceneCaptureWalkDeps = {
      createSocket: () => {
        const socket = makeRespondingSocket((path, s) => {
          if (path === recoveredPath && !firstAttemptDropped) {
            firstAttemptDropped = true;
            return; // drop only the walk-phase reply — the sweep retry succeeds
          }
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        });
        sockets.push(socket);
        return socket;
      },
      log: vi.fn(),
      wait: NO_WAIT,
    };

    const text = await captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
      name: 'n',
      note: 'note',
      queryOptions: { timeoutMs: 1, maxRetries: 0 },
    });

    const expectedMap = new Map(SCENE_NODE_PATHS.map((p) => [p, syntheticLine(p)]));
    expect(text).toBe(assembleSceneFile(buildSceneHeader('n', 'note'), expectedMap));
    expect(firstAttemptDropped).toBe(true);
  }, 20000);

  it('trips the breaker after consecutive misses reach the limit, failing fast instead of walking the full table', async () => {
    let sendCount = 0;
    const deps: SceneCaptureWalkDeps = {
      createSocket: () =>
        makeRespondingSocket(() => {
          sendCount++; // never emits a reply — every query in the run times out
        }),
      log: vi.fn(),
    };

    await expect(
      captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
        name: 'n',
        note: 'note',
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      })
    ).rejects.toThrow(/Scene capture failed/);

    expect(sendCount).toBe(CONSECUTIVE_FAILURE_BREAKER_LIMIT);
  });

  it('trips the breaker once the deferred cap is reached via scattered (non-consecutive) misses', async () => {
    let sendCount = 0;
    const deps: SceneCaptureWalkDeps = {
      createSocket: () =>
        makeRespondingSocket((path, s) => {
          sendCount++;
          if (SCENE_NODE_PATHS.indexOf(path) % 2 === 0) return; // every other path misses — never 2 in a row
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        }),
      log: vi.fn(),
    };

    await expect(
      captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
        name: 'n',
        note: 'note',
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      })
    ).rejects.toThrow(/Scene capture failed/);

    // 2x the deferred cap plus a safety margin — proves this aborted long
    // before the 2103-path table finished, even though no run of consecutive
    // misses ever reached the breaker's own limit.
    expect(sendCount).toBeLessThan(DEFERRED_PATH_CAP * 2 + 4);
  });

  it('invokes the injected settle pause exactly once, with the sweep budget, before sweeping a deferred path', async () => {
    const droppedPath = SCENE_NODE_PATHS[5];
    let firstAttemptDropped = false;
    const wait = vi.fn().mockResolvedValue(undefined);
    const deps: SceneCaptureWalkDeps = {
      createSocket: () =>
        makeRespondingSocket((path, s) => {
          if (path === droppedPath && !firstAttemptDropped) {
            firstAttemptDropped = true;
            return;
          }
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        }),
      log: vi.fn(),
      wait,
    };

    await captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
      name: 'n',
      note: 'note',
      queryOptions: { timeoutMs: 1, maxRetries: 0 },
    });

    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(SWEEP_SETTLE_PAUSE_MS);
  }, 20000);

  it('never invokes the settle pause when the walk completes with no deferred paths', async () => {
    const sockets: FakeSocket[] = [];
    const wait = vi.fn().mockResolvedValue(undefined);
    const deps: SceneCaptureWalkDeps = { createSocket: fullResponder(sockets), log: vi.fn(), wait };

    await captureSceneFromConsole(deps, GRANTED, '192.168.1.77', { name: 'n', note: 'note' });

    expect(wait).not.toHaveBeenCalled();
  }, 20000);

  it('sends nothing but /node, and every argument is a member of SCENE_NODE_PATHS (AC4)', async () => {
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = { createSocket: fullResponder(sockets), log: vi.fn() };

    await captureSceneFromConsole(deps, GRANTED, '192.168.1.77', { name: 'n', note: 'note' });

    const pathSet = new Set(SCENE_NODE_PATHS);
    const denyPattern = /\/(save|load|scene|snapshot|copy|paste|delete|undo|add|cue)/;
    let sendCount = 0;
    for (const socket of sockets) {
      for (const call of socket.send.mock.calls) {
        sendCount++;
        const decoded = decodeOscMessage(new Uint8Array(call[0] as Uint8Array));
        expect(decoded.address).toBe('/node');
        expect(decoded.args).toHaveLength(1);
        expect(decoded.args[0].type).toBe('s');
        const arg = decoded.args[0] as { type: 's'; value: string };
        expect(pathSet.has(arg.value)).toBe(true);
        expect(denyPattern.test(arg.value)).toBe(false);
      }
    }
    expect(sendCount).toBe(SCENE_NODE_PATH_COUNT);
  }, 20000);

  it('calls onProgress once per path, ending at (SCENE_NODE_PATH_COUNT, SCENE_NODE_PATH_COUNT)', async () => {
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = { createSocket: fullResponder(sockets), log: vi.fn() };
    const onProgress = vi.fn();

    await captureSceneFromConsole(deps, GRANTED, '192.168.1.77', { name: 'n', note: 'note', onProgress });

    expect(onProgress).toHaveBeenCalledTimes(SCENE_NODE_PATH_COUNT);
    expect(onProgress).toHaveBeenLastCalledWith(SCENE_NODE_PATH_COUNT, SCENE_NODE_PATH_COUNT);
  }, 20000);

  it('defaults the settle pause to a real setTimeout when no wait is injected', async () => {
    vi.useFakeTimers();
    try {
      const droppedPath = SCENE_NODE_PATHS[9];
      let firstAttemptDropped = false;
      const deps: SceneCaptureWalkDeps = {
        createSocket: () =>
          makeRespondingSocket((path, s) => {
            if (path === droppedPath && !firstAttemptDropped) {
              firstAttemptDropped = true;
              return;
            }
            s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
          }),
        log: vi.fn(),
        // no `wait` override — exercises the real setTimeout-based default
      };

      const resultPromise = captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
        name: 'n',
        note: 'note',
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      });

      await vi.advanceTimersByTimeAsync(SWEEP_SETTLE_PAUSE_MS + 100);
      const text = await resultPromise;

      const expectedMap = new Map(SCENE_NODE_PATHS.map((p) => [p, syntheticLine(p)]));
      expect(text).toBe(assembleSceneFile(buildSceneHeader('n', 'note'), expectedMap));
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it('rethrows the query error (not the wrapped failure message) when the signal is already aborted by the time a sweep query rejects', async () => {
    const droppedPath = SCENE_NODE_PATHS[7];
    let firstAttemptDropped = false;
    const controller = new AbortController();
    const deps: SceneCaptureWalkDeps = {
      createSocket: () =>
        makeRespondingSocket((path, s) => {
          if (path === droppedPath) {
            if (!firstAttemptDropped) {
              firstAttemptDropped = true;
              return; // walk-phase miss — deferred to the sweep
            }
            controller.abort(); // cancellation races in while the sweep retry is in flight
            return; // still no reply — the sweep retry rejects on its own
          }
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        }),
      log: vi.fn(),
      wait: NO_WAIT,
    };

    await expect(
      captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
        name: 'n',
        note: 'note',
        signal: controller.signal,
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      })
    ).rejects.toThrow(/No reply from console/);
  }, 20000);
});

describe('captureSceneToFile', () => {
  it('writes exactly once on success, with the target path and the exact captured text', async () => {
    const sockets: FakeSocket[] = [];
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const deps: SceneCaptureDeps = { createSocket: fullResponder(sockets), log: vi.fn(), writeFile };

    const resolved = await captureSceneToFile(deps, GRANTED, '192.168.1.77', '/tmp/scene.scn', {
      name: 'n',
      note: 'note',
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith('/tmp/scene.scn', resolved);
  }, 20000);

  it('never calls writeFile when capture throws (a partial capture is never written)', async () => {
    const droppedPath = SCENE_NODE_PATHS[10];
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const deps: SceneCaptureDeps = {
      createSocket: () => {
        return makeRespondingSocket((path, s) => {
          if (path === droppedPath) return; // drop every reply for this path, walk and sweep alike
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        });
      },
      log: vi.fn(),
      writeFile,
      wait: NO_WAIT,
    };

    await expect(
      captureSceneToFile(deps, GRANTED, '192.168.1.77', '/tmp/scene.scn', {
        name: 'n',
        note: 'note',
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      })
    ).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
  }, 20000);
});
