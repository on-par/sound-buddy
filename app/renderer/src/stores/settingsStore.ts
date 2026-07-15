// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type {
  SettingsApi,
  LlmApi,
  AppSettings,
  UpdateSettingsPatch,
  PublicLlmConfig,
  LlmConfigPatch,
  SaveLlmConfigResult,
} from '../../../electron/ipc/api';

export type SettingsStoreApi = SettingsApi & Pick<LlmApi, 'getLlmConfig' | 'saveLlmConfig'>;

export interface SettingsState {
  settings: AppSettings | null;
  llmConfig: PublicLlmConfig | null;
  settingsError: string | null;
  dialogOpen: boolean;
  loadSettings(): Promise<void>;
  updateSettings(patch: UpdateSettingsPatch): Promise<void>;
  saveLlmConfig(patch: LlmConfigPatch): Promise<SaveLlmConfigResult>;
  openDialog(): void;
  closeDialog(): void;
}

export function createSettingsStore(getApi: () => SettingsStoreApi) {
  return create<SettingsState>()((set) => ({
    settings: null,
    llmConfig: null,
    settingsError: null,
    dialogOpen: false,
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
    // Mirrors inline-app.js:3645–3651's saveAiSettings try/catch: a rejected
    // IPC round-trip becomes a { ok: false } result like a normal save
    // failure, rather than an uncaught rejection the panel has to handle
    // separately.
    async saveLlmConfig(patch) {
      let res: SaveLlmConfigResult;
      try {
        res = await getApi().saveLlmConfig(patch);
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      if (res.ok) set({ llmConfig: res.config });
      return res;
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
