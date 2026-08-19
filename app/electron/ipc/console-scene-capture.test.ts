// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const createSocketMock = vi.hoisted(() => vi.fn());
vi.mock('dgram', () => ({ createSocket: (...args: unknown[]) => createSocketMock(...args) }));

import { captureSceneFromConsole, captureSceneToFile, type SceneCaptureDeps } from './console-scene-capture';
import type { ConsoleDiscoverySocket, ConsoleDiscoveryDeps } from './console-discovery';
import { ConsoleNetworkConsentError } from '../console-network-consent';
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

  it('rejects when a mid-walk path never replies, naming that path (AC2)', async () => {
    const droppedPath = SCENE_NODE_PATHS[500];
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = {
      createSocket: () => {
        const socket = makeRespondingSocket((path, s) => {
          if (path === droppedPath) return; // drop the reply
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        });
        sockets.push(socket);
        return socket;
      },
      log: vi.fn(),
    };

    await expect(
      captureSceneFromConsole(deps, GRANTED, '192.168.1.77', {
        name: 'n',
        note: 'note',
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      })
    ).rejects.toThrow(droppedPath);
  });

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
          if (path === droppedPath) return;
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path))), { address: '192.168.1.77' });
        });
      },
      log: vi.fn(),
      writeFile,
    };

    await expect(
      captureSceneToFile(deps, GRANTED, '192.168.1.77', '/tmp/scene.scn', {
        name: 'n',
        note: 'note',
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      })
    ).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
