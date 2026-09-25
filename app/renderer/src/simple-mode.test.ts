// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { ALL_TAB_MODES, clampBootMode, isSimpleMode, visibleTabModes } from './simple-mode';
import type { AppSettings } from '../../electron/ipc/api';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, shareChurchName: '',
    weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false,
    soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    ...overrides,
  } as AppSettings;
}

describe('simple-mode', () => {
  it('treats null settings as Advanced while the store is still loading', () => {
    expect(isSimpleMode(null)).toBe(false);
    expect(visibleTabModes(null)).toEqual(['analyze', 'history', 'dir', 'live', 'console', 'recent', 'guide', 'ringout']);
  });

  it('is Simple mode only when advanced features are disabled', () => {
    expect(isSimpleMode(settings({ advancedFeaturesEnabled: false }))).toBe(true);
    expect(visibleTabModes(settings({ advancedFeaturesEnabled: false }))).toEqual(['analyze', 'history']);
  });

  it('keeps Report Card out of every mode-tab list', () => {
    expect(visibleTabModes(settings({ advancedFeaturesEnabled: false }))).not.toContain('reportcard');
    expect(visibleTabModes(settings({ advancedFeaturesEnabled: false }))).toContain('analyze');
    expect(visibleTabModes(settings())).not.toContain('reportcard');
    expect(visibleTabModes(settings())).toEqual(ALL_TAB_MODES);
  });

  it('clamps a hidden boot mode to analyze in Simple mode', () => {
    expect(clampBootMode('live', settings({ advancedFeaturesEnabled: false }))).toBe('analyze');
  });

  it('leaves visible modes unchanged and falls back to analyze for programmatic modes hidden in Simple mode', () => {
    const s = settings({ advancedFeaturesEnabled: false });
    expect(clampBootMode('analyze', s)).toBe('analyze');
    expect(clampBootMode('history', s)).toBe('history');
    expect(clampBootMode('reportcard', s)).toBe('analyze');
    expect(clampBootMode('guide', settings())).toBe('guide');
  });

  it('falls back to analyze for an unrecognized mode in Advanced mode too (#1510)', () => {
    expect(clampBootMode('soundcheck', settings())).toBe('analyze');
  });

  it('clamps reportcard to analyze in Advanced mode too (#1507)', () => {
    expect(clampBootMode('reportcard', settings())).toBe('analyze');
  });
});
