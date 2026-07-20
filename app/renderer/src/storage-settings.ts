// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure storage-settings logic for the unified Settings modal (#204). Port of
// inline-app.js's imperative Storage dialog (#91) — module-level mutable
// state (`storagePendingDir` / `storageDefaultPath` / `storageLoadedPath`)
// becomes explicit params/returns so SettingsPanel.tsx can drive it as React
// state instead.

import type { AppSettings, StorageApi, UpdateSettingsPatch } from '../../electron/ipc/api';

export const DEFAULT_STORAGE_PATH = '~/Music/Sound Buddy';

export interface StorageSeed {
  defaultPath: string;
  loadedPath: string;
  usageText: string;
}

// pendingDir: null = unchanged (show loadedPath), '' = reset to default,
// string = a folder chosen this session. Port of inline-app.js's
// effectiveStoragePath().
export function effectiveStoragePath(pendingDir: string | null, defaultPath: string, loadedPath: string): string {
  if (pendingDir === '') return defaultPath;
  if (pendingDir) return pendingDir;
  return loadedPath;
}

// Port of openStorageSettings()'s try/catch around getStorageUsage().
export async function loadStorageSeed(api: Pick<StorageApi, 'getStorageUsage'>): Promise<StorageSeed> {
  try {
    const u = await api.getStorageUsage();
    if (!u) return { defaultPath: DEFAULT_STORAGE_PATH, loadedPath: DEFAULT_STORAGE_PATH, usageText: '' };
    const defaultPath = u.defaultPath || DEFAULT_STORAGE_PATH;
    const loadedPath = u.path || defaultPath;
    const usageText = u.exists
      ? `Using ${u.human} on this Mac — no limit.`
      : 'Nothing recorded yet — no limit on how much you can store.';
    return { defaultPath, loadedPath, usageText };
  } catch {
    return { defaultPath: DEFAULT_STORAGE_PATH, loadedPath: DEFAULT_STORAGE_PATH, usageText: '' };
  }
}

export interface StorageToggles {
  usageSignalEnabled: boolean;
  crashReportingEnabled: boolean;
  dawWorkspaceEnabled: boolean;
  liveAdjustmentsEnabled: boolean;
}

const TOGGLE_KEYS: (keyof StorageToggles & keyof UpdateSettingsPatch)[] = [
  'usageSignalEnabled',
  'crashReportingEnabled',
  'dawWorkspaceEnabled',
  'liveAdjustmentsEnabled',
];

// Port of saveStorageSettings()'s change-detection: only emits keys that
// differ from `loaded`, and only includes storageDir when pendingDir !== null.
// Unlike the old code (up to five separate updateSettings() round-trips),
// this merges everything into one patch — updateSettings accepts a partial
// patch, so it's equivalent and strictly fewer IPC calls.
export function buildStoragePatch(
  pendingDir: string | null,
  toggles: StorageToggles,
  loaded: AppSettings | null
): UpdateSettingsPatch | null {
  const patch: UpdateSettingsPatch = {};
  if (pendingDir !== null) patch.storageDir = pendingDir;
  for (const key of TOGGLE_KEYS) {
    const current = toggles[key];
    const previous = !!(loaded && loaded[key]);
    if (current !== previous) patch[key] = current;
  }
  return Object.keys(patch).length ? patch : null;
}
