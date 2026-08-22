// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Instant-apply Settings controls (#1018, epic #1000). The one place the
// seven non-storage, non-church-name Settings controls' display values are
// derived from AppSettings, and the one place a single-key patch is sent —
// so SettingsPanel.tsx renders straight from settingsStore's persisted
// `settings` instead of mirroring it into local state seeded on dialog open.

import type { StoreApi, UseBoundStore } from 'zustand';
import type { AppSettings, UpdateSettingsPatch } from '../../electron/ipc/api';
import type { SettingsState } from './stores/settingsStore';

export type InstantSettingKey =
  | 'gradingProfile'
  | 'weeklyReminderEnabled'
  | 'weeklyReminderServiceDay'
  | 'usageSignalEnabled'
  | 'crashReportingEnabled'
  | 'liveAdjustmentsEnabled';

// The render-time projection of the six instant-apply Settings controls,
// derived straight from persisted AppSettings.
export interface InstantSettingValues {
  gradingProfile: 'casual' | 'broadcast';
  weeklyReminderEnabled: boolean;
  weeklyReminderServiceDay: number;
  usageSignalEnabled: boolean;
  crashReportingEnabled: boolean;
  liveAdjustmentsEnabled: boolean;
}

export type InstantSettingsStore = UseBoundStore<StoreApi<SettingsState>>;

export const WEEKLY_REMINDER_DEFAULT_DAY = 0;

// Same coercions the old dialog-open seeding effect applied, in one pure
// place so they are unit-testable (the effect itself is c8-ignored).
export function instantSettingValues(settings: AppSettings | null): InstantSettingValues {
  return {
    gradingProfile: settings?.gradingProfile === 'broadcast' ? 'broadcast' : 'casual',
    weeklyReminderEnabled: !!settings?.weeklyReminderEnabled,
    weeklyReminderServiceDay: settings?.weeklyReminderServiceDay ?? WEEKLY_REMINDER_DEFAULT_DAY,
    usageSignalEnabled: !!settings?.usageSignalEnabled,
    crashReportingEnabled: !!settings?.crashReportingEnabled,
    liveAdjustmentsEnabled: !!settings?.liveAdjustmentsEnabled,
  };
}

export function commitInstantSetting<K extends InstantSettingKey>(
  store: InstantSettingsStore,
  key: K,
  value: InstantSettingValues[K]
): Promise<void> {
  // TS cannot correlate a generic computed key with its value type, so the
  // object literal widens to `{ [x: string]: ... }`. The cast is sound:
  // InstantSettingKey is a subset of keyof UpdateSettingsPatch and
  // InstantSettingValues[K] matches UpdateSettingsPatch[K] for each key.
  return store.getState().updateSettings({ [key]: value } as UpdateSettingsPatch);
}
