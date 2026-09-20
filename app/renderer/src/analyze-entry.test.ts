// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { shouldOfferListenLive, resolveListenLiveChoice } from './analyze-entry';
import type { AppSettings } from '../../electron/ipc/api';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true,
    lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false,
    soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    ...overrides,
  } as AppSettings;
}

describe('shouldOfferListenLive', () => {
  it('is false when settings have not loaded yet', () => {
    expect(shouldOfferListenLive(null)).toBe(false);
  });

  it('is false when lineCheckCalibrationEnabled is off, even in Advanced mode', () => {
    expect(shouldOfferListenLive(settings({ advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false }))).toBe(false);
  });

  it('is false in Simple mode even when lineCheckCalibrationEnabled is (improbably) on', () => {
    expect(shouldOfferListenLive(settings({ advancedFeaturesEnabled: false, lineCheckCalibrationEnabled: true }))).toBe(false);
  });

  it('is true only when both Advanced features and the flag are on', () => {
    expect(shouldOfferListenLive(settings({ advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: true }))).toBe(true);
  });
});

describe('resolveListenLiveChoice', () => {
  it('routes to Settings > Audio when no secondary device is configured', () => {
    expect(resolveListenLiveChoice('')).toBe('needsSecondarySource');
  });

  it('starts listening when a secondary device name is remembered', () => {
    expect(resolveListenLiveChoice('MOTU M2')).toBe('startListening');
  });
});
