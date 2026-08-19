// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';

const createSocketMock = vi.hoisted(() => vi.fn());
vi.mock('dgram', () => ({ createSocket: (...args: unknown[]) => createSocketMock(...args) }));

import {
  startMeterSubscription,
  deriveFrameStallMs,
  METER_STALL_INTERVAL_MULTIPLIER,
  type MeterSubscriptionHandle,
} from './console-meters';
import { ConsoleNetworkConsentError } from '../console-network-consent';
import { CONSOLE_OSC_PORT, type ConsoleDiscoveryDeps, type ConsoleDiscoverySocket } from './console-discovery';
import {
  DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS,
  DEFAULT_METER_FRAME_STALL_MS,
  DEFAULT_SUBSCRIPTION_GRACE_MS,
} from './console-subscription';
import { decodeOscMessage, encodeOscMessage } from '@sound-buddy/console/dist-cjs/index.js';

const GRANTED = { consoleNetworkConsentGranted: true };
const DENIED = { consoleNetworkConsentGranted: false };
const IP = '192.168.1.77';

type FakeSocket = ConsoleDiscoverySocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  bind: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

function fakeSocket(options?: { deferBind?: boolean }): FakeSocket {
  const handlers: Record<string, ((...a: never[]) => void)[]> = {};
  let bindCallback: (() => void) | undefined;
  return {
    send: vi.fn(),
    close: vi.fn(),
    setBroadcast: vi.fn(),
    bind: vi.fn((cb: () => void) => {
      if (options?.deferBind) {
        bindCallback = cb;
        return;
      }
      cb();
    }),
    on: vi.fn((event: string, listener: (...a: never[]) => void) => {
      (handlers[event] ??= []).push(listener);
    }),
    emit: (event: string, ...args: unknown[]) => {
      if (event === '__runBind__') {
        bindCallback?.();
        return;
      }
      handlers[event]?.forEach((l) => (l as (...a: unknown[]) => void)(...args));
    },
  } as FakeSocket;
}

function buildMeterBlob(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(4 + values.length * 4);
  const view = new DataView(buffer);
  view.setInt32(0, values.length, true);
  values.forEach((v, i) => view.setFloat32(4 + i * 4, v, true));
  return new Uint8Array(buffer);
}

function pad4(len: number): number {
  return (4 - (len % 4)) % 4;
}

// A real /meters/1 push is never built with encodeOscMessage — it arrives as
// a raw incoming UDP packet decoded straight by decodeOscMessage, and
// encodeOscMessage's read-only guard allowlists only exact-match '/meters'
// (not '/meters/1') for args-bearing messages, per meters.test.ts's own
// end-to-end test comment. So datagrams here are hand-assembled the same way
// the console package's own /meters/1 encoding tests are.
function metersDatagram(values: number[]): Uint8Array {
  const blob = buildMeterBlob(values);
  const out: number[] = [];
  const addressBytes = Array.from(new TextEncoder().encode('/meters/1'));
  out.push(...addressBytes, 0);
  for (let i = 0; i < pad4(addressBytes.length + 1); i++) out.push(0);
  const tagBytes = Array.from(new TextEncoder().encode(',b'));
  out.push(...tagBytes, 0);
  for (let i = 0; i < pad4(tagBytes.length + 1); i++) out.push(0);
  const sizeBuffer = new ArrayBuffer(4);
  new DataView(sizeBuffer).setInt32(0, blob.length, false);
  out.push(...new Uint8Array(sizeBuffer));
  out.push(...blob);
  for (let i = 0; i < pad4(blob.length); i++) out.push(0);
  return new Uint8Array(out);
}

const GOOD_FRAME_VALUES = Array.from({ length: 96 }, (_, i) => i / 100);

function addressesOfSends(socket: FakeSocket): string[] {
  return socket.send.mock.calls.map((call) => decodeOscMessage(new Uint8Array(call[0] as Uint8Array)).address);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('startMeterSubscription — consent gate', () => {
  it('throws and never creates a socket when consent is not granted', () => {
    const createSocket = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket, log: vi.fn() };

    expect(() => startMeterSubscription(deps, DENIED, IP, vi.fn(), vi.fn())).toThrow(ConsoleNetworkConsentError);
    expect(createSocket).not.toHaveBeenCalled();
  });
});

