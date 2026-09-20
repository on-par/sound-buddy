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

// The room-mic dimension as the gate could see it: AppSettings.measurementDeviceName
// is '' until the engineer picks a measurement device in Settings > Audio.
const NO_ROOM_MIC = '';
const ROOM_MIC = 'MOTU M2';

describe('shouldOfferListenLive', () => {
  it('is false when settings have not loaded yet', () => {
    expect(shouldOfferListenLive(null)).toBe(false);
  });

  const MATRIX: ReadonlyArray<{ advanced: boolean; roomMic: string; calibration: boolean; expected: boolean }> = [
    { advanced: false, roomMic: NO_ROOM_MIC, calibration: false, expected: false },
    { advanced: false, roomMic: NO_ROOM_MIC, calibration: true, expected: false },
    { advanced: false, roomMic: ROOM_MIC, calibration: false, expected: false },
    { advanced: false, roomMic: ROOM_MIC, calibration: true, expected: false },
    { advanced: true, roomMic: NO_ROOM_MIC, calibration: false, expected: true },
    { advanced: true, roomMic: NO_ROOM_MIC, calibration: true, expected: true },
    { advanced: true, roomMic: ROOM_MIC, calibration: false, expected: true },
    { advanced: true, roomMic: ROOM_MIC, calibration: true, expected: true },
  ];

  it.each(MATRIX)(
    'Advanced=$advanced roomMic="$roomMic" calibration=$calibration -> $expected',
    ({ advanced, roomMic, calibration, expected }) => {
      expect(shouldOfferListenLive(settings({
        advancedFeaturesEnabled: advanced,
        measurementDeviceName: roomMic,
        lineCheckCalibrationEnabled: calibration,
      }))).toBe(expected);
    },
  );

  it('never consults lineCheckCalibrationEnabled — flipping it changes nothing for any (Advanced, room-mic) pair', () => {
    const pairs: ReadonlyArray<{ advanced: boolean; roomMic: string }> = [
      { advanced: false, roomMic: NO_ROOM_MIC },
      { advanced: false, roomMic: ROOM_MIC },
      { advanced: true, roomMic: NO_ROOM_MIC },
      { advanced: true, roomMic: ROOM_MIC },
    ];
    for (const { advanced, roomMic } of pairs) {
      const off = shouldOfferListenLive(settings({
        advancedFeaturesEnabled: advanced, measurementDeviceName: roomMic, lineCheckCalibrationEnabled: false,
      }));
      const on = shouldOfferListenLive(settings({
        advancedFeaturesEnabled: advanced, measurementDeviceName: roomMic, lineCheckCalibrationEnabled: true,
      }));
      expect(on).toBe(off);
    }
  });

  it('the calibration flag alone (Advanced off) does not offer Listen live', () => {
    expect(shouldOfferListenLive(settings({ advancedFeaturesEnabled: false, lineCheckCalibrationEnabled: true }))).toBe(false);
  });

  it('is offered with Advanced on and the calibration flag off (the #1483 correction)', () => {
    expect(shouldOfferListenLive(settings({ advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false }))).toBe(true);
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
