// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const createSocketMock = vi.hoisted(() => vi.fn());
vi.mock('dgram', () => ({ createSocket: (...args: unknown[]) => createSocketMock(...args) }));

import {
  parseStatusReply,
  queryConsole,
  fetchConsoleIdentity,
  startConsoleHeartbeat,
  DEFAULT_CONNECTION_QUERY_TIMEOUT_MS,
  DEFAULT_CONNECTION_QUERY_MAX_RETRIES,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from './console-connection';
import { parseXInfoReply, type ConsoleDiscoverySocket, type ConsoleDiscoveryDeps } from './console-discovery';
import { ConsoleNetworkConsentError } from '../console-network-consent';
import { encodeOscMessage, decodeOscMessage, type DecodedOscMessage } from '@sound-buddy/console/dist-cjs/index.js';

type FakeSocket = ConsoleDiscoverySocket & {
  bind: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit: EventEmitter['emit'];
};

function fakeSocket(): FakeSocket {
  const emitter = new EventEmitter();
  const socket = emitter as unknown as FakeSocket;
  socket.bind = vi.fn((cb: () => void) => cb());
  socket.send = vi.fn();
  socket.close = vi.fn();
  return socket;
}

// The read-only OSC encoder guard (#875) only allowlists a fixed set of
// addresses for outbound messages with args — /status (a reply-only address
// this app never sends args to) isn't one of them. This hand-rolled OSC 1.0
// string-message encoder builds a fake *incoming* /status reply datagram for
// tests without going through (or needing to loosen) that outbound guard.
function encodeOscStringMessage(address: string, values: string[]): Buffer {
  const pad4 = (len: number) => (4 - (len % 4)) % 4;
  const encodeString = (s: string) => {
    const bytes = Array.from(new TextEncoder().encode(s));
    const out = [...bytes, 0];
    for (let i = 0; i < pad4(bytes.length + 1); i++) out.push(0);
    return out;
  };
  const out = [...encodeString(address), ...encodeString(`,${values.map(() => 's').join('')}`)];
  for (const v of values) out.push(...encodeString(v));
  return Buffer.from(out);
}

function statusReplyBuffer(state: string, ip: string, name: string): Buffer {
  return encodeOscStringMessage('/status', [state, ip, name]);
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

function addressOfSend(socket: FakeSocket, callIndex = 0): string {
  const call = socket.send.mock.calls[callIndex] as [Uint8Array, number, string];
  const decoded = decodeOscMessage(new Uint8Array(call[0]));
  return decoded.address;
}

const GRANTED = { consoleNetworkConsentGranted: true };
const DENIED = { consoleNetworkConsentGranted: false };

afterEach(() => {
  vi.useRealTimers();
  createSocketMock.mockReset();
});

describe('parseStatusReply', () => {
  it('parses a valid sss /status reply', () => {
    const message: DecodedOscMessage = {
      address: '/status',
      typeTags: ',sss',
      args: [
        { type: 's', value: 'active' },
        { type: 's', value: '192.168.1.50' },
        { type: 's', value: 'FOH' },
      ],
    };
    expect(parseStatusReply(message)).toEqual({ state: 'active', ip: '192.168.1.50', name: 'FOH' });
  });

  it('returns null for a reply with the wrong address', () => {
    const message: DecodedOscMessage = { address: '/xinfo', typeTags: ',', args: [] };
    expect(parseStatusReply(message)).toBeNull();
  });

  it('returns null for a reply with the wrong arg count', () => {
    const message: DecodedOscMessage = {
      address: '/status',
      typeTags: ',ss',
      args: [
        { type: 's', value: 'active' },
        { type: 's', value: '192.168.1.50' },
      ],
    };
    expect(parseStatusReply(message)).toBeNull();
  });

  it('returns null when an arg is not a string type', () => {
    const message: DecodedOscMessage = {
      address: '/status',
      typeTags: ',ssi',
      args: [
        { type: 's', value: 'active' },
        { type: 's', value: '192.168.1.50' },
        { type: 'i', value: 1 },
      ],
    };
    expect(parseStatusReply(message)).toBeNull();
  });
});

describe('queryConsole', () => {
  it('resolves when a matching reply arrives after the first send', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });

    await expect(promise).resolves.toEqual({ ip: '192.168.1.77', model: 'M32R', firmware: '4.02', name: 'FOH' });
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('ignores an unparsable datagram and an unrelated-address reply without settling', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
    let settled = false;
    promise.then(() => (settled = true), () => (settled = true));

    socket.emit('message', Buffer.from('not-valid-osc-no-nul-terminator'), { address: '192.168.1.77' });
    socket.emit('message', Buffer.from(encodeOscMessage({ address: '/xremote', args: [] })), {
      address: '192.168.1.77',
    });
    await Promise.resolve();

    expect(log).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });
    await expect(promise).resolves.toEqual({ ip: '192.168.1.77', model: 'M32R', firmware: '4.02', name: 'FOH' });
  });

  it('retries after a timeoutMs with no reply, then resolves on the retried send', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
    expect(socket.send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECTION_QUERY_TIMEOUT_MS);
    expect(socket.send).toHaveBeenCalledTimes(2);

    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });
    await expect(promise).resolves.toEqual({ ip: '192.168.1.77', model: 'M32R', firmware: '4.02', name: 'FOH' });
  });

  it('rejects after maxRetries + 1 unanswered attempts (silent console) and terminates cleanly', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
    const assertion = expect(promise).rejects.toThrow(
      /No reply from console at 192\.168\.1\.77:10023 for "\/xinfo" after 3 retries \(350ms each\)/
    );

    await vi.advanceTimersByTimeAsync(
      DEFAULT_CONNECTION_QUERY_TIMEOUT_MS * (DEFAULT_CONNECTION_QUERY_MAX_RETRIES + 1)
    );

    await assertion;
    expect(socket.send).toHaveBeenCalledTimes(DEFAULT_CONNECTION_QUERY_MAX_RETRIES + 1);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('rejects when the socket emits an error', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
    const err = new Error('EADDRINUSE');
    socket.emit('error', err);

    await expect(promise).rejects.toBe(err);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('a late message after resolving is a no-op (no double resolve, no throw)', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
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

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });
    await promise;

    expect(() => socket.emit('error', new Error('late'))).not.toThrow();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('honors custom timeoutMs/maxRetries options', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply, {
      timeoutMs: 100,
      maxRetries: 1,
    });
    const assertion = expect(promise).rejects.toThrow(/after 1 retries \(100ms each\)/);

    await vi.advanceTimersByTimeAsync(100 * 2);
    await assertion;
    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  it('uses defaultCreateSocket (real dgram) when deps.createSocket is omitted', async () => {
    const socket = fakeSocket();
    createSocketMock.mockReturnValueOnce(socket);
    const deps: ConsoleDiscoveryDeps = { log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });

    await expect(promise).resolves.toEqual({ ip: '192.168.1.77', model: 'M32R', firmware: '4.02', name: 'FOH' });
    expect(createSocketMock).toHaveBeenCalledWith('udp4');
  });

  it('encodes options.requestArgs onto the wire (#888: /node carries the path as one string arg)', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/node', () => 'ok', {
      requestArgs: [{ type: 's', value: '/ch/01/config' }],
    });
    const call = socket.send.mock.calls[0] as [Uint8Array, number, string];
    const decoded = decodeOscMessage(new Uint8Array(call[0]));
    expect(decoded.address).toBe('/node');
    expect(decoded.args).toEqual([{ type: 's', value: '/ch/01/config' }]);

    socket.emit('message', Buffer.from(encodeOscMessage({ address: '/node', args: [] })), {
      address: '192.168.1.77',
    });
    await promise;
  });

  it('sends a zero-arg message when options.requestArgs is omitted', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const promise = queryConsole(deps, '192.168.1.77', '/xinfo', parseXInfoReply);
    const call = socket.send.mock.calls[0] as [Uint8Array, number, string];
    const decoded = decodeOscMessage(new Uint8Array(call[0]));
    expect(decoded.args).toEqual([]);

    socket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), { address: '192.168.1.77' });
    await promise;
  });
});