describe('startMeterSubscription — subscribe message', () => {
  it('sends the default ,s subscribe form on bind, to CONSOLE_OSC_PORT and the given ip', () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), vi.fn());

    const first = socket.send.mock.calls[0];
    const decoded = decodeOscMessage(new Uint8Array(first[0] as Uint8Array));
    expect(decoded.address).toBe('/meters');
    expect(decoded.typeTags).toBe(',s');
    expect(decoded.args).toEqual([{ type: 's', value: '/meters/1' }]);
    expect(first[1]).toBe(CONSOLE_OSC_PORT);
    expect(first[2]).toBe(IP);
    handle.stop();
  });

  it('sends the ,siii throttle form when a timeFactor is supplied', () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), vi.fn(), { timeFactor: 20 });

    const first = socket.send.mock.calls[0];
    const decoded = decodeOscMessage(new Uint8Array(first[0] as Uint8Array));
    expect(decoded.typeTags).toBe(',siii');
    expect(decoded.args).toEqual([
      { type: 's', value: '/meters/1' },
      { type: 'i', value: 0 },
      { type: 'i', value: 0 },
      { type: 'i', value: 20 },
    ]);
    handle.stop();
  });
});

describe('startMeterSubscription — renewal', () => {
  it('sends /xremote + /renew after the initial subscribe, and repeats after DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), vi.fn());

    expect(addressesOfSends(socket)).toEqual(['/meters', '/xremote', '/renew']);

    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS);
    expect(addressesOfSends(socket)).toEqual(['/meters', '/xremote', '/renew', '/xremote', '/renew']);
    handle.stop();
  });
});

describe('startMeterSubscription — frame decoding', () => {
  it('decodes a real /meters/1 datagram and calls onFrame once with 32/32/32 arrays; no reconnect across two stall windows of steady frames', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onFrame = vi.fn();
    const onEvent = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, onFrame, onEvent);

    socket.emit('message', Buffer.from(metersDatagram(GOOD_FRAME_VALUES)), { address: IP });
    expect(onFrame).toHaveBeenCalledTimes(1);
    const snapshot = onFrame.mock.calls[0][0];
    expect(snapshot.inputs).toHaveLength(32);
    expect(snapshot.gateGainReduction).toHaveLength(32);
    expect(snapshot.dynamicsGainReduction).toHaveLength(32);
    expect(snapshot.inputs[0]).toBeCloseTo(GOOD_FRAME_VALUES[0], 5);

    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS - 1);
      socket.emit('message', Buffer.from(metersDatagram(GOOD_FRAME_VALUES)), { address: IP });
    }
    expect(onEvent).not.toHaveBeenCalledWith({ type: 'reconnect' });
    handle.stop();
  });

  it('logs and ignores an unparsable datagram without calling onFrame or throwing', () => {
    const socket = fakeSocket();
    const log = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log };
    const onFrame = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, onFrame, vi.fn());

    expect(() => socket.emit('message', Buffer.from([1, 2, 3]), { address: IP })).not.toThrow();
    expect(onFrame).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('unparsable'));
    handle.stop();
  });

  it('logs and ignores a reply for an unrelated address without calling onFrame', () => {
    const socket = fakeSocket();
    const log = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log };
    const onFrame = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, onFrame, vi.fn());

    const statusReply = encodeOscMessage({ address: '/status', args: [] });
    socket.emit('message', Buffer.from(statusReply), { address: IP });
    expect(onFrame).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('unrelated'));
    handle.stop();
  });

  it('logs and ignores a malformed /meters/1 blob without calling onFrame, and a subsequent good frame still reaches onFrame', () => {
    const socket = fakeSocket();
    const log = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log };
    const onFrame = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, onFrame, vi.fn());

    socket.emit('message', Buffer.from(metersDatagram([1, 2, 3])), { address: IP });
    expect(onFrame).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('malformed'));

    socket.emit('message', Buffer.from(metersDatagram(GOOD_FRAME_VALUES)), { address: IP });
    expect(onFrame).toHaveBeenCalledTimes(1);
    handle.stop();
  });
});

