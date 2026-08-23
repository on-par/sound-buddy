// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';

const queryConsoleMock = vi.hoisted(() => vi.fn());
vi.mock('./console-connection', () => ({ queryConsole: (...a: unknown[]) => queryConsoleMock(...a) }));

const assertConsoleNetworkConsentMock = vi.hoisted(() => vi.fn());
vi.mock('../console-network-consent', () => ({
  assertConsoleNetworkConsent: (...a: unknown[]) => assertConsoleNetworkConsentMock(...a),
  ConsoleNetworkConsentError: class ConsoleNetworkConsentError extends Error {},
}));

import {
  channelNodePaths,
  readChannelStates,
  startChannelStateSubscription,
  CONSOLE_CHANNEL_COUNT,
} from './console-channel-state';
import type { ConsoleDiscoveryDeps } from './console-discovery';

const GRANTED = { consoleNetworkConsentGranted: true };
const IP = '10.0.0.5';

function deps(): ConsoleDiscoveryDeps {
  return { log: vi.fn() };
}

afterEach(() => {
  queryConsoleMock.mockReset();
  assertConsoleNetworkConsentMock.mockReset();
  vi.useRealTimers();
});

describe('channelNodePaths', () => {
  it('returns 64 zero-padded paths starting /ch/01/config, /ch/01/mix', () => {
    const paths = channelNodePaths();

    expect(paths).toHaveLength(CONSOLE_CHANNEL_COUNT * 2);
    expect(paths[0]).toBe('/ch/01/config');
    expect(paths[1]).toBe('/ch/01/mix');
    expect(paths[62]).toBe('/ch/32/config');
    expect(paths[63]).toBe('/ch/32/mix');
  });

  it('honours an explicit count', () => {
    const paths = channelNodePaths(2);

    expect(paths).toEqual(['/ch/01/config', '/ch/01/mix', '/ch/02/config', '/ch/02/mix']);
  });
});

