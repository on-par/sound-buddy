// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure decision logic for the Analyze tab's "Listen live" entry point
// (#1468, lc-05). The room-mic secondary-source machinery
// (measurement-device-state.ts) is reused unchanged — this module only
// decides *whether* to offer the entry point and *what* clicking it should
// do, given the current settings/state.

import type { AppSettings } from '../../electron/ipc/api';

// Gated behind Advanced features (nested location of the toggle,
// SettingsPanel.tsx) AND lineCheckCalibrationEnabled itself — requiring both
// keeps #1419's Simple-mode default preserved by construction, since the
// issue's AC2 names only the flag but the flag's own toggle only renders
// under Advanced.
export function shouldOfferListenLive(settings: AppSettings | null): boolean {
  return settings !== null
    && settings.advancedFeaturesEnabled === true
    && settings.lineCheckCalibrationEnabled === true;
}

export type ListenLiveChoice = 'startListening' | 'needsSecondarySource';

// deviceName is the persisted secondary-measurement-device preference
// (liveCaptureStore.secondaryMeasurement.deviceName, hydrated outside the
// Live tab by stores/bridge.ts). '' means the user has never chosen one —
// AC4 routes that case to Settings > Audio instead of a silent failure.
export function resolveListenLiveChoice(deviceName: string): ListenLiveChoice {
  return deviceName === '' ? 'needsSecondarySource' : 'startListening';
}
