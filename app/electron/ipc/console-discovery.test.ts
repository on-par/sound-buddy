// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const createSocketMock = vi.hoisted(() => vi.fn());
vi.mock('dgram', () => ({ createSocket: (...args: unknown[]) => createSocketMock(...args) }));

import {
  discoverConsoles,
  queryConsoleAtAddress,
  parseInfoReply,
  parseXInfoReply,
  CONSOLE_OSC_PORT,
  BROADCAST_ADDRESS,
  DEFAULT_LISTEN_WINDOW_MS,
  DEFAULT_RETRY_INTERVAL_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  type ConsoleDiscoverySocket,
  type ConsoleDiscoveryDeps,
} from './console-discovery';
import { ConsoleNetworkConsentError } from '../console-network-consent';
import { encodeOscMessage, type DecodedOscMessage } from '@sound-buddy/console/dist-cjs/index.js';

type FakeSocket = ConsoleDiscoverySocket & {
  bind: ReturnType<typeof vi.fn>;
  setBroadcast: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit: EventEmitter['emit'];
};

function fakeSocket(): FakeSocket {
  const emitter = new EventEmitter();
  const socket = emitter as unknown as FakeSocket;
  socket.bind = vi.fn((cb: () => void) => cb());
  socket.setBroadcast = vi.fn();
  socket.send = vi.fn();
  socket.close = vi.fn();
  return socket;
}

function infoReplyBuffer(serverVersion: string, oscServer: string, model: string, firmware: string): Buffer {
  return Buffer.from(
    encodeOscMessage({
      address: '/info',
      args: [
        { type: 's', value: serverVersion },
        { type: 's', value: oscServer },
        { type: 's', value: model },
        { type: 's', value: firmware },
      ],
    })
  );
}

function xinfoReplyBuffer(ip: string, name: string, model: string, firmware: string): Buffer {
  return Buffer.from(
    encodeOscMessage({
      address: '/xinfo',
      args: [
        { type: 's', value: ip },
        { type: 's', value: name },
        { type: 's', value: model },
        { type: 's', value: firmware },
      ],
    })
  );
}

const GRANTED = { consoleNetworkConsentGranted: true };
const DENIED = { consoleNetworkConsentGranted: false };

afterEach(() => {
  vi.useRealTimers();
  createSocketMock.mockReset();
});

describe('parseInfoReply', () => {
  it('parses a valid 4-string /info reply', () => {
    const message: DecodedOscMessage = {
      address: '/info',
      typeTags: ',ssss',
      args: [
        { type: 's', value: '2.09' },
        { type: 's', value: 'osc-1.0' },
        { type: 's', value: 'M32R' },
        { type: 's', value: '4.02' },
      ],
    };
    expect(parseInfoReply('192.168.1.50', message)).toEqual({
      ip: '192.168.1.50',
      model: 'M32R',
      firmware: '4.02',
      serverVersion: '2.09',
      oscServer: 'osc-1.0',
    });
  });

  it('returns null for a reply with the wrong address', () => {
    const message: DecodedOscMessage = { address: '/xremote', typeTags: ',', args: [] };
    expect(parseInfoReply('192.168.1.50', message)).toBeNull();
  });

  it('returns null for a reply with the wrong arg count', () => {
    const message: DecodedOscMessage = {
      address: '/info',
      typeTags: ',s',
      args: [{ type: 's', value: 'only-one' }],
    };
    expect(parseInfoReply('192.168.1.50', message)).toBeNull();
  });

  it('returns null when an arg is not a string type', () => {
    const message: DecodedOscMessage = {
      address: '/info',
      typeTags: ',sssi',
      args: [
        { type: 's', value: '2.09' },
        { type: 's', value: 'osc-1.0' },
        { type: 's', value: 'M32R' },
        { type: 'i', value: 4 },
      ],
    };
    expect(parseInfoReply('192.168.1.50', message)).toBeNull();
  });
});

