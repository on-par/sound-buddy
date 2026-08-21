// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure storage-settings logic for the unified Settings modal (#204). Port of
// inline-app.js's imperative Storage dialog (#91) — module-level mutable
// state (`storagePendingDir` / `storageDefaultPath` / `storageLoadedPath`)
// becomes explicit params/returns so SettingsPanel.tsx can drive it as React
// state instead.

import type { StoreApi, UseBoundStore } from 'zustand';
import type { AppSettings, DialogApi, StorageApi, UpdateSettingsPatch } from '../../electron/ipc/api';
import type { SettingsState } from './stores/settingsStore';

export type SettingsStoreHandle = UseBoundStore<StoreApi<SettingsState>>;

export const DEFAULT_STORAGE_PATH = '~/Music/Sound Buddy';

export interface StorageSeed {
  defaultPath: string;
  usageText: string;
}

// The storage folder's displayed path (#1019) — derived from the persisted
// setting, not from a staged value, so it updates as soon as a choice commits.
// An empty/whitespace storageDir means "platform default", the same convention
// LiveSourceSettings.tsx uses.
export function storageFolderDisplay(settings: AppSettings | null, defaultPath: string): string {
  const dir = settings?.storageDir ?? '';
  return dir.trim() ? dir : defaultPath;
}

// Persists a storage-folder choice immediately (#1019) — '' means "use the
// platform default". Same single-key-patch shape as commitInstantSetting.
export function commitStorageDir(store: SettingsStoreHandle, dir: string): Promise<void> {
  return store.getState().updateSettings({ storageDir: dir });
}

// The Change… interaction: open the existing folder picker and, when the user
// picks a folder (rather than cancelling), persist it right away.
export async function chooseStorageFolder(
  api: Pick<DialogApi, 'openDirDialog'>,
  store: SettingsStoreHandle
): Promise<void> {
  const dir = await api.openDirDialog();
  if (!dir) return;
  await commitStorageDir(store, dir);
}

// Port of openStorageSettings()'s try/catch around getStorageUsage().
export async function loadStorageSeed(api: Pick<StorageApi, 'getStorageUsage'>): Promise<StorageSeed> {
  try {
    const u = await api.getStorageUsage();
    if (!u) return { defaultPath: DEFAULT_STORAGE_PATH, usageText: '' };
    const defaultPath = u.defaultPath || DEFAULT_STORAGE_PATH;
    const usageText = u.exists
      ? `Using ${u.human} on this Mac — no limit.`
      : 'Nothing recorded yet — no limit on how much you can store.';
    return { defaultPath, usageText };
  } catch {
    return { defaultPath: DEFAULT_STORAGE_PATH, usageText: '' };
  }
}

export interface StorageToggles {
  usageSignalEnabled: boolean;
  crashReportingEnabled: boolean;
  dawWorkspaceEnabled: boolean;
  liveAdjustmentsEnabled: boolean;
  weeklyReminderEnabled: boolean;
  weeklyReminderServiceDay: number;
  gradingProfile: 'casual' | 'broadcast';
}

// The boolean-valued StorageToggles keys — deliberately excludes
// weeklyReminderServiceDay (a number), which is diffed separately below.
// Listing them out (rather than `keyof StorageToggles`) keeps `patch[key]`
// below assignable to a single boolean type instead of widening to
// `boolean | number` once a non-boolean field exists on StorageToggles.
type BooleanToggleKey =
  | 'usageSignalEnabled'
  | 'crashReportingEnabled'
  | 'dawWorkspaceEnabled'
  | 'liveAdjustmentsEnabled'
  | 'weeklyReminderEnabled';

const TOGGLE_KEYS: (BooleanToggleKey & keyof UpdateSettingsPatch)[] = [
  'usageSignalEnabled',
  'crashReportingEnabled',
  'dawWorkspaceEnabled',
  'liveAdjustmentsEnabled',
  'weeklyReminderEnabled',
];

// Port of saveStorageSettings()'s change-detection: only emits keys that
// differ from `loaded`. The storage folder no longer flows through Save
// (#1019, it commits immediately via commitStorageDir/chooseStorageFolder) —
// this is now the toggles-only diff. Unlike the old code (up to five separate
// updateSettings() round-trips), this merges everything into one patch —
// updateSettings accepts a partial patch, so it's equivalent and strictly
// fewer IPC calls.
export function buildStoragePatch(toggles: StorageToggles, loaded: AppSettings | null): UpdateSettingsPatch | null {
  const patch: UpdateSettingsPatch = {};
  for (const key of TOGGLE_KEYS) {
    const current = toggles[key];
    const previous = !!(loaded && loaded[key]);
    if (current !== previous) patch[key] = current;
  }
  // weeklyReminderServiceDay is a number, not a boolean, so it's diffed
  // separately from the boolean TOGGLE_KEYS loop above.
  const previousDay = loaded?.weeklyReminderServiceDay ?? 0;
  if (toggles.weeklyReminderServiceDay !== previousDay) {
    patch.weeklyReminderServiceDay = toggles.weeklyReminderServiceDay;
  }
  // gradingProfile (#266) is a string enum, not a boolean — diffed separately
  // from the boolean TOGGLE_KEYS loop above, same as weeklyReminderServiceDay.
  const previousGradingProfile = loaded?.gradingProfile ?? 'casual';
  if (toggles.gradingProfile !== previousGradingProfile) {
    patch.gradingProfile = toggles.gradingProfile;
  }
  return Object.keys(patch).length ? patch : null;
}
