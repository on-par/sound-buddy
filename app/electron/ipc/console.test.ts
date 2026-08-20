// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
}));
const logMock = vi.fn();
const logWarnMock = vi.fn();
vi.mock('../logger', () => ({ log: (...a: unknown[]) => logMock(...a), logWarn: (...a: unknown[]) => logWarnMock(...a) }));
const getSettingsMock = vi.fn(() => ({ consoleNetworkConsentGranted: true }));
vi.mock('../settings', () => ({ getSettings: (...a: unknown[]) => getSettingsMock(...a) }));
const discoverConsolesMock = vi.fn();
vi.mock('./console-discovery', () => ({ discoverConsoles: (...a: unknown[]) => discoverConsolesMock(...a) }));
const fetchConsoleIdentityMock = vi.fn();
vi.mock('./console-connection', () => ({ fetchConsoleIdentity: (...a: unknown[]) => fetchConsoleIdentityMock(...a) }));
const startChannelStateSubscriptionMock = vi.fn();
vi.mock('./console-channel-state', () => ({
  startChannelStateSubscription: (...a: unknown[]) => startChannelStateSubscriptionMock(...a),
}));
const startMeterSubscriptionMock = vi.fn();
vi.mock('./console-meters', () => ({
  startMeterSubscription: (...a: unknown[]) => startMeterSubscriptionMock(...a),
}));

import { registerConsoleHandlers, isValidConsoleIp, CONSOLE_METER_TIME_FACTOR } from './console';

type Handler = (...args: unknown[]) => Promise<Record<string, unknown>>;

function scanConsoles() {
  return (handlers.get('scan-consoles') as Handler)();
}

function fetchIdentity(ip: unknown) {
  return (handlers.get('fetch-console-identity') as Handler)(undefined, ip);
}

function makeFakeEvent() {
  const sent: Array<[string, unknown]> = [];
  let destroyed = false;
  return {
    sent,
    setDestroyed: (v: boolean) => {
      destroyed = v;
    },
    event: {
      sender: {
        send: (channel: string, payload: unknown) => sent.push([channel, payload]),
        isDestroyed: () => destroyed,
      },
    },
  };
}

function startLiveState(event: unknown, ip: unknown) {
  return (handlers.get('start-console-live-state') as Handler)(event, ip);
}

function stopLiveState() {
  return (handlers.get('stop-console-live-state') as Handler)();
}

beforeEach(() => {
  handlers.clear();
  logMock.mockClear();
  logWarnMock.mockClear();
  getSettingsMock.mockClear();
  discoverConsolesMock.mockReset();
  fetchConsoleIdentityMock.mockReset();
  startChannelStateSubscriptionMock.mockReset();
  startMeterSubscriptionMock.mockReset();
  startMeterSubscriptionMock.mockReturnValue({ stop: vi.fn() });
  registerConsoleHandlers();
});

describe('isValidConsoleIp', () => {
  it('accepts a well-formed IPv4 address', () => {
    expect(isValidConsoleIp('192.168.1.50')).toBe(true);
  });

  it('rejects a non-string', () => {
    expect(isValidConsoleIp(42)).toBe(false);
    expect(isValidConsoleIp(undefined)).toBe(false);
  });

  it('rejects too few octets', () => {
    expect(isValidConsoleIp('1.2.3')).toBe(false);
  });

  it('rejects an octet over 255', () => {
    expect(isValidConsoleIp('1.2.3.256')).toBe(false);
  });

  it('rejects a leading-zero octet', () => {
    expect(isValidConsoleIp('01.2.3.4')).toBe(false);
  });

  it('rejects non-numeric text', () => {
    expect(isValidConsoleIp('not-an-ip')).toBe(false);
  });
});

describe('scan-consoles', () => {
  it('returns the discovered consoles on success', async () => {
    const consoles = [{ ip: '10.0.0.5', model: 'M32R', firmware: '4.0' }];
    discoverConsolesMock.mockResolvedValue(consoles);

    const result = await scanConsoles();

    expect(result).toEqual({ success: true, consoles });
  });

  it('maps a thrown error (consent denied / socket error) to an actionable failure, without rethrowing', async () => {
    discoverConsolesMock.mockRejectedValue(new Error('Console network access requires consent'));

    const result = await scanConsoles();

    expect(result).toEqual({ success: false, error: 'Console network access requires consent' });
    expect(logWarnMock).toHaveBeenCalled();
  });

  it('falls back to a generic actionable message when the thrown value has no message', async () => {
    discoverConsolesMock.mockRejectedValue('boom');

    const result = await scanConsoles();

    expect(result).toEqual({
      success: false,
      error: "Couldn't scan for a console. Check this Mac is on the same network as the console, then try again.",
    });
  });
});