describe('fetchConsoleIdentity', () => {
  it('rejects with ConsoleNetworkConsentError before any socket is created when consent is not granted', async () => {
    const createSocket = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket, log: vi.fn() };

    await expect(fetchConsoleIdentity(deps, DENIED, '192.168.1.77')).rejects.toBeInstanceOf(
      ConsoleNetworkConsentError
    );
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('resolves a merged identity when both /xinfo and /info reply', async () => {
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = {
      createSocket: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      log: vi.fn(),
    };

    const promise = fetchConsoleIdentity(deps, GRANTED, '192.168.1.77');
    await Promise.resolve();
    await Promise.resolve();

    expect(sockets).toHaveLength(2);
    const xinfoSocket = sockets.find((s) => addressOfSend(s) === '/xinfo')!;
    const infoSocket = sockets.find((s) => addressOfSend(s) === '/info')!;
    expect(xinfoSocket).toBeDefined();
    expect(infoSocket).toBeDefined();

    xinfoSocket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), {
      address: '192.168.1.77',
    });
    infoSocket.emit('message', infoReplyBuffer('2.09', 'osc-1.0', 'M32R', '4.02'), { address: '192.168.1.77' });

    await expect(promise).resolves.toEqual({
      ip: '192.168.1.77',
      name: 'FOH',
      model: 'M32R',
      firmware: '4.02',
      serverVersion: '2.09',
      oscServer: 'osc-1.0',
    });
  });

  it('rejects if either query times out', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const deps: ConsoleDiscoveryDeps = {
      createSocket: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      log: vi.fn(),
    };

    const promise = fetchConsoleIdentity(deps, GRANTED, '192.168.1.77');
    const assertion = expect(promise).rejects.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    const xinfoSocket = sockets.find((s) => addressOfSend(s) === '/xinfo')!;
    xinfoSocket.emit('message', xinfoReplyBuffer('192.168.1.77', 'FOH', 'M32R', '4.02'), {
      address: '192.168.1.77',
    });

    await vi.advanceTimersByTimeAsync(
      DEFAULT_CONNECTION_QUERY_TIMEOUT_MS * (DEFAULT_CONNECTION_QUERY_MAX_RETRIES + 1)
    );

    await assertion;
  });
});

