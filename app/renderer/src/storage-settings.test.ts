// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STORAGE_PATH,
  loadStorageSeed,
  storageFolderDisplay,
  commitStorageDir,
  chooseStorageFolder,
} from './storage-settings';
import { createSettingsStore } from './stores/settingsStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { AppSettings, StorageUsage } from '../../electron/ipc/api';

const LOADED_SETTINGS: AppSettings = {
  idealProfile: '',
  customIdealProfiles: [],
  storageDir: '',
  rigs: [],
  activeRigId: null,
  usageSignalEnabled: false,
  channelLabels: {},
  channelGroups: {},
  inputInstrumentProfiles: {},
  crashReportingEnabled: false,
  liveAdjustmentsEnabled: false,
  reportFirstUxEnabled: false,
  shareChurchName: '',
  weeklyReminderEnabled: false,
  weeklyReminderServiceDay: 0,
  liveEqPaneWidth: 360,
  measurementDeviceName: '',
  gradingProfile: 'casual',
  consoleNetworkConsentGranted: false,
  soundcheckBuses: [],
  splCalibrationOffsetDb: null,
};

describe('storageFolderDisplay', () => {
  it('returns defaultPath when settings is null', () => {
    expect(storageFolderDisplay(null, '/default')).toBe('/default');
  });

  it('returns defaultPath when storageDir is empty', () => {
    expect(storageFolderDisplay({ ...LOADED_SETTINGS, storageDir: '' }, '/default')).toBe('/default');
  });

  it('returns defaultPath when storageDir is whitespace-only', () => {
    expect(storageFolderDisplay({ ...LOADED_SETTINGS, storageDir: '   ' }, '/default')).toBe('/default');
  });

  it('returns the configured folder verbatim when storageDir is set', () => {
    expect(storageFolderDisplay({ ...LOADED_SETTINGS, storageDir: '/Volumes/Audio' }, '/default')).toBe(
      '/Volumes/Audio'
    );
  });
});

describe('commitStorageDir', () => {
  it('sends the chosen path to updateSettings', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return { ...LOADED_SETTINGS, storageDir: '/tmp/chosen' };
      },
    });
    const store = createSettingsStore(() => mock.api);

    await commitStorageDir(store, '/tmp/chosen');

    expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ storageDir: '/tmp/chosen' }] });
    expect(store.getState().settings?.storageDir).toBe('/tmp/chosen');
  });

  it('sends an empty string when resetting to default', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return { ...LOADED_SETTINGS, storageDir: '' };
      },
    });
    const store = createSettingsStore(() => mock.api);

    await commitStorageDir(store, '');

    expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ storageDir: '' }] });
    expect(store.getState().settings?.storageDir).toBe('');
  });
});

describe('chooseStorageFolder', () => {
  it('persists the picked path when the dialog resolves a folder', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return { ...LOADED_SETTINGS, storageDir: '/picked/folder' };
      },
    });
    const store = createSettingsStore(() => mock.api);

    await chooseStorageFolder({ openDirDialog: async () => '/picked/folder' }, store);

    const calls = mock.calls.filter((c) => c.method === 'updateSettings');
    expect(calls).toEqual([{ method: 'updateSettings', args: [{ storageDir: '/picked/folder' }] }]);
  });

  it('does nothing when the dialog is cancelled (resolves null)', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return LOADED_SETTINGS;
      },
    });
    const store = createSettingsStore(() => mock.api);

    await chooseStorageFolder({ openDirDialog: async () => null }, store);

    expect(mock.calls.some((c) => c.method === 'updateSettings')).toBe(false);
  });
});

describe('loadStorageSeed', () => {
  it('reports usage when the storage folder exists', async () => {
    const usage: StorageUsage = { path: '/loaded', isDefault: false, defaultPath: '/default', bytes: 123, human: '123 B', exists: true };
    const seed = await loadStorageSeed({ getStorageUsage: async () => usage });
    expect(seed).toEqual({ defaultPath: '/default', usageText: 'Using 123 B on this Mac — no limit.' });
  });

  it('reports the nothing-recorded copy when the folder does not exist yet', async () => {
    const usage: StorageUsage = { path: '/loaded', isDefault: true, defaultPath: '/default', bytes: 0, human: '0 B', exists: false };
    const seed = await loadStorageSeed({ getStorageUsage: async () => usage });
    expect(seed.usageText).toBe('Nothing recorded yet — no limit on how much you can store.');
  });

  it('falls back to DEFAULT_STORAGE_PATH when defaultPath is empty', async () => {
    const usage: StorageUsage = { path: '', isDefault: true, defaultPath: '', bytes: 0, human: '0 B', exists: false };
    const seed = await loadStorageSeed({ getStorageUsage: async () => usage });
    expect(seed.defaultPath).toBe(DEFAULT_STORAGE_PATH);
  });

  it('returns empty usage text when the API resolves falsy', async () => {
    const seed = await loadStorageSeed({ getStorageUsage: async () => undefined as unknown as StorageUsage });
    expect(seed).toEqual({ defaultPath: DEFAULT_STORAGE_PATH, usageText: '' });
  });

  it('returns empty usage text when the API throws', async () => {
    const seed = await loadStorageSeed({
      getStorageUsage: async () => {
        throw new Error('disk read failed');
      },
    });
    expect(seed).toEqual({ defaultPath: DEFAULT_STORAGE_PATH, usageText: '' });
  });
});