describe('readChannelStates', () => {
  it('returns index/name/faderDb/on for two channels, including -oo as -Infinity', async () => {
    queryConsoleMock
      .mockResolvedValueOnce('/ch/01/config "Kick" 1 RD 1')
      .mockResolvedValueOnce('/ch/01/mix ON -10.5 OFF +0')
      .mockResolvedValueOnce('/ch/02/config "Snare" 1 RD 1')
      .mockResolvedValueOnce('/ch/02/mix OFF -oo OFF +0');

    const result = await readChannelStates(deps(), GRANTED, IP, { channelCount: 2 });

    expect(result).toEqual([
      { index: 1, name: 'Kick', faderDb: -10.5, on: true },
      { index: 2, name: 'Snare', faderDb: -Infinity, on: false },
    ]);
  });

  it('passes { type: "s", value: path } as requestArgs and "/node" as the request address on every call', async () => {
    queryConsoleMock.mockResolvedValue('');

    await readChannelStates(deps(), GRANTED, IP, { channelCount: 1 });

    expect(queryConsoleMock).toHaveBeenCalledTimes(2);
    for (const call of queryConsoleMock.mock.calls) {
      expect(call[2]).toBe('/node');
      expect(call[4]).toMatchObject({ requestArgs: [{ type: 's', value: expect.any(String) }] });
    }
    expect(queryConsoleMock.mock.calls[0][4].requestArgs[0].value).toBe('/ch/01/config');
    expect(queryConsoleMock.mock.calls[1][4].requestArgs[0].value).toBe('/ch/01/mix');
  });

  it('rejects with a message naming the failing path and completed count, and stops calling queryConsole', async () => {
    queryConsoleMock.mockResolvedValueOnce('/ch/01/config "Kick" 1 RD 1').mockRejectedValueOnce(new Error('timeout'));

    await expect(readChannelStates(deps(), GRANTED, IP, { channelCount: 1 })).rejects.toThrow(
      /did not answer "\/ch\/01\/mix" \(1 of 2 reads completed\)/
    );
    expect(queryConsoleMock).toHaveBeenCalledTimes(2);
  });

  it('reports an exhausted first channel-state /node read as a protocol failure with its path and progress', async () => {
    const cause = new Error('timeout');
    queryConsoleMock.mockRejectedValue(cause);

    try {
      await readChannelStates(deps(), GRANTED, IP, { channelCount: 1 });
      throw new Error('Expected readChannelStates to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/channel-state \/node read\/protocol path/);
      expect((error as Error).message).toContain('/ch/01/config');
      expect((error as Error).message).toContain('0 of 2');
      expect((error as Error).message).toMatch(/verify the console's OSC\/remote-control path before trying Watch again/i);
      expect((error as Error).cause).toBe(cause);
    }
    expect(queryConsoleMock).toHaveBeenCalledTimes(2);
  });

  it('rejects when consent is not granted, before any queryConsole call', async () => {
    assertConsoleNetworkConsentMock.mockImplementation(() => {
      throw new Error('Console network access requires consent');
    });

    await expect(readChannelStates(deps(), { consoleNetworkConsentGranted: false }, IP)).rejects.toThrow(
      'Console network access requires consent'
    );
    expect(queryConsoleMock).not.toHaveBeenCalled();
  });
});

describe('startChannelStateSubscription', () => {
  it('throws synchronously without consent', () => {
    assertConsoleNetworkConsentMock.mockImplementation(() => {
      throw new Error('Console network access requires consent');
    });

    expect(() => startChannelStateSubscription(deps(), { consoleNetworkConsentGranted: false }, IP, vi.fn(), vi.fn())).toThrow(
      'Console network access requires consent'
    );
    expect(queryConsoleMock).not.toHaveBeenCalled();
  });

  it('emits a first snapshot immediately and another after pollIntervalMs', async () => {
    vi.useFakeTimers();
    queryConsoleMock.mockResolvedValue('/ch/01/config "Kick" 1 RD 1');
    const onSnapshot = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, onSnapshot, vi.fn(), {
      channelCount: 1,
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onSnapshot).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it('retries a rejected first channel config read and emits the recovered snapshot without an error', async () => {
    vi.useFakeTimers();
    queryConsoleMock
      .mockRejectedValueOnce(new Error('transient /node miss'))
      .mockResolvedValueOnce('/ch/01/config "Kick" 1 RD 1')
      .mockResolvedValueOnce('/ch/01/mix ON -10.5 OFF +0');
    const onSnapshot = vi.fn();
    const onError = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, onSnapshot, onError, {
      channelCount: 1,
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(onSnapshot).toHaveBeenCalledWith([{ index: 1, name: 'Kick', faderDb: -10.5, on: true }]);
    expect(onError).not.toHaveBeenCalled();
    expect(queryConsoleMock).toHaveBeenCalledTimes(3);

    handle.stop();
  });

  it('skips a tick that fires while a walk is still pending', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (v: string) => void;
    let callCount = 0;
    queryConsoleMock.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve('/ch/01/config "Kick" 1 RD 1');
    });
    const onSnapshot = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, onSnapshot, vi.fn(), {
      channelCount: 1,
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);
    // First walk still stuck on its first /node query; a tick during it must be dropped.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(callCount).toBe(1); // only the config query of the first (still in-flight) walk

    resolveFirst('/ch/01/config "Kick" 1 RD 1');
    await vi.advanceTimersByTimeAsync(0);
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it('calls onError with the actionable message on a rejected walk, and does not stop the loop', async () => {
    vi.useFakeTimers();
    queryConsoleMock.mockRejectedValue(new Error('no reply'));
    const onError = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, vi.fn(), onError, {
      channelCount: 1,
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/Couldn't read channel state/);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it('after stop(), neither onSnapshot nor onError fires and no further walk starts', async () => {
    vi.useFakeTimers();
    queryConsoleMock.mockResolvedValue('/ch/01/config "Kick" 1 RD 1');
    const onSnapshot = vi.fn();
    const onError = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, onSnapshot, onError, {
      channelCount: 1,
      pollIntervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    handle.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stop() called while a walk is in flight suppresses that walk\'s onSnapshot once it resolves', async () => {
    vi.useFakeTimers();
    let resolveMix!: (v: string) => void;
    queryConsoleMock
      .mockResolvedValueOnce('/ch/01/config "Kick" 1 RD 1') // config resolves immediately
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMix = resolve; // mix stays pending until we release it below
          })
      );
    const onSnapshot = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, onSnapshot, vi.fn(), {
      channelCount: 1,
      pollIntervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);

    handle.stop();
    resolveMix('/ch/01/mix ON +0 OFF +0');
    await vi.advanceTimersByTimeAsync(0);

    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it('stop() called while a walk is in flight suppresses that walk\'s onError once it rejects', async () => {
    vi.useFakeTimers();
    let rejectMix!: (err: unknown) => void;
    queryConsoleMock
      .mockResolvedValueOnce('/ch/01/config "Kick" 1 RD 1') // config resolves immediately
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectMix = reject; // mix stays pending until we release it below
          })
      );
    const onError = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, vi.fn(), onError, {
      channelCount: 1,
      pollIntervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);

    handle.stop();
    rejectMix(new Error('no reply'));
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).not.toHaveBeenCalled();
  });

  it('uses DEFAULT_CHANNEL_POLL_INTERVAL_MS when pollIntervalMs is omitted', async () => {
    vi.useFakeTimers();
    queryConsoleMock.mockResolvedValue('/ch/01/config "Kick" 1 RD 1');
    const onSnapshot = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, onSnapshot, vi.fn(), { channelCount: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // DEFAULT_CHANNEL_POLL_INTERVAL_MS
    expect(onSnapshot).toHaveBeenCalledTimes(2);

    handle.stop();
  });
});
