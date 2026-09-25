// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { ALL_TAB_MODES, clampBootMode, isModeFlagEnabled, isSimpleMode, visibleTabModes } from './simple-mode';
import type { AppSettings } from '../../electron/ipc/api';
import { ALL_FEATURE_FLAGS_OFF, resolveFeatureFlags } from '../../electron/feature-flags';

const ALL_FEATURE_FLAGS_ON = resolveFeatureFlags({ SOUND_BUDDY_FEATURES: 'all' });

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

describe('isModeFlagEnabled (#1520)', () => {
  const GATED_MODES = ['reportcard', 'dir', 'live', 'console', 'guide', 'ringout'];

  it.each(GATED_MODES)('%s is disabled with all flags off', (mode) => {
    expect(isModeFlagEnabled(mode, ALL_FEATURE_FLAGS_OFF)).toBe(false);
  });

  it.each(GATED_MODES)('%s is enabled with all flags on', (mode) => {
    expect(isModeFlagEnabled(mode, ALL_FEATURE_FLAGS_ON)).toBe(true);
  });

  it.each(['analyze', 'history', 'recent'])('%s is always enabled, even with all flags off', (mode) => {
    expect(isModeFlagEnabled(mode, ALL_FEATURE_FLAGS_OFF)).toBe(true);
  });

  it('gates only the named flag, leaving the rest off', () => {
    const flags = resolveFeatureFlags({ SOUND_BUDDY_FEATURES: 'console' });
    expect(isModeFlagEnabled('console', flags)).toBe(true);
    expect(isModeFlagEnabled('live', flags)).toBe(false);
    expect(isModeFlagEnabled('dir', flags)).toBe(false);
  });

  // Byte-stability regression (#1520): visibleTabModes/clampBootMode are pure
  // functions of AppSettings only — adding the flags gate elsewhere must not
  // change their output for any settings shape.
  it('does not change visibleTabModes output for Simple/Advanced/null settings', () => {
    expect(visibleTabModes(null)).toEqual(ALL_TAB_MODES);
    expect(visibleTabModes(settings())).toEqual(ALL_TAB_MODES);
    expect(visibleTabModes(settings({ advancedFeaturesEnabled: false }))).toEqual(['analyze', 'history']);
  });
});