describe('parseXInfoReply', () => {
  it('parses a valid 4-string /xinfo reply', () => {
    const message: DecodedOscMessage = {
      address: '/xinfo',
      typeTags: ',ssss',
      args: [
        { type: 's', value: '192.168.1.77' },
        { type: 's', value: 'FOH' },
        { type: 's', value: 'M32R' },
        { type: 's', value: '4.02' },
      ],
    };
    expect(parseXInfoReply(message)).toEqual({
      ip: '192.168.1.77',
      model: 'M32R',
      firmware: '4.02',
      name: 'FOH',
    });
  });

  it('returns null for a reply with the wrong address', () => {
    const message: DecodedOscMessage = { address: '/info', typeTags: ',', args: [] };
    expect(parseXInfoReply(message)).toBeNull();
  });

  it('returns null for a reply with the wrong arg count', () => {
    const message: DecodedOscMessage = {
      address: '/xinfo',
      typeTags: ',ss',
      args: [
        { type: 's', value: '192.168.1.77' },
        { type: 's', value: 'FOH' },
      ],
    };
    expect(parseXInfoReply(message)).toBeNull();
  });

  it('returns null when an arg is not a string type', () => {
    const message: DecodedOscMessage = {
      address: '/xinfo',
      typeTags: ',fsss',
      args: [
        { type: 'f', value: 1 },
        { type: 's', value: 'FOH' },
        { type: 's', value: 'M32R' },
        { type: 's', value: '4.02' },
      ],
    };
    expect(parseXInfoReply(message)).toBeNull();
  });
});

describe('discoverConsoles', () => {
  it('rejects with ConsoleNetworkConsentError without ever creating a socket when consent is not granted', async () => {
    const createSocket = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket, log: vi.fn() };

    await expect(discoverConsoles(deps, DENIED)).rejects.toBeInstanceOf(ConsoleNetworkConsentError);
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('resolves an empty array when nothing replies within the listen window', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    await vi.advanceTimersByTimeAsync(DEFAULT_LISTEN_WINDOW_MS);

    await expect(promise).resolves.toEqual([]);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('finds a console that replies to the very first broadcast', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    socket.emit('message', infoReplyBuffer('2.09', 'osc-1.0', 'M32R', '4.02'), { address: '192.168.1.50' });
    await vi.advanceTimersByTimeAsync(DEFAULT_LISTEN_WINDOW_MS);

    await expect(promise).resolves.toEqual([
      { ip: '192.168.1.50', model: 'M32R', firmware: '4.02', serverVersion: '2.09', oscServer: 'osc-1.0' },
    ]);
  });

  it('finds a console whose reply only arrives after the first retry (ARP-delay regression)', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    expect(socket.send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_INTERVAL_MS);
    expect(socket.send).toHaveBeenCalledTimes(2);

    socket.emit('message', infoReplyBuffer('2.09', 'osc-1.0', 'M32R', '4.02'), { address: '192.168.1.50' });
    await vi.advanceTimersByTimeAsync(DEFAULT_LISTEN_WINDOW_MS - DEFAULT_RETRY_INTERVAL_MS);

    await expect(promise).resolves.toEqual([
      { ip: '192.168.1.50', model: 'M32R', firmware: '4.02', serverVersion: '2.09', oscServer: 'osc-1.0' },
    ]);
  });

  it('dedupes multiple replies from the same source IP into a single entry', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    socket.emit('message', infoReplyBuffer('2.09', 'osc-1.0', 'M32R', '4.02'), { address: '192.168.1.50' });
    socket.emit('message', infoReplyBuffer('2.09', 'osc-1.0', 'M32R', '4.02'), { address: '192.168.1.50' });
    await vi.advanceTimersByTimeAsync(DEFAULT_LISTEN_WINDOW_MS);

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].ip).toBe('192.168.1.50');
  });

  it('ignores an unparsable datagram and a well-formed but irrelevant reply without rejecting', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log };

    const promise = discoverConsoles(deps, GRANTED);
    socket.emit('message', Buffer.from('not-valid-osc-no-nul-terminator'), { address: '10.0.0.5' });
    socket.emit(
      'message',
      Buffer.from(encodeOscMessage({ address: '/xremote', args: [] })),
      { address: '10.0.0.6' }
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_LISTEN_WINDOW_MS);

    await expect(promise).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('rejects when the socket emits an error', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    const err = new Error('EADDRINUSE');
    socket.emit('error', err);

    await expect(promise).rejects.toBe(err);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('a late socket error after the window already resolved is a no-op', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    await vi.advanceTimersByTimeAsync(DEFAULT_LISTEN_WINDOW_MS);
    await expect(promise).resolves.toEqual([]);

    expect(() => socket.emit('error', new Error('late'))).not.toThrow();
  });

  it('an error before bind completes rejects cleanly without touching timers that were never set', async () => {
    const socket = fakeSocket();
    socket.bind = vi.fn(); // never invokes its callback — simulates a bind failure on a real socket
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    const err = new Error('EACCES');
    socket.emit('error', err);

    await expect(promise).rejects.toBe(err);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('never sends to any address other than BROADCAST_ADDRESS (no unicast sweep)', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    await vi.advanceTimersByTimeAsync(DEFAULT_LISTEN_WINDOW_MS);
    await promise;

    const addresses = new Set(socket.send.mock.calls.map((call: unknown[]) => call[2]));
    const ports = new Set(socket.send.mock.calls.map((call: unknown[]) => call[1]));
    expect(socket.send.mock.calls.length).toBeGreaterThan(1);
    expect(addresses).toEqual(new Set([BROADCAST_ADDRESS]));
    expect(ports).toEqual(new Set([CONSOLE_OSC_PORT]));
  });

  it('uses defaultCreateSocket (real dgram) when deps.createSocket is omitted', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    createSocketMock.mockReturnValueOnce(socket);
    const deps: ConsoleDiscoveryDeps = { log: vi.fn() };

    const promise = discoverConsoles(deps, GRANTED);
    await vi.advanceTimersByTimeAsync(DEFAULT_LISTEN_WINDOW_MS);

    await expect(promise).resolves.toEqual([]);
    expect(createSocketMock).toHaveBeenCalledWith('udp4');
  });
});

