// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { SettingsApi, AppSettings, UpdateSettingsPatch } from '../../../electron/ipc/api';

export type SettingsStoreApi = SettingsApi;

export interface SettingsState {
  settings: AppSettings | null;
  settingsError: string | null;
  dialogOpen: boolean;
  loadSettings(): Promise<void>;
  updateSettings(patch: UpdateSettingsPatch): Promise<void>;
  // ADR-0006 (#747) — grants Tier 2 console-network consent through the
  // dedicated grant IPC (the generic update-settings patch is revoke-only).
  // Keeps the in-memory settings state in sync so requestConsent()'s
  // already-granted fast path keeps working.
  grantConsoleNetworkConsent(): Promise<void>;
  openDialog(): void;
  closeDialog(): void;
}

export function createSettingsStore(getApi: () => SettingsStoreApi) {
  return create<SettingsState>()((set) => ({
    settings: null,
    settingsError: null,
    dialogOpen: false,
    async loadSettings() {
      try {
        const settings = await getApi().getSettings();
        set({ settings, settingsError: null });
      } catch (err) {
        set({ settingsError: err instanceof Error ? err.message : String(err) });
      }
    },
    async updateSettings(patch) {
      try {
        set({ settings: await getApi().updateSettings(patch) });
      } catch (err) {
        set({ settingsError: err instanceof Error ? err.message : String(err) });
      }
    },
    async grantConsoleNetworkConsent() {
      try {
        set({ settings: await getApi().grantConsoleNetworkConsent() });
      } catch (err) {
        set({ settingsError: err instanceof Error ? err.message : String(err) });
      }
    },
    openDialog() {
      set({ dialogOpen: true });
    },
    closeDialog() {
      set({ dialogOpen: false });
    },
  }));
}

export const useSettingsStore = createSettingsStore(getSoundBuddy);
