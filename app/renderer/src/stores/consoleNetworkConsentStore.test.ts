// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createConsoleNetworkConsentStore, type ConsoleNetworkConsentDeps } from './consoleNetworkConsentStore';
import type { AppSettings } from '../../../electron/ipc/api';

function createFakeDeps(granted: boolean) {
  const grantConsoleNetworkConsent = vi.fn(async () => {});
  const getSettings = vi.fn((): AppSettings | null => ({ consoleNetworkConsentGranted: granted }) as AppSettings);
  const deps: ConsoleNetworkConsentDeps = { getSettings, grantConsoleNetworkConsent };
  return { deps, getSettings, grantConsoleNetworkConsent };
}

describe('createConsoleNetworkConsentStore (#378)', () => {
  it('requestConsent() resolves true immediately without opening the dialog when already granted', async () => {
    const { deps, grantConsoleNetworkConsent } = createFakeDeps(true);
    const store = createConsoleNetworkConsentStore(deps);

    const result = await store.getState().requestConsent();

    expect(result).toBe(true);
    expect(store.getState().dialogOpen).toBe(false);
    expect(grantConsoleNetworkConsent).not.toHaveBeenCalled();
  });

  it('requestConsent() opens the dialog when consent is not already granted', () => {
    const { deps } = createFakeDeps(false);
    const store = createConsoleNetworkConsentStore(deps);

    void store.getState().requestConsent();

    expect(store.getState().dialogOpen).toBe(true);
  });

  it('grant() persists consent via grantConsoleNetworkConsent, closes the dialog, and resolves a pending requestConsent() with true', async () => {
    const { deps, grantConsoleNetworkConsent } = createFakeDeps(false);
    const store = createConsoleNetworkConsentStore(deps);

    const pending = store.getState().requestConsent();
    expect(store.getState().dialogOpen).toBe(true);

    await store.getState().grant();

    expect(grantConsoleNetworkConsent).toHaveBeenCalledTimes(1);
    expect(store.getState().dialogOpen).toBe(false);
    await expect(pending).resolves.toBe(true);
  });

  it('decline() closes the dialog without persisting anything and resolves a pending requestConsent() with false', async () => {
    const { deps, grantConsoleNetworkConsent } = createFakeDeps(false);
    const store = createConsoleNetworkConsentStore(deps);

    const pending = store.getState().requestConsent();
    expect(store.getState().dialogOpen).toBe(true);

    store.getState().decline();

    expect(grantConsoleNetworkConsent).not.toHaveBeenCalled();
    expect(store.getState().dialogOpen).toBe(false);
    await expect(pending).resolves.toBe(false);
  });

  it('resolves every concurrent requestConsent() caller from a single grant() click', async () => {
    const { deps } = createFakeDeps(false);
    const store = createConsoleNetworkConsentStore(deps);

    const first = store.getState().requestConsent();
    const second = store.getState().requestConsent();

    await store.getState().grant();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it('resolves every concurrent requestConsent() caller from a single decline() click', async () => {
    const { deps } = createFakeDeps(false);
    const store = createConsoleNetworkConsentStore(deps);

    const first = store.getState().requestConsent();
    const second = store.getState().requestConsent();

    store.getState().decline();

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
  });
});
