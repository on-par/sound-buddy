// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { SettingsApi, LlmApi, AppSettings, UpdateSettingsPatch, PublicLlmConfig } from '../../../electron/ipc/api';

export type SettingsStoreApi = SettingsApi & Pick<LlmApi, 'getLlmConfig'>;

export interface SettingsState {
  settings: AppSettings | null;
  llmConfig: PublicLlmConfig | null;
  settingsError: string | null;
  loadSettings(): Promise<void>;
  updateSettings(patch: UpdateSettingsPatch): Promise<void>;
}

export function createSettingsStore(getApi: () => SettingsStoreApi) {
  return create<SettingsState>()((set) => ({
    settings: null,
    llmConfig: null,
    settingsError: null,
    async loadSettings() {
      try {
        const [settings, llmConfig] = await Promise.all([getApi().getSettings(), getApi().getLlmConfig()]);
        set({ settings, llmConfig, settingsError: null });
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
  }));
}

export const useSettingsStore = createSettingsStore(getSoundBuddy);
