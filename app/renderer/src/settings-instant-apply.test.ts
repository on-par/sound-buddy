// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  instantSettingValues,
  commitInstantSetting,
  WEEKLY_REMINDER_DEFAULT_DAY,
  type InstantSettingKey,
  type InstantSettingValues,
} from './settings-instant-apply';
import { createSettingsStore } from './stores/settingsStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import { buildStoragePatch } from './storage-settings';
import type { AppSettings } from '../../electron/ipc/api';
import type { StorageToggles } from './storage-settings';

const FULL_SETTINGS: AppSettings = {
  idealProfile: '',
  customIdealProfiles: [],
  storageDir: '',
  rigs: [],
  activeRigId: null,
  usageSignalEnabled: true,
  channelLabels: {},
  channelGroups: {},
  inputInstrumentProfiles: {},
  crashReportingEnabled: true,
  dawWorkspaceEnabled: true,
  liveAdjustmentsEnabled: true,
  reportFirstUxEnabled: false,
  shareChurchName: '',
  weeklyReminderEnabled: true,
  weeklyReminderServiceDay: 3,
  liveEqPaneWidth: 360,
  measurementDeviceName: '',
  gradingProfile: 'broadcast',
  consoleNetworkConsentGranted: false,
  soundcheckBuses: [],
};

describe('instantSettingValues', () => {
  it('returns the documented defaults when settings is null', () => {
    expect(instantSettingValues(null)).toEqual({
      gradingProfile: 'casual',
      weeklyReminderEnabled: false,
      weeklyReminderServiceDay: 0,
      usageSignalEnabled: false,
      crashReportingEnabled: false,
      dawWorkspaceEnabled: false,
      liveAdjustmentsEnabled: false,
    });
  });

  it('mirrors a fully-populated AppSettings field by field', () => {
    expect(instantSettingValues(FULL_SETTINGS)).toEqual({
      gradingProfile: 'broadcast',
      weeklyReminderEnabled: true,
      weeklyReminderServiceDay: 3,
      usageSignalEnabled: true,
      crashReportingEnabled: true,
      dawWorkspaceEnabled: true,
      liveAdjustmentsEnabled: true,
    });
  });

  it('falls back to casual for an unrecognized gradingProfile value', () => {
    const settings = { ...FULL_SETTINGS, gradingProfile: 'strict' } as unknown as AppSettings;
    expect(instantSettingValues(settings).gradingProfile).toBe('casual');
  });

  it('falls back to the default service day when weeklyReminderServiceDay is missing', () => {
    const settings = { ...FULL_SETTINGS, weeklyReminderServiceDay: undefined } as unknown as AppSettings;
    expect(instantSettingValues(settings).weeklyReminderServiceDay).toBe(WEEKLY_REMINDER_DEFAULT_DAY);
  });

  it('coerces a truthy-but-not-boolean flag to true', () => {
    const settings = { ...FULL_SETTINGS, usageSignalEnabled: 1 } as unknown as AppSettings;
    expect(instantSettingValues(settings).usageSignalEnabled).toBe(true);
  });

  it('satisfies StorageToggles at compile time', () => {
    const toggles: StorageToggles = instantSettingValues(null);
    expect(toggles.gradingProfile).toBe('casual');
  });
});

describe('commitInstantSetting', () => {
  const CASES: { key: InstantSettingKey; value: InstantSettingValues[InstantSettingKey] }[] = [
    { key: 'gradingProfile', value: 'broadcast' },
    { key: 'weeklyReminderEnabled', value: true },
    { key: 'weeklyReminderServiceDay', value: 5 },
    { key: 'usageSignalEnabled', value: true },
    { key: 'crashReportingEnabled', value: true },
    { key: 'dawWorkspaceEnabled', value: true },
    { key: 'liveAdjustmentsEnabled', value: true },
  ];

  for (const { key, value } of CASES) {
    it(`sends a patch with only the ${key} key`, async () => {
      const mock = createMockSoundBuddy({
        updateSettings: async (patch) => {
          mock.calls.push({ method: 'updateSettings', args: [patch] });
          return { ...FULL_SETTINGS, [key]: value };
        },
      });
      const store = createSettingsStore(() => mock.api);

      await commitInstantSetting(store, key, value);

      const call = mock.calls.find((c) => c.method === 'updateSettings');
      expect(call).toEqual({ method: 'updateSettings', args: [{ [key]: value }] });
      expect(Object.keys(call!.args[0] as object)).toHaveLength(1);
    });
  }

  it('writes the returned settings through to the store', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: async () => FULL_SETTINGS,
    });
    const store = createSettingsStore(() => mock.api);

    await commitInstantSetting(store, 'crashReportingEnabled', true);

    expect(store.getState().settings).toBe(FULL_SETTINGS);
  });
});

describe('Save emits nothing when every control is already persisted', () => {
  it('returns null when the only diffed toggles come from the same persisted settings', () => {
    expect(buildStoragePatch(instantSettingValues(FULL_SETTINGS), FULL_SETTINGS)).toBeNull();
  });
});