describe('fetch-console-identity', () => {
  it('delegates to fetchConsoleIdentity for a valid IP', async () => {
    const identity = { ip: '10.0.0.5', model: 'M32R', firmware: '4.0', name: 'Main' };
    fetchConsoleIdentityMock.mockResolvedValue(identity);

    const result = await fetchIdentity('10.0.0.5');

    expect(result).toEqual({ success: true, identity });
    expect(fetchConsoleIdentityMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), '10.0.0.5');
  });

  it.each(['not-an-ip', '1.2.3', '1.2.3.256', '01.2.3.4', 42, undefined])(
    'rejects an invalid IP (%s) before touching the network',
    async (ip) => {
      const result = await fetchIdentity(ip);

      expect(result).toEqual({
        success: false,
        error: 'Enter the console IP as four numbers separated by dots, for example 192.168.1.50.',
      });
      expect(fetchConsoleIdentityMock).not.toHaveBeenCalled();
    }
  );

  it('maps a thrown error to an actionable failure, without rethrowing', async () => {
    fetchConsoleIdentityMock.mockRejectedValue(new Error('No reply from a console at 10.0.0.5:10023'));

    const result = await fetchIdentity('10.0.0.5');

    expect(result).toEqual({ success: false, error: 'No reply from a console at 10.0.0.5:10023' });
    expect(logWarnMock).toHaveBeenCalled();
  });
});

