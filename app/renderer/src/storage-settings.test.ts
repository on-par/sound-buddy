// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { DEFAULT_STORAGE_PATH, effectiveStoragePath, loadStorageSeed, buildStoragePatch } from './storage-settings';
import type { AppSettings, StorageUsage } from '../../electron/ipc/api';

const LOADED_SETTINGS: AppSettings = {
  aiEnabled: false,
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
  dawWorkspaceEnabled: false,
  liveAdjustmentsEnabled: false,
  reportFirstUxEnabled: false,
  shareChurchName: '',
  weeklyReminderEnabled: false,
  weeklyReminderServiceDay: 0,
};

const NO_TOGGLES = {
  usageSignalEnabled: false,
  crashReportingEnabled: false,
  dawWorkspaceEnabled: false,
  liveAdjustmentsEnabled: false,
  weeklyReminderEnabled: false,
  weeklyReminderServiceDay: 0,
};

describe('effectiveStoragePath', () => {
  it('shows the loaded path when pendingDir is unchanged (null)', () => {
    expect(effectiveStoragePath(null, '/default', '/loaded')).toBe('/loaded');
  });

  it('shows the default path when pendingDir is reset (empty string)', () => {
    expect(effectiveStoragePath('', '/default', '/loaded')).toBe('/default');
  });

  it('shows the chosen folder when pendingDir is a custom path', () => {
    expect(effectiveStoragePath('/custom/folder', '/default', '/loaded')).toBe('/custom/folder');
  });
});

describe('loadStorageSeed', () => {
  it('reports usage when the storage folder exists', async () => {
    const usage: StorageUsage = { path: '/loaded', isDefault: false, defaultPath: '/default', bytes: 123, human: '123 B', exists: true };
    const seed = await loadStorageSeed({ getStorageUsage: async () => usage });
    expect(seed).toEqual({ defaultPath: '/default', loadedPath: '/loaded', usageText: 'Using 123 B on this Mac — no limit.' });
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
    expect(seed.loadedPath).toBe(DEFAULT_STORAGE_PATH);
  });

  it('falls back loadedPath to defaultPath when path is empty', async () => {
    const usage: StorageUsage = { path: '', isDefault: true, defaultPath: '/custom-default', bytes: 0, human: '0 B', exists: false };
    const seed = await loadStorageSeed({ getStorageUsage: async () => usage });
    expect(seed.loadedPath).toBe('/custom-default');
  });

  it('returns empty usage text when the API resolves falsy', async () => {
    const seed = await loadStorageSeed({ getStorageUsage: async () => undefined as unknown as StorageUsage });
    expect(seed).toEqual({ defaultPath: DEFAULT_STORAGE_PATH, loadedPath: DEFAULT_STORAGE_PATH, usageText: '' });
  });

  it('returns empty usage text when the API throws', async () => {
    const seed = await loadStorageSeed({
      getStorageUsage: async () => {
        throw new Error('disk read failed');
      },
    });
    expect(seed).toEqual({ defaultPath: DEFAULT_STORAGE_PATH, loadedPath: DEFAULT_STORAGE_PATH, usageText: '' });
  });
});

describe('buildStoragePatch', () => {
  it('returns null when nothing changed', () => {
    expect(buildStoragePatch(null, NO_TOGGLES, LOADED_SETTINGS)).toBeNull();
  });

  it('includes only storageDir when just the folder changed', () => {
    expect(buildStoragePatch('/new/folder', NO_TOGGLES, LOADED_SETTINGS)).toEqual({ storageDir: '/new/folder' });
  });

  it('includes storageDir when reset to default (empty string)', () => {
    expect(buildStoragePatch('', NO_TOGGLES, LOADED_SETTINGS)).toEqual({ storageDir: '' });
  });

  it('includes only usageSignalEnabled when just that toggle changed', () => {
    expect(buildStoragePatch(null, { ...NO_TOGGLES, usageSignalEnabled: true }, LOADED_SETTINGS)).toEqual({
      usageSignalEnabled: true,
    });
  });

  it('includes only crashReportingEnabled when just that toggle changed', () => {
    expect(buildStoragePatch(null, { ...NO_TOGGLES, crashReportingEnabled: true }, LOADED_SETTINGS)).toEqual({
      crashReportingEnabled: true,
    });
  });

  it('includes only dawWorkspaceEnabled when just that toggle changed', () => {
    expect(buildStoragePatch(null, { ...NO_TOGGLES, dawWorkspaceEnabled: true }, LOADED_SETTINGS)).toEqual({
      dawWorkspaceEnabled: true,
    });
  });

  it('includes only liveAdjustmentsEnabled when just that toggle changed', () => {
    expect(buildStoragePatch(null, { ...NO_TOGGLES, liveAdjustmentsEnabled: true }, LOADED_SETTINGS)).toEqual({
      liveAdjustmentsEnabled: true,
    });
  });

  it('includes only weeklyReminderEnabled when just that toggle changed', () => {
    expect(buildStoragePatch(null, { ...NO_TOGGLES, weeklyReminderEnabled: true }, LOADED_SETTINGS)).toEqual({
      weeklyReminderEnabled: true,
    });
  });

  it('includes only weeklyReminderServiceDay when just the day changed', () => {
    expect(buildStoragePatch(null, { ...NO_TOGGLES, weeklyReminderServiceDay: 3 }, LOADED_SETTINGS)).toEqual({
      weeklyReminderServiceDay: 3,
    });
  });

  it('omits weeklyReminderServiceDay when unchanged from the loaded default (0)', () => {
    expect(buildStoragePatch(null, NO_TOGGLES, LOADED_SETTINGS)).toBeNull();
  });

  it('merges every changed field into a single patch', () => {
    const patch = buildStoragePatch(
      '/custom',
      {
        usageSignalEnabled: true,
        crashReportingEnabled: true,
        dawWorkspaceEnabled: true,
        liveAdjustmentsEnabled: true,
        weeklyReminderEnabled: true,
        weeklyReminderServiceDay: 5,
      },
      LOADED_SETTINGS
    );
    expect(patch).toEqual({
      storageDir: '/custom',
      usageSignalEnabled: true,
      crashReportingEnabled: true,
      dawWorkspaceEnabled: true,
      liveAdjustmentsEnabled: true,
      weeklyReminderEnabled: true,
      weeklyReminderServiceDay: 5,
    });
  });

  it('treats a null loaded settings object as all-toggles-off', () => {
    expect(buildStoragePatch(null, { ...NO_TOGGLES, usageSignalEnabled: true }, null)).toEqual({
      usageSignalEnabled: true,
    });
    expect(buildStoragePatch(null, NO_TOGGLES, null)).toBeNull();
  });
});
