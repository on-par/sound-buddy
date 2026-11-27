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

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  channelNodePaths,
  readChannelStates,
  readSlowTier,
  initialSlowTierState,
  startChannelStateSubscription,
  CONSOLE_CHANNEL_COUNT,
  DEFAULT_CHANNEL_POLL_INTERVAL_MS,
  type ConsoleChannelState,
  type ConsoleSlowTierSnapshot,
} from './console-channel-state';
import { MAX_NODE_QUERIES_PER_TICK } from './console-strip-detail';
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
  it('returns 96 zero-padded fast-tier paths: config, mix and dyn per channel', () => {
    const paths = channelNodePaths();

    expect(paths).toHaveLength(CONSOLE_CHANNEL_COUNT * 3);
    expect(paths[0]).toBe('/ch/01/config');
    expect(paths[1]).toBe('/ch/01/mix');
    expect(paths[2]).toBe('/ch/01/dyn');
    expect(paths[93]).toBe('/ch/32/config');
    expect(paths[94]).toBe('/ch/32/mix');
    expect(paths[95]).toBe('/ch/32/dyn');
  });

  it('honours an explicit count', () => {
    const paths = channelNodePaths(2);

    expect(paths).toEqual(['/ch/01/config', '/ch/01/mix', '/ch/01/dyn', '/ch/02/config', '/ch/02/mix', '/ch/02/dyn']);
  });
});