describe('startMeterSubscription — liveness watchdog integration', () => {
  it('fires degraded-to-polling when no frames arrive within DEFAULT_SUBSCRIPTION_GRACE_MS', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), onEvent);
    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_GRACE_MS);

    expect(onEvent).toHaveBeenCalledWith({ type: 'degraded-to-polling' });
    handle.stop();
  });

  it('fires reconnect after frames stop flowing', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), onEvent);
    socket.emit('message', Buffer.from(metersDatagram(GOOD_FRAME_VALUES)), { address: IP });

    await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS);
    expect(onEvent).toHaveBeenCalledWith({ type: 'reconnect' });
    handle.stop();
  });
});

describe('deriveFrameStallMs', () => {
  it('is DEFAULT_METER_FRAME_STALL_MS for a fast (default) interval', () => {
    expect(deriveFrameStallMs(50)).toBe(DEFAULT_METER_FRAME_STALL_MS);
  });

  it('scales with the configured interval via METER_STALL_INTERVAL_MULTIPLIER once it exceeds the default floor', () => {
    expect(deriveFrameStallMs(4950)).toBe(4950 * METER_STALL_INTERVAL_MULTIPLIER);
  });

  it('does not false-positive a healthy heavily-throttled (tf=99) stream at the un-derived default stall window', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), onEvent, { timeFactor: 99 });
    socket.emit('message', Buffer.from(metersDatagram(GOOD_FRAME_VALUES)), { address: IP });

    await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS);
    expect(onEvent).not.toHaveBeenCalledWith({ type: 'reconnect' });
    handle.stop();
  });
});

describe('startMeterSubscription — datagram arriving before bind completes', () => {
  it('does not throw and still calls onFrame when a message arrives before bind`s callback runs', () => {
    const socket = fakeSocket({ deferBind: true });
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onFrame = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, onFrame, vi.fn());

    expect(() =>
      socket.emit('message', Buffer.from(metersDatagram(GOOD_FRAME_VALUES)), { address: IP }),
    ).not.toThrow();
    expect(onFrame).toHaveBeenCalledTimes(1);

    socket.emit('__runBind__');
    expect(socket.send).toHaveBeenCalled();
    handle.stop();
  });
});

describe('startMeterSubscription — socket errors', () => {
  it('logs and emits reconnect on a socket error while subscribed', () => {
    const socket = fakeSocket();
    const log = vi.fn();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log };
    const onEvent = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), onEvent);
    socket.emit('error', new Error('ECONNREFUSED'));

    expect(log).toHaveBeenCalledWith(expect.stringContaining('socket error'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'reconnect' });
    handle.stop();
  });

  it('emits nothing on a socket error after stop()', () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), onEvent);
    handle.stop();
    onEvent.mockClear();

    socket.emit('error', new Error('ECONNREFUSED'));
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('startMeterSubscription — default socket factory', () => {
  it('uses defaultCreateSocket (real dgram) when deps.createSocket is omitted', () => {
    const socket = fakeSocket();
    createSocketMock.mockReturnValueOnce(socket);
    const deps: ConsoleDiscoveryDeps = { log: vi.fn() };

    const handle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), vi.fn());

    expect(createSocketMock).toHaveBeenCalledWith('udp4');
    handle.stop();
  });
});

describe('startMeterSubscription — stop()', () => {
  it('closes the socket once and stops renewal; a second stop() does not close twice or resend', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };

    const handle: MeterSubscriptionHandle = startMeterSubscription(deps, GRANTED, IP, vi.fn(), vi.fn());
    handle.stop();
    expect(socket.close).toHaveBeenCalledTimes(1);

    const sendCountAfterStop = socket.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS * 3);
    expect(socket.send).toHaveBeenCalledTimes(sendCountAfterStop);

    handle.stop();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('a message arriving after stop() is a no-op (does not call onFrame)', () => {
    const socket = fakeSocket();
    const deps: ConsoleDiscoveryDeps = { createSocket: () => socket, log: vi.fn() };
    const onFrame = vi.fn();

    const handle = startMeterSubscription(deps, GRANTED, IP, onFrame, vi.fn());
    handle.stop();

    socket.emit('message', Buffer.from(metersDatagram(GOOD_FRAME_VALUES)), { address: IP });
    expect(onFrame).not.toHaveBeenCalled();
  });
});
