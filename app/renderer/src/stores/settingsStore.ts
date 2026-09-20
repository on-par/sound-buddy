// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { SettingsApi, AppSettings, UpdateSettingsPatch } from '../../../electron/ipc/api';
import type { SettingsSection } from '../SettingsPanel';

export type SettingsStoreApi = SettingsApi;

export interface SettingsState {
  settings: AppSettings | null;
  settingsError: string | null;
  dialogOpen: boolean;
  // Requested landing section for the next open (#1468, lc-05) — null means
  // "no request", which SettingsPanel.tsx's initialSettingsSection narrows to
  // 'general'. Set fresh on every openDialog() call so a targeted open (e.g.
  // AnalyzeEntryDialog routing to Audio) never leaks into the next plain
  // open (the gear icon, which calls openDialog() with no argument).
  dialogSection: SettingsSection | null;
  loadSettings(): Promise<void>;
  updateSettings(patch: UpdateSettingsPatch): Promise<void>;
  // ADR-0006 (#747) — grants Tier 2 console-network consent through the
  // dedicated grant IPC (the generic update-settings patch is revoke-only).
  // Keeps the in-memory settings state in sync so requestConsent()'s
  // already-granted fast path keeps working.
  grantConsoleNetworkConsent(): Promise<void>;
  openDialog(section?: SettingsSection): void;
  closeDialog(): void;
}

export function createSettingsStore(getApi: () => SettingsStoreApi) {
  return create<SettingsState>()((set) => ({
    settings: null,
    settingsError: null,
    dialogOpen: false,
    dialogSection: null,
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
    openDialog(section) {
      set({ dialogOpen: true, dialogSection: section ?? null });
    },
    closeDialog() {
      set({ dialogOpen: false });
    },
  }));
}

export const useSettingsStore = createSettingsStore(getSoundBuddy);
