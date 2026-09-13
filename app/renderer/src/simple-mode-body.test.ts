// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { syncSimpleModeBodyClass } from './simple-mode-body';
import type { AppSettings } from '../../electron/ipc/api';

function makeClassList() {
  const classes = new Set<string>();
  return {
    toggle: (c: string, force?: boolean) => {
      const on = force === undefined ? !classes.has(c) : force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    },
    contains: (c: string) => classes.has(c),
  };
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, advancedFeaturesEnabled: true, shareChurchName: '',
    weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    ...overrides,
  };
}

let classList: ReturnType<typeof makeClassList>;

beforeEach(() => {
  classList = makeClassList();
  (globalThis as { document?: unknown }).document = { body: { classList } };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe('syncSimpleModeBodyClass', () => {
  it('adds simple-mode when advanced features are disabled', () => {
    syncSimpleModeBodyClass(settings({ advancedFeaturesEnabled: false }));
    expect(classList.contains('simple-mode')).toBe(true);
  });

  it('removes simple-mode while settings are loading', () => {
    classList.toggle('simple-mode', true);
    syncSimpleModeBodyClass(null);
    expect(classList.contains('simple-mode')).toBe(false);
  });

  it('removes simple-mode when report-first-ux has precedence', () => {
    classList.toggle('simple-mode', true);
    syncSimpleModeBodyClass(settings({ advancedFeaturesEnabled: false, reportFirstUxEnabled: true }));
    expect(classList.contains('simple-mode')).toBe(false);
  });
});
