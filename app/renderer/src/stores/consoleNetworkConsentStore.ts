// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Renderer promise-gate for Tier 2 (console-network/OSC-UDP) consent (#378) —
// every future Tier 2 renderer-triggered action must call requestConsent()
// before invoking that feature's (future) Tier 2 IPC surface. requestConsent()
// resolves true immediately when consent is already granted; otherwise it
// opens ConsoleNetworkConsentDialog.tsx and resolves only once the user grants
// or declines. Factory pattern with injected deps (constitution: side effects
// injected, not imported globally) mirroring idealProfilesStore.ts's
// createXStore(deps) shape — kept separate from settingsStore.ts's dialogOpen
// so this dialog's visibility doesn't couple to the unrelated Settings modal.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useSettingsStore } from './settingsStore';
import type { AppSettings } from '../../../electron/ipc/api';

export interface ConsoleNetworkConsentDeps {
  getSettings(): AppSettings | null;
  // ADR-0006 (#747): grant goes through the dedicated settingsStore action /
  // grant IPC — never the generic update-settings patch, which is revoke-only.
  grantConsoleNetworkConsent(): Promise<void>;
}

export interface ConsoleNetworkConsentState {
  dialogOpen: boolean;
  requestConsent(): Promise<boolean>;
  grant(): Promise<void>;
  decline(): void;
}

export function createConsoleNetworkConsentStore(
  deps: ConsoleNetworkConsentDeps
): UseBoundStore<StoreApi<ConsoleNetworkConsentState>> {
  let pendingResolvers: Array<(granted: boolean) => void> = [];

  return create<ConsoleNetworkConsentState>()((set) => ({
    dialogOpen: false,

    requestConsent() {
      if (deps.getSettings()?.consoleNetworkConsentGranted === true) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        pendingResolvers.push(resolve);
        set({ dialogOpen: true });
      });
    },

    async grant() {
      await deps.grantConsoleNetworkConsent();
      set({ dialogOpen: false });
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      resolvers.forEach((resolve) => resolve(true));
    },

    decline() {
      set({ dialogOpen: false });
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      resolvers.forEach((resolve) => resolve(false));
    },
  }));
}

export const useConsoleNetworkConsentStore = createConsoleNetworkConsentStore({
  getSettings: () => useSettingsStore.getState().settings,
  grantConsoleNetworkConsent: () => useSettingsStore.getState().grantConsoleNetworkConsent(),
});
