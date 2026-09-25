// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ModeTabs from './ModeTabs';
import { clampBootMode, visibleTabModes } from './simple-mode';
import { resolveModeSwitch, switchMode } from './mode-switch';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
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
    for (const mode of ['analyze', 'history', 'dir', 'live', 'console', 'recent', 'guide', 'ringout']) {
      expect(modeTabsMarkup).toContain(`data-mode="${mode}"`);
    }
    expect(modeTabsMarkup).not.toContain('data-mode="reportcard"');
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

// #1510: cold boot and every programmatic "go to Report Card" route must land
// a Simple-mode user on the Analyze stage, never a tab-less #reportcard-view.
describe('Simple-mode Report Card redirect (#1510)', () => {
  function settings(overrides: Partial<AppSettings> = {}): AppSettings {
    return {
      idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
      usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
      crashReportingEnabled: false, liveAdjustmentsEnabled: false,
      advancedFeaturesEnabled: false, shareChurchName: '',
      weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
      measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false,
      soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
      ...overrides,
    } as AppSettings;
  }

  it('clamps a Simple-mode boot request for reportcard to analyze', () => {
    expect(clampBootMode('reportcard', settings())).toBe('analyze');
  });

  it('a fresh liveCaptureStore lands on analyze (#1510)', () => {
    expect(useLiveCaptureStore.getInitialState().appMode).toBe('analyze');
  });

  describe('switchMode redirect', () => {
    function makeClassList(classes: Set<string>) {
      return {
        add: (c: string) => { classes.add(c); },
        remove: (c: string) => { classes.delete(c); },
        toggle: (c: string, force?: boolean) => {
          const on = force === undefined ? !classes.has(c) : force;
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
        contains: (c: string) => classes.has(c),
      };
    }

    afterEach(() => {
      delete (globalThis as { document?: unknown }).document;
      delete (globalThis as { window?: unknown }).window;
      useLiveCaptureStore.setState({ appMode: 'reportcard' });
      useSettingsStore.setState({ settings: null, settingsError: null });
      useAnalyzeEntryStore.setState({ analyzeStage: false });
    });

    it("switchMode('reportcard') with Simple settings loaded lands on the Analyze stage", () => {
      // Minimal fake document/window, matching mode-switch.test.ts's pattern.
      const bodyClasses = new Set<string>();
      const reportCardClasses = new Set<string>();
      const reportCardView = { classList: makeClassList(reportCardClasses) };
      (globalThis as { document?: unknown }).document = {
        getElementById: (id: string) => (id === 'reportcard-view' ? reportCardView : null),
        querySelectorAll: () => [],
        body: { classList: makeClassList(bodyClasses) },
      };
      (globalThis as { window?: unknown }).window = {
        soundBuddy: createMockSoundBuddy().api,
        singleColumnState: { isSingleColumn: () => false },
      };
      useSettingsStore.setState({ settings: settings() });

      switchMode('reportcard');

      expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
      expect(bodyClasses.has('rc-active')).toBe(false);
      expect(reportCardView.classList.contains('active')).toBe(false);
      expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
    });
  });
});
