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

import { registerConsoleHandlers, isValidConsoleIp } from './console';

type Handler = (...args: unknown[]) => Promise<Record<string, unknown>>;

function scanConsoles() {
  return (handlers.get('scan-consoles') as Handler)();
}

function fetchIdentity(ip: unknown) {
  return (handlers.get('fetch-console-identity') as Handler)(undefined, ip);
}

beforeEach(() => {
  handlers.clear();
  logMock.mockClear();
  logWarnMock.mockClear();
  getSettingsMock.mockClear();
  discoverConsolesMock.mockReset();
  fetchConsoleIdentityMock.mockReset();
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
