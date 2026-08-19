// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const createSocketMock = vi.hoisted(() => vi.fn());
vi.mock('dgram', () => ({ createSocket: (...args: unknown[]) => createSocketMock(...args) }));

import { fetchSceneInventory } from './console-scene-inventory';
import type { ConsoleDiscoverySocket, ConsoleDiscoveryDeps } from './console-discovery';
import { ConsoleNetworkConsentError } from '../console-network-consent';
import {
  encodeOscMessage,
  decodeOscMessage,
  SCENE_INVENTORY_NODE_PATHS,
  SCENE_INVENTORY_SLOT_COUNT,
} from '@sound-buddy/console/dist-cjs/index.js';

type FakeSocket = ConsoleDiscoverySocket & {
  bind: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit: EventEmitter['emit'];
};

function makeRespondingSocket(respond: (path: string, socket: FakeSocket) => void): FakeSocket {
  const emitter = new EventEmitter();
  const socket = emitter as unknown as FakeSocket;
  socket.bind = vi.fn((cb: () => void) => cb());
  socket.close = vi.fn();
  socket.send = vi.fn((msg: Uint8Array) => {
    const decoded = decodeOscMessage(new Uint8Array(msg));
    const path = decoded.args[0] && decoded.args[0].type === 's' ? decoded.args[0].value : '';
    queueMicrotask(() => respond(path, socket));
  });
  return socket;
}

function syntheticLine(path: string, index: number): string {
  return `${path} "Scene ${index}" "" %000000000 1`;
}

function replyDatagram(line: string): Uint8Array {
  return encodeOscMessage({ address: '/node', args: [{ type: 's', value: `${line}\n` }] });
}

function fullResponder(sockets: FakeSocket[]): ConsoleDiscoveryDeps['createSocket'] {
  return () => {
    const socket = makeRespondingSocket((path, s) => {
      const index = SCENE_INVENTORY_NODE_PATHS.indexOf(path);
      s.emit('message', Buffer.from(replyDatagram(syntheticLine(path, index))), {
        address: '192.168.1.77',
      });
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

describe('fetchSceneInventory', () => {
  it('rejects with ConsoleNetworkConsentError before any socket is created when consent is not granted', async () => {
    const createSocket = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket, log: vi.fn() };

    await expect(fetchSceneInventory(deps, DENIED, '192.168.1.77')).rejects.toBeInstanceOf(
      ConsoleNetworkConsentError,
    );
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('resolves with 100 entries in slot order when every slot answers', async () => {
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = { createSocket: fullResponder(sockets), log: vi.fn() };

    const entries = await fetchSceneInventory(deps, GRANTED, '192.168.1.77');

    expect(entries).toHaveLength(SCENE_INVENTORY_SLOT_COUNT);
    expect(entries[0].index).toBe(0);
    expect(entries[0].name).toBe('Scene 0');
    expect(entries[99].index).toBe(99);
    expect(entries[99].path).toBe('/-show/showfile/scene/099');
  }, 20000);

  it('calls onProgress once per slot, ending at (SCENE_INVENTORY_SLOT_COUNT, SCENE_INVENTORY_SLOT_COUNT)', async () => {
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = { createSocket: fullResponder(sockets), log: vi.fn() };
    const onProgress = vi.fn();

    await fetchSceneInventory(deps, GRANTED, '192.168.1.77', { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(SCENE_INVENTORY_SLOT_COUNT);
    expect(onProgress).toHaveBeenLastCalledWith(SCENE_INVENTORY_SLOT_COUNT, SCENE_INVENTORY_SLOT_COUNT);
  }, 20000);

  it('rejects with an actionable error naming the ip, the unanswered slot path, and slots read, when a slot never answers', async () => {
    const droppedPath = SCENE_INVENTORY_NODE_PATHS[2];
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = {
      createSocket: () => {
        const socket = makeRespondingSocket((path, s) => {
          if (path === droppedPath) return; // drop the reply
          const index = SCENE_INVENTORY_NODE_PATHS.indexOf(path);
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path, index))), {
            address: '192.168.1.77',
          });
        });
        sockets.push(socket);
        return socket;
      },
      log: vi.fn(),
    };

    await expect(
      fetchSceneInventory(deps, GRANTED, '192.168.1.77', {
        queryOptions: { timeoutMs: 1, maxRetries: 0 },
      }),
    ).rejects.toThrow(new RegExp(`192\\.168\\.1\\.77.*${droppedPath.replace(/\//g, '\\/')}.*2 of 100`));
  });

  it('never resolves with a partial inventory when a slot fails', async () => {
    const droppedPath = SCENE_INVENTORY_NODE_PATHS[5];
    const deps: ConsoleDiscoveryDeps = {
      createSocket: () => {
        return makeRespondingSocket((path, s) => {
          if (path === droppedPath) return;
          const index = SCENE_INVENTORY_NODE_PATHS.indexOf(path);
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path, index))), {
            address: '192.168.1.77',
          });
        });
      },
      log: vi.fn(),
    };

    let resolved = false;
    await fetchSceneInventory(deps, GRANTED, '192.168.1.77', {
      queryOptions: { timeoutMs: 1, maxRetries: 0 },
    })
      .then(() => {
        resolved = true;
      })
      .catch(() => undefined);

    expect(resolved).toBe(false);
  });

  it('resolves a slot correctly even when a stale reply for a different slot arrives first', async () => {
    const staleSlotPath = SCENE_INVENTORY_NODE_PATHS[1];
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = {
      createSocket: () => {
        const socket = makeRespondingSocket((path, s) => {
          if (path === SCENE_INVENTORY_NODE_PATHS[0]) {
            // Answer with a stale reply for a different slot first, then the correct one.
            s.emit('message', Buffer.from(replyDatagram(syntheticLine(staleSlotPath, 1))), {
              address: '192.168.1.77',
            });
            queueMicrotask(() => {
              s.emit('message', Buffer.from(replyDatagram(syntheticLine(path, 0))), {
                address: '192.168.1.77',
              });
            });
            return;
          }
          const index = SCENE_INVENTORY_NODE_PATHS.indexOf(path);
          s.emit('message', Buffer.from(replyDatagram(syntheticLine(path, index))), {
            address: '192.168.1.77',
          });
        });
        sockets.push(socket);
        return socket;
      },
      log: vi.fn(),
    };

    const entries = await fetchSceneInventory(deps, GRANTED, '192.168.1.77');
    expect(entries[0].index).toBe(0);
    expect(entries[0].path).toBe(SCENE_INVENTORY_NODE_PATHS[0]);
  }, 20000);
});