describe('queryConsoleAtAddress', () => {
  it('rejects with ConsoleNetworkConsentError without ever creating a socket when consent is not granted', async () => {
    const createSocket = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket, log: vi.fn() };

    await expect(queryConsoleAtAddress(deps, DENIED, '192.168.1.77')).rejects.toBeInstanceOf(
      ConsoleNetworkConsentError
    );
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('resolves the identity on an /xinfo reply from the target IP', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });

    await expect(promise).resolves.toEqual({
      ip: '192.168.1.77',
      model: 'M32R',
      firmware: '4.02',
      name: 'FOH',
    });
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('resolves when the reply only arrives after the first retry (ARP-delay regression)', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    expect(socket.send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_INTERVAL_MS);
    expect(socket.send).toHaveBeenCalledTimes(2);

    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });

    await expect(promise).resolves.toEqual({
      ip: '192.168.1.77',
      model: 'M32R',
      firmware: '4.02',
      name: 'FOH',
    });
  });

  it('rejects with an actionable message (states the IP and port) when no reply arrives within the timeout', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    const assertion = expect(promise).rejects.toThrow(
      /No reply from a console at 192\.168\.1\.77:10023 within 4000ms/
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_QUERY_TIMEOUT_MS);

    await assertion;
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('ignores an unparsable datagram and a well-formed but irrelevant reply without rejecting', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    socket.emit('message', Buffer.from('not-valid-osc-no-nul-terminator'), { address: '192.168.1.77' });
    socket.emit(
      'message',
      Buffer.from(encodeOscMessage({ address: '/xremote', args: [] })),
      { address: '192.168.1.77' }
    );
    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });

    await expect(promise).resolves.toEqual({
      ip: '192.168.1.77',
      model: 'M32R',
      firmware: '4.02',
      name: 'FOH',
    });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('rejects when the socket emits an error', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    const err = new Error('EADDRINUSE');
    socket.emit('error', err);

    await expect(promise).rejects.toBe(err);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('a late message after resolving is a no-op (no double resolve, no throw)', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });
    await promise;

    expect(() =>
      socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' })
    ).not.toThrow();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('a late socket error after resolving is a no-op', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });
    await promise;

    expect(() => socket.emit('error', new Error('late'))).not.toThrow();
  });

  it('an error before bind completes rejects cleanly without touching timers that were never set', async () => {
    const socket = fakeSocket();
    socket.bind = vi.fn(); // never invokes its callback — simulates a bind failure on a real socket
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    const err = new Error('EACCES');
    socket.emit('error', err);

    await expect(promise).rejects.toBe(err);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('never sends to any address other than the exact requested IP (no unicast sweep)', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(DEFAULT_QUERY_TIMEOUT_MS);
    await assertion;

    const addresses = new Set(socket.send.mock.calls.map((call: unknown[]) => call[2]));
    const ports = new Set(socket.send.mock.calls.map((call: unknown[]) => call[1]));
    expect(socket.send.mock.calls.length).toBeGreaterThan(1);
    expect(addresses).toEqual(new Set(['192.168.1.77']));
    expect(ports).toEqual(new Set([CONSOLE_OSC_PORT]));
  });

  it('uses defaultCreateSocket (real dgram) when deps.createSocket is omitted', async () => {
    const socket = fakeSocket();
    createSocketMock.mockReturnValueOnce(socket);
    const deps: ConsoleDiscoveryDeps = { log: vi.fn() };

    const promise = queryConsoleAtAddress(deps, GRANTED, '192.168.1.77');
    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });

    await expect(promise).resolves.toEqual({
      ip: '192.168.1.77',
      model: 'M32R',
      firmware: '4.02',
      name: 'FOH',
    });
    expect(createSocketMock).toHaveBeenCalledWith('udp4');
  });
});
