// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ModeTabs from './ModeTabs';
import { visibleTabModes } from './simple-mode';
import { resolveModeSwitch } from './mode-switch';
import type { AppSettings } from '../../electron/ipc/api';

const appCss = fs.readFileSync(fileURLToPath(new URL('./styles/app.css', import.meta.url)), 'utf8');
const modeTabsSrc = fs.readFileSync(fileURLToPath(new URL('./ModeTabs.tsx', import.meta.url)), 'utf8');
const modeTabsMarkup = renderToString(createElement(ModeTabs));

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false,
    advancedFeaturesEnabled: true, shareChurchName: '',
    weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false,
    soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    ...overrides,
  } as AppSettings;
}

describe('Simple-mode nav invariant', () => {
  it('ModeTabs keeps every workspace mounted and drives visibility from visibleTabModes', () => {
    for (const mode of ['analyze', 'history', 'dir', 'live', 'console', 'recent', 'guide', 'ringout', 'reportcard']) {
      expect(modeTabsMarkup).toContain(`data-mode="${mode}"`);
    }
    expect(modeTabsSrc).toContain('hidden={!visibleModes.includes(tab.mode)}');
    expect(visibleTabModes(settings({ advancedFeaturesEnabled: false }))).toEqual(['analyze', 'history']);
  });

  it('CSS has no bare display:none rule on mode-tab data-mode selectors', () => {
    for (const line of appCss.split('\n')) {
      if (/\.mode-tab\[data-mode=/.test(line)) expect(line).not.toMatch(/display:\s*none/);
    }
  });

  it('Analyze always opens the entry point (never a direct file chooser) and History still reaches Recent', () => {
    expect(resolveModeSwitch('analyze', 'reportcard')).toEqual({ type: 'analyzeEntry' });
    expect(resolveModeSwitch('analyze', 'analyze')).toEqual({ type: 'analyzeEntry' });
    expect(resolveModeSwitch('history', 'reportcard')).toEqual({ type: 'redirect', mode: 'recent' });
  });

  it('Analyze and History are not special-cased by CSS visibility rules', () => {
    expect(appCss).not.toContain('#nav-analyze, #nav-history { display:none; }');
    expect(appCss).not.toContain('body.simple-mode #nav-analyze, body.simple-mode #nav-history { display:inline-flex; }');
  });
});
