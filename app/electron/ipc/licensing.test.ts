// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The licensing IPC domain: four thin ipcMain.handle wrappers over
// electron/license.ts (offline) and license-refresh.ts (#117). This test
// asserts the exact channel surface — a wrong channel name here would silently
// break the renderer's license calls — and the argument threading of each
// handler.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
}));

const getLicenseStateMock = vi.fn();
const activateLicenseMock = vi.fn();
const removeLicenseMock = vi.fn();
vi.mock('../license', () => ({
  getLicenseState: (...a: unknown[]) => getLicenseStateMock(...a),
  activateLicense: (...a: unknown[]) => activateLicenseMock(...a),
  removeLicense: (...a: unknown[]) => removeLicenseMock(...a),
}));

const maybeRefreshLicenseMock = vi.fn();
vi.mock('../license-refresh', () => ({
  maybeRefreshLicense: (...a: unknown[]) => maybeRefreshLicenseMock(...a),
}));

import { registerLicensingHandlers } from './licensing';

const handler = (ch: string): ((...args: unknown[]) => unknown) => {
  const fn = handlers.get(ch);
  if (!fn) throw new Error(`no handler registered for channel "${ch}"`);
  return fn;
};

beforeEach(() => {
  handlers.clear();
  getLicenseStateMock.mockReset();
  activateLicenseMock.mockReset();
  removeLicenseMock.mockReset();
  maybeRefreshLicenseMock.mockReset();
  registerLicensingHandlers();
});

describe('registerLicensingHandlers', () => {
  it('registers exactly the four license channels', () => {
    expect([...handlers.keys()].sort()).toEqual(['activate-license', 'get-license', 'refresh-license', 'remove-license']);
  });

  it('get-license returns getLicenseState()', () => {
    const state = { tier: 'pro' as const, status: 'valid' as const };
    getLicenseStateMock.mockReturnValue(state);

    expect(handler('get-license')()).toBe(state);
    expect(getLicenseStateMock).toHaveBeenCalledTimes(1);
  });

  it('activate-license forwards a string key to activateLicense', () => {
    const state = { tier: 'pro' as const, status: 'valid' as const };
    activateLicenseMock.mockReturnValue(state);

    expect(handler('activate-license')(undefined, 'SB1.abc.def')).toBe(state);
    expect(activateLicenseMock).toHaveBeenCalledWith('SB1.abc.def');
  });

  it('activate-license coerces a non-string key via String(key ?? "")', () => {
    activateLicenseMock.mockReturnValue({ tier: 'free' as const, status: 'invalid' as const, error: 'nope' });

    handler('activate-license')(undefined, undefined);
    expect(activateLicenseMock).toHaveBeenCalledWith('');

    handler('activate-license')(undefined, 123);
    expect(activateLicenseMock).toHaveBeenCalledWith('123');
  });

  it('remove-license returns removeLicense()', () => {
    const state = { tier: 'free' as const, status: 'none' as const };
    removeLicenseMock.mockReturnValue(state);

    expect(handler('remove-license')()).toBe(state);
    expect(removeLicenseMock).toHaveBeenCalledTimes(1);
  });

  it('refresh-license calls maybeRefreshLicense({ force: true })', async () => {
    const state = { tier: 'pro' as const, status: 'valid' as const };
    maybeRefreshLicenseMock.mockResolvedValue(state);

    await expect(handler('refresh-license')()).resolves.toBe(state);
    expect(maybeRefreshLicenseMock).toHaveBeenCalledWith({ force: true });
  });
});