describe('readChannelStates', () => {
  it('returns index/name/faderDb/on/color/icon/dynamics for two channels, including -oo as -Infinity', async () => {
    queryConsoleMock
      .mockResolvedValueOnce('/ch/01/config "Kick" 1 RD 1')
      .mockResolvedValueOnce('/ch/01/mix ON -10.5 OFF +0')
      .mockResolvedValueOnce('/ch/01/dyn ON COMP PEAK LOG -23.0 5.0 1 0.00 10 10.0  151 POST 0 100 OFF')
      .mockResolvedValueOnce('/ch/02/config "Snare" 7 BLi 2')
      .mockResolvedValueOnce('/ch/02/mix OFF -oo OFF +0')
      .mockResolvedValueOnce('/ch/02/dyn OFF EXP RMS LIN -10.0 2.0 2 1.50 10 10.0  151 POST 0 100 OFF');

    const result = await readChannelStates(deps(), GRANTED, IP, { channelCount: 2 });

    expect(result).toEqual([
      {
        index: 1, name: 'Kick', faderDb: -10.5, on: true, icon: 1, color: { base: 'red', inverted: false },
        dynamics: { on: true, mode: 'COMP', thr: -23, ratio: 5, knee: 1, mgain: 0 },
      },
      {
        index: 2, name: 'Snare', faderDb: -Infinity, on: false, icon: 7, color: { base: 'blue', inverted: true },
        dynamics: { on: false, mode: 'EXP', thr: -10, ratio: 2, knee: 2, mgain: 1.5 },
      },
    ]);
  });

  it('passes { type: "s", value: path } as requestArgs and "/node" as the request address on every call', async () => {
    queryConsoleMock.mockResolvedValue('');

    await readChannelStates(deps(), GRANTED, IP, { channelCount: 1 });

    expect(queryConsoleMock).toHaveBeenCalledTimes(3);
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
      /did not answer "\/ch\/01\/mix" \(1 of 3 reads completed\)/
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
      expect((error as Error).message).toContain('0 of 3');
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
      .mockResolvedValueOnce('/ch/01/mix ON -10.5 OFF +0')
      .mockResolvedValueOnce('/ch/01/dyn ON COMP PEAK LOG -23.0 5.0 1 0.00 10 10.0  151 POST 0 100 OFF');
    const onSnapshot = vi.fn();
    const onError = vi.fn();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, onSnapshot, onError, {
      channelCount: 1,
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(onSnapshot).toHaveBeenCalledWith(
      [expect.objectContaining({ index: 1, name: 'Kick', faderDb: -10.5, on: true })],
      expect.any(Number)
    );
    expect(onError).not.toHaveBeenCalled();
    expect(queryConsoleMock).toHaveBeenCalledTimes(4);

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

const sceneLines = fs
  .readFileSync(fileURLToPath(new URL('../../../packages/console/src/capture-2026-08-16.scn', import.meta.url)), 'utf8')
  .split('\n')
  .map((l) => l.trim());

function sceneLine(path: string): string {
  return sceneLines.find((l) => l.startsWith(`${path} `)) ?? '';
}

interface RecordedQuery {
  address: string;
  path: string;
}

function recordingConsole(failPath?: (path: string) => boolean): RecordedQuery[] {
  const recorded: RecordedQuery[] = [];
  queryConsoleMock.mockImplementation((_d: unknown, _ip: unknown, address: string, _m: unknown, opts: { requestArgs: Array<{ value: string }> }) => {
    const path = opts.requestArgs[0].value;
    recorded.push({ address, path });
    if (failPath?.(path)) return Promise.reject(new Error(`no reply for ${path}`));
    return Promise.resolve(sceneLine(path));
  });
  return recorded;
}

describe('tiered /node poll (fast tier every tick, slow tier rotating)', () => {
  it('sends at most the per-tick cap of /node queries in one tick, all addressed /node', async () => {
    vi.useFakeTimers();
    const recorded = recordingConsole();
    const slow: ConsoleSlowTierSnapshot[] = [];

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, () => {}, () => {}, {
      pollIntervalMs: 1000,
      onSlowTier: (snap) => slow.push(snap),
    });
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();

    expect(slow).toHaveLength(1);
    expect(recorded.length).toBeLessThanOrEqual(MAX_NODE_QUERIES_PER_TICK);
    expect(recorded).toHaveLength(96 + 4 * 7 + 16 + 5);
    expect(new Set(recorded.map((q) => q.address))).toEqual(new Set(['/node']));
    expect(recorded.filter((q) => q.path.endsWith('/dyn'))).toHaveLength(32);
  });

  it('keeps every tick under the cap while rotating detail across all 32 strips within 8 ticks', async () => {
    vi.useFakeTimers();
    const recorded = recordingConsole();
    const perTick: number[] = [];
    let last = 0;
    const slow: ConsoleSlowTierSnapshot[] = [];

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, () => {}, () => {}, {
      pollIntervalMs: 1000,
      now: () => 1_000_000 + slow.length,
      onSlowTier: (snap) => {
        slow.push(snap);
        perTick.push(recorded.length - last);
        last = recorded.length;
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 7; i++) await vi.advanceTimersByTimeAsync(1000);
    handle.stop();

    expect(perTick).toHaveLength(8);
    for (const count of perTick) expect(count).toBeLessThanOrEqual(MAX_NODE_QUERIES_PER_TICK);
    const final = slow[slow.length - 1];
    expect(final.stripDetail.every((d) => d.preamp !== null && d.gate !== null && d.eq !== null)).toBe(true);
    expect(final.stripDetail.filter((d) => d.sends !== null).map((d) => d.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(final.surfaces.buses.slice(0, 16).every((b) => b.name !== null && b.mix !== null)).toBe(true);
    expect(final.stripDetail[0].preamp?.readAt).toBe(1_000_000);
    expect(final.stripDetail[31].preamp?.readAt).toBe(1_000_007);
  });

  it('a failing slow-tier read keeps fast-tier snapshots flowing and leaves the slow value unread instead of blanking anything', async () => {
    vi.useFakeTimers();
    recordingConsole((path) => path.includes('/preamp') || path.includes('/mix/'));
    const snapshots: ConsoleChannelState[][] = [];
    const slow: ConsoleSlowTierSnapshot[] = [];
    const errors: string[] = [];

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, (c) => snapshots.push(c), (e) => errors.push(e), {
      pollIntervalMs: 1000,
      onSlowTier: (snap) => slow.push(snap),
    });
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();

    expect(errors).toEqual([]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toHaveLength(32);
    expect(snapshots[0][1]).toMatchObject({ index: 2, name: 'Vox 1', faderDb: -5.8, on: true });
    expect(slow[0].stripDetail[0].preamp).toBeNull();
    expect(slow[0].stripDetail[0].sends).toBeNull();
    expect(slow[0].stripDetail[0].gate).not.toBeNull();
  });

  it('a slow-tier failure after a good read keeps the last value with its older read time so it ages', async () => {
    let failing = false;
    recordingConsole((path) => failing && path.endsWith('/gate'));
    let state = initialSlowTierState(4);
    let clock = 100;
    state = await readSlowTier(deps(), IP, state, () => clock);
    failing = true;
    clock = 900;
    state = await readSlowTier(deps(), IP, { ...state, cursor: { detail: 0, sends: 0, surface: 0 } }, () => clock);

    expect(state.stripDetail[0].gate?.readAt).toBe(100);
    expect(state.stripDetail[0].preamp?.readAt).toBe(900);
  });

  it('reads no slow tier at all when no slow-tier listener is attached', async () => {
    vi.useFakeTimers();
    const recorded = recordingConsole();

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, () => {}, () => {}, { pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();

    expect(recorded).toHaveLength(96);
  });

  it('drops the slow-tier result when stopped while the slow tier is in flight', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    queryConsoleMock.mockImplementation(async (_d: unknown, _ip: unknown, _a: string, _m: unknown, opts: { requestArgs: Array<{ value: string }> }) => {
      const path = opts.requestArgs[0].value;
      if (path === '/ch/01/preamp') await gate;
      return sceneLine(path);
    });
    const slow: ConsoleSlowTierSnapshot[] = [];

    const handle = startChannelStateSubscription(deps(), GRANTED, IP, () => {}, () => {}, {
      pollIntervalMs: 1000,
      onSlowTier: (snap) => slow.push(snap),
    });
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(slow).toEqual([]);
  });
});

describe('slow-tier stall when every slow-tier read times out at the real /node query timeout', () => {
  it('measures how long the next tick fast tier waits behind 49 timed-out slow-tier reads', async () => {
    vi.useFakeTimers();
    const actual = await vi.importActual<typeof import('./console-connection')>('./console-connection');
    const fastPaths = new Set(channelNodePaths());
    const datagrams: number[] = [];
    const fastTickStarts: number[] = [];
    const silentSocket = () => ({
      bind: (ready: () => void) => ready(),
      setBroadcast: () => {},
      send: () => {
        datagrams.push(Date.now());
      },
      on: () => {},
      close: () => {},
    });
    queryConsoleMock.mockImplementation(
      (d: ConsoleDiscoveryDeps, ip: string, address: string, parse: never, opts: { requestArgs: Array<{ value: string }> }) => {
        const path = opts.requestArgs[0].value;
        if (path === '/ch/01/config') fastTickStarts.push(Date.now());
        if (fastPaths.has(path)) return Promise.resolve(sceneLine(path));
        return actual.queryConsole(d, ip, address, parse, opts);
      }
    );
    const start = Date.now();
    const snapshots: number[] = [];
    const slowAt: number[] = [];
    const logs: string[] = [];
    const slowDeps: ConsoleDiscoveryDeps = { log: (m) => logs.push(m), createSocket: silentSocket };

    const handle = startChannelStateSubscription(slowDeps, GRANTED, IP, () => snapshots.push(Date.now() - start), () => {}, {
      onSlowTier: () => slowAt.push(Date.now() - start),
    });
    await vi.advanceTimersByTimeAsync(70_000);
    handle.stop();

    const perReadTimeoutMs = actual.DEFAULT_CONNECTION_QUERY_TIMEOUT_MS * (actual.DEFAULT_CONNECTION_QUERY_MAX_RETRIES + 1);
    const nextTickStart = fastTickStarts[1] - start;
    const fastTierDelayMs = nextTickStart - DEFAULT_CHANNEL_POLL_INTERVAL_MS;
    expect(perReadTimeoutMs).toBe(1400);
    expect(datagrams.filter((t) => t < fastTickStarts[1])).toHaveLength(49 * 4);
    expect(logs.filter((m) => m.includes('slow-tier read of'))).toHaveLength(49);
    expect(slowAt).toEqual([49 * perReadTimeoutMs]);
    expect(snapshots).toEqual([0, 69_000]);
    expect(nextTickStart).toBe(69_000);
    expect(fastTierDelayMs).toBe(68_000);
    expect(fastTierDelayMs).toBeGreaterThan(DEFAULT_CHANNEL_POLL_INTERVAL_MS);
  });
});
