// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startSubscriptionRenewal,
  DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS,
  DEFAULT_METER_FRAME_STALL_MS,
  DEFAULT_SUBSCRIPTION_GRACE_MS,
  type ConsoleSubscriptionDeps,
  type ConsoleSubscriptionSocket,
} from './console-subscription';
import { ConsoleNetworkConsentError } from '../console-network-consent';
import { decodeOscMessage } from '@sound-buddy/console/dist-cjs/index.js';

function fakeSocket(): ConsoleSubscriptionSocket & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn() };
}

function addressesOfSends(socket: { send: ReturnType<typeof vi.fn> }): string[] {
  return socket.send.mock.calls.map((call) => decodeOscMessage(new Uint8Array(call[0] as Uint8Array)).address);
}

const GRANTED = { consoleNetworkConsentGranted: true };
const DENIED = { consoleNetworkConsentGranted: false };

afterEach(() => {
  vi.useRealTimers();
});

describe('startSubscriptionRenewal', () => {
  it('throws and sends nothing when consent is not granted', () => {
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };

    expect(() => startSubscriptionRenewal(deps, DENIED, '192.168.1.77', vi.fn())).toThrow(ConsoleNetworkConsentError);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('sends /xremote and /renew immediately on start', () => {
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', vi.fn());

    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(addressesOfSends(socket)).toEqual(['/xremote', '/renew']);
    handle.stop();
  });

  it('sends to CONSOLE_OSC_PORT and the given ip', () => {
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', vi.fn());

    for (const call of socket.send.mock.calls) {
      expect(call[1]).toBe(10023);
      expect(call[2]).toBe('192.168.1.77');
    }
    handle.stop();
  });

  it('does not resend before renewalIntervalMs elapses', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', vi.fn());
    expect(socket.send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS - 1);
    expect(socket.send).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it('resends /xremote and /renew again at renewalIntervalMs, and again at 2x', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', vi.fn());

    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS);
    expect(socket.send).toHaveBeenCalledTimes(4);
    expect(addressesOfSends(socket)).toEqual(['/xremote', '/renew', '/xremote', '/renew']);

    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS - 1);
    expect(socket.send).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(1);
    expect(socket.send).toHaveBeenCalledTimes(6);
    handle.stop();
  });

  it('honors a custom renewalIntervalMs option', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', vi.fn(), { renewalIntervalMs: 1000 });
    expect(socket.send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.send).toHaveBeenCalledTimes(4);
    handle.stop();
  });

  it('fires degraded-to-polling exactly once if onMeterFrame is never called', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_GRACE_MS);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'degraded-to-polling' });

    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_GRACE_MS * 3);
    expect(onEvent).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('does not fire degraded-to-polling when onMeterFrame is called before subscriptionGraceMs elapses', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_GRACE_MS - 1);
    handle.onMeterFrame();

    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_GRACE_MS * 3);
    expect(onEvent).not.toHaveBeenCalledWith({ type: 'degraded-to-polling' });
    handle.stop();
  });

  it('honors a custom subscriptionGraceMs option', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent, { subscriptionGraceMs: 1000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(onEvent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'degraded-to-polling' });
    handle.stop();
  });

  it('fires reconnect if a second onMeterFrame does not arrive within frameStallMs of the first', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    handle.onMeterFrame();
    expect(onEvent).not.toHaveBeenCalledWith({ type: 'reconnect' });

    await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS);
    expect(onEvent).toHaveBeenCalledWith({ type: 'reconnect' });
    handle.stop();
  });

  it('does not fire reconnect when onMeterFrame keeps arriving under frameStallMs (steady rate)', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    handle.onMeterFrame();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS - 1);
      handle.onMeterFrame();
    }

    expect(onEvent).not.toHaveBeenCalledWith({ type: 'reconnect' });
    handle.stop();
  });

  it('fires reconnect again every frameStallMs while the stall continues', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    handle.onMeterFrame();

    await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS * 3);
    const reconnectCalls = onEvent.mock.calls.filter((c) => c[0].type === 'reconnect');
    expect(reconnectCalls.length).toBeGreaterThanOrEqual(2);
    handle.stop();
  });

  it('a fresh onMeterFrame after a reconnect firing silences further reconnect events until the next stall', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    handle.onMeterFrame();

    await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS);
    expect(onEvent).toHaveBeenCalledWith({ type: 'reconnect' });
    onEvent.mockClear();

    handle.onMeterFrame();
    await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS - 1);
    expect(onEvent).not.toHaveBeenCalledWith({ type: 'reconnect' });

    await vi.advanceTimersByTimeAsync(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'reconnect' });
    handle.stop();
  });

  it('honors a custom frameStallMs option', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent, { frameStallMs: 500 });
    handle.onMeterFrame();

    await vi.advanceTimersByTimeAsync(499);
    expect(onEvent).not.toHaveBeenCalledWith({ type: 'reconnect' });

    await vi.advanceTimersByTimeAsync(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'reconnect' });
    handle.stop();
  });

  it('the first onMeterFrame call clears the grace timer so degraded-to-polling never fires even if the frame arrives right before grace elapses', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_GRACE_MS - 1);
    handle.onMeterFrame();
    await vi.advanceTimersByTimeAsync(1);

    expect(onEvent).not.toHaveBeenCalledWith({ type: 'degraded-to-polling' });
    handle.stop();
  });

  it('stop() clears the renewal interval, grace timer, and stall timer — no further sends or events occur', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    handle.onMeterFrame();
    handle.stop();

    socket.send.mockClear();
    onEvent.mockClear();

    await vi.advanceTimersByTimeAsync(
      DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS * 5 +
        DEFAULT_SUBSCRIPTION_GRACE_MS * 5 +
        DEFAULT_METER_FRAME_STALL_MS * 5
    );

    expect(socket.send).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('calling onMeterFrame after stop() does not resurrect the stall timer or emit events', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);
    handle.stop();
    onEvent.mockClear();

    expect(() => handle.onMeterFrame()).not.toThrow();
    await vi.advanceTimersByTimeAsync(DEFAULT_METER_FRAME_STALL_MS * 3);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('uses all three default constants when options is omitted entirely', async () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const deps: ConsoleSubscriptionDeps = { socket, log: vi.fn() };
    const onEvent = vi.fn();

    const handle = startSubscriptionRenewal(deps, GRANTED, '192.168.1.77', onEvent);

    await vi.advanceTimersByTimeAsync(DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS - 1);
    expect(socket.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.send).toHaveBeenCalledTimes(4);

    handle.stop();
  });
});