describe('startConsoleHeartbeat', () => {
  it('throws synchronously when consent is not granted', () => {
    const createSocket = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket, log: vi.fn() };

    expect(() => startConsoleHeartbeat(deps, DENIED, '192.168.1.77', vi.fn())).toThrow(ConsoleNetworkConsentError);
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('calls onStatusChange("online") on the immediate poll when /status replies', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onStatusChange = vi.fn();

    const stop = startConsoleHeartbeat(deps, GRANTED, '192.168.1.77', onStatusChange);
    socket.emit('message', statusReplyBuffer('active', '192.168.1.77', 'FOH'), { address: '192.168.1.77' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(onStatusChange).toHaveBeenCalledWith('online');
    stop();
  });

  it('calls onStatusChange("offline") after a poll exhausts its retries with no reply', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onStatusChange = vi.fn();

    const stop = startConsoleHeartbeat(deps, GRANTED, '192.168.1.77', onStatusChange);
    await vi.advanceTimersByTimeAsync(
      DEFAULT_CONNECTION_QUERY_TIMEOUT_MS * (DEFAULT_CONNECTION_QUERY_MAX_RETRIES + 1)
    );

    expect(onStatusChange).toHaveBeenCalledWith('offline');
    stop();
  });

  it('the returned stop function prevents further onStatusChange calls after subsequent ticks', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onStatusChange = vi.fn();

    const stop = startConsoleHeartbeat(deps, GRANTED, '192.168.1.77', onStatusChange, {
      intervalMs: 5000,
    });
    socket.emit('message', statusReplyBuffer('active', '192.168.1.77', 'FOH'), { address: '192.168.1.77' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatusChange).toHaveBeenCalledTimes(1);

    stop();
    await vi.advanceTimersByTimeAsync(5000 * 3);

    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });

  it('a reply that arrives after stop() does not call onStatusChange("online")', async () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onStatusChange = vi.fn();

    const stop = startConsoleHeartbeat(deps, GRANTED, '192.168.1.77', onStatusChange);
    stop();
    socket.emit('message', statusReplyBuffer('active', '192.168.1.77', 'FOH'), { address: '192.168.1.77' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('retries exhausted after stop() do not call onStatusChange("offline")', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onStatusChange = vi.fn();

    const stop = startConsoleHeartbeat(deps, GRANTED, '192.168.1.77', onStatusChange);
    stop();
    await vi.advanceTimersByTimeAsync(
      DEFAULT_CONNECTION_QUERY_TIMEOUT_MS * (DEFAULT_CONNECTION_QUERY_MAX_RETRIES + 1)
    );

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('every request this heartbeat sends targets "/status" — never "/-status"', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onStatusChange = vi.fn();

    const stop = startConsoleHeartbeat(deps, GRANTED, '192.168.1.77', onStatusChange);
    await vi.advanceTimersByTimeAsync(
      DEFAULT_CONNECTION_QUERY_TIMEOUT_MS * (DEFAULT_CONNECTION_QUERY_MAX_RETRIES + 1)
    );

    expect(socket.send.mock.calls.length).toBeGreaterThan(0);
    for (let i = 0; i < socket.send.mock.calls.length; i++) {
      expect(addressOfSend(socket, i)).toBe('/status');
    }
    stop();
  });

  it('uses DEFAULT_HEARTBEAT_INTERVAL_MS when options.intervalMs is omitted', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onStatusChange = vi.fn();

    const stop = startConsoleHeartbeat(deps, GRANTED, '192.168.1.77', onStatusChange);
    socket.emit('message', statusReplyBuffer('active', '192.168.1.77', 'FOH'), { address: '192.168.1.77' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatusChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS - 1);
    expect(onStatusChange).toHaveBeenCalledTimes(1);

    stop();
  });
});