describe('start-console-live-state / stop-console-live-state', () => {
  it('rejects a malformed IP without starting a subscription', async () => {
    const { event } = makeFakeEvent();

    const result = await startLiveState(event, 'not-an-ip');

    expect(result).toEqual({
      success: false,
      error: 'Enter the console IP as four numbers separated by dots, for example 192.168.1.50.',
    });
    expect(startChannelStateSubscriptionMock).not.toHaveBeenCalled();
  });

  it('starts and returns { success: true }', async () => {
    startChannelStateSubscriptionMock.mockReturnValue({ stop: vi.fn() });
    const { event } = makeFakeEvent();

    const result = await startLiveState(event, '10.0.0.5');

    expect(result).toEqual({ success: true });
    expect(startChannelStateSubscriptionMock).toHaveBeenCalledWith(
      { log: expect.any(Function) },
      { consoleNetworkConsentGranted: true },
      '10.0.0.5',
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('forwards a snapshot as { channels } on console-live-state', async () => {
    let onSnapshot!: (channels: unknown) => void;
    startChannelStateSubscriptionMock.mockImplementation((_deps, _settings, _ip, snap) => {
      onSnapshot = snap;
      return { stop: vi.fn() };
    });
    const { event, sent } = makeFakeEvent();

    await startLiveState(event, '10.0.0.5');
    onSnapshot([{ index: 1, name: 'Kick', faderDb: -10.5, on: true }]);

    expect(sent).toContainEqual([
      'console-live-state',
      { channels: [{ index: 1, name: 'Kick', faderDb: -10.5, on: true }] },
    ]);
  });

  it('forwards a walk failure as { error } on console-live-state', async () => {
    let onError!: (message: string) => void;
    startChannelStateSubscriptionMock.mockImplementation((_deps, _settings, _ip, _snap, err) => {
      onError = err;
      return { stop: vi.fn() };
    });
    const { event, sent } = makeFakeEvent();

    await startLiveState(event, '10.0.0.5');
    onError('the console did not answer');

    expect(sent).toContainEqual(['console-live-state', { error: 'the console did not answer' }]);
  });

  it('skips the send when the sender is destroyed', async () => {
    let onSnapshot!: (channels: unknown) => void;
    startChannelStateSubscriptionMock.mockImplementation((_deps, _settings, _ip, snap) => {
      onSnapshot = snap;
      return { stop: vi.fn() };
    });
    const { event, sent, setDestroyed } = makeFakeEvent();

    await startLiveState(event, '10.0.0.5');
    setDestroyed(true);
    onSnapshot([]);

    expect(sent).toEqual([]);
  });

  it('a second start stops the first handle before starting a new one', async () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    startChannelStateSubscriptionMock.mockReturnValueOnce({ stop: firstStop }).mockReturnValueOnce({ stop: secondStop });
    const { event } = makeFakeEvent();

    await startLiveState(event, '10.0.0.5');
    await startLiveState(event, '10.0.0.6');

    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(secondStop).not.toHaveBeenCalled();
  });

  it('stop-console-live-state calls stop() and returns { success: true }', async () => {
    const stop = vi.fn();
    startChannelStateSubscriptionMock.mockReturnValue({ stop });
    const { event } = makeFakeEvent();
    await startLiveState(event, '10.0.0.5');

    const result = await stopLiveState();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it('stop-console-live-state is a no-op ({ success: true }) when nothing is running', async () => {
    const result = await stopLiveState();

    expect(result).toEqual({ success: true });
  });

  it('a throwing startChannelStateSubscription returns { success: false } with the actionable message and logs a warning', async () => {
    startChannelStateSubscriptionMock.mockImplementation(() => {
      throw new Error('Console network access requires consent');
    });
    const { event } = makeFakeEvent();

    const result = await startLiveState(event, '10.0.0.5');

    expect(result).toEqual({ success: false, error: 'Console network access requires consent' });
    expect(logWarnMock).toHaveBeenCalled();
  });

  it('falls back to a generic actionable message when the thrown value has no message', async () => {
    startChannelStateSubscriptionMock.mockImplementation(() => {
      throw 'boom';
    });
    const { event } = makeFakeEvent();

    const result = await startLiveState(event, '10.0.0.5');

    expect(result).toEqual({
      success: false,
      error:
        "Couldn't start watching the console's channel state. Check the IP is correct and the console is powered on and reachable on the network.",
    });
  });

  it('starts the meter subscription with the throttled time factor and the same validated ip', async () => {
    startChannelStateSubscriptionMock.mockReturnValue({ stop: vi.fn() });
    const { event } = makeFakeEvent();

    await startLiveState(event, '10.0.0.5');

    expect(startMeterSubscriptionMock).toHaveBeenCalledWith(
      { log: expect.any(Function) },
      { consoleNetworkConsentGranted: true },
      '10.0.0.5',
      expect.any(Function),
      expect.any(Function),
      { timeFactor: CONSOLE_METER_TIME_FACTOR }
    );
  });

  it('forwards a meter frame as { meters: { inputs } } on console-live-state, dropping gate/dynamics bands', async () => {
    let onFrame!: (snapshot: unknown) => void;
    startChannelStateSubscriptionMock.mockReturnValue({ stop: vi.fn() });
    startMeterSubscriptionMock.mockImplementation((_deps, _settings, _ip, frame) => {
      onFrame = frame;
      return { stop: vi.fn() };
    });
    const { event, sent } = makeFakeEvent();

    await startLiveState(event, '10.0.0.5');
    onFrame({ inputs: [0.5, 0.25], gateGainReduction: [1], dynamicsGainReduction: [1] });

    expect(sent).toContainEqual(['console-live-state', { meters: { inputs: [0.5, 0.25] } }]);
  });

  it('skips the meter send when the sender is destroyed', async () => {
    let onFrame!: (snapshot: unknown) => void;
    startChannelStateSubscriptionMock.mockReturnValue({ stop: vi.fn() });
    startMeterSubscriptionMock.mockImplementation((_deps, _settings, _ip, frame) => {
      onFrame = frame;
      return { stop: vi.fn() };
    });
    const { event, sent, setDestroyed } = makeFakeEvent();

    await startLiveState(event, '10.0.0.5');
    setDestroyed(true);
    onFrame({ inputs: [0.5] });

    expect(sent).toEqual([]);
  });

  it.each([{ type: 'degraded-to-polling' }, { type: 'reconnect' }])(
    'logs a meter subscription %j event and sends nothing',
    async (subscriptionEvent) => {
      let onEvent!: (event: unknown) => void;
      startChannelStateSubscriptionMock.mockReturnValue({ stop: vi.fn() });
      startMeterSubscriptionMock.mockImplementation((_deps, _settings, _ip, _frame, event) => {
        onEvent = event;
        return { stop: vi.fn() };
      });
      const { event, sent } = makeFakeEvent();

      await startLiveState(event, '10.0.0.5');
      onEvent(subscriptionEvent);

      expect(sent).toEqual([]);
      expect(logMock).toHaveBeenCalledWith(expect.stringContaining(subscriptionEvent.type));
    }
  );

  it('stop-console-live-state stops the meter handle as well as the channel handle', async () => {
    const channelStop = vi.fn();
    const meterStop = vi.fn();
    startChannelStateSubscriptionMock.mockReturnValue({ stop: channelStop });
    startMeterSubscriptionMock.mockReturnValue({ stop: meterStop });
    const { event } = makeFakeEvent();
    await startLiveState(event, '10.0.0.5');

    await stopLiveState();

    expect(channelStop).toHaveBeenCalledTimes(1);
    expect(meterStop).toHaveBeenCalledTimes(1);
  });

  it('a second start stops the first meter handle before creating the second (never stacks)', async () => {
    const firstMeterStop = vi.fn();
    const secondMeterStop = vi.fn();
    startChannelStateSubscriptionMock.mockReturnValue({ stop: vi.fn() });
    startMeterSubscriptionMock.mockReturnValueOnce({ stop: firstMeterStop }).mockReturnValueOnce({ stop: secondMeterStop });
    const { event } = makeFakeEvent();

    await startLiveState(event, '10.0.0.5');
    await startLiveState(event, '10.0.0.6');

    expect(firstMeterStop).toHaveBeenCalledTimes(1);
    expect(secondMeterStop).not.toHaveBeenCalled();
  });

  it('a throwing startMeterSubscription returns { success: false } with an actionable message and stops the already-created channel handle', async () => {
    const channelStop = vi.fn();
    startChannelStateSubscriptionMock.mockReturnValue({ stop: channelStop });
    startMeterSubscriptionMock.mockImplementation(() => {
      throw new Error('Console network access requires consent');
    });
    const { event } = makeFakeEvent();

    const result = await startLiveState(event, '10.0.0.5');

    expect(result).toEqual({ success: false, error: 'Console network access requires consent' });
    expect(channelStop).toHaveBeenCalledTimes(1);
    expect(logWarnMock).toHaveBeenCalled();
  });
});
