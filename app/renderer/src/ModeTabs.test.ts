// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ModeTabs from './ModeTabs';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { resolveModeSwitch } from './mode-switch';
import { createAnalyzeEntryStore, type AnalyzeEntryDeps } from './stores/analyzeEntryStore';
import type { AppSettings } from '../../electron/ipc/api';

afterEach(() => {
  useLiveCaptureStore.setState({ appMode: 'reportcard' });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

function renderMarkup(): string {
  return renderToString(createElement(ModeTabs));
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, shareChurchName: '',
    lineCheckCalibrationEnabled: false,
    weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false,
    soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    ...overrides,
  } as AppSettings;
}

describe('ModeTabs', () => {
  it('renders all 9 buttons with their ids/data-mode', () => {
    const html = renderMarkup();
    expect(html).toContain('id="nav-analyze" data-mode="analyze"');
    expect(html).toContain('id="nav-history" data-mode="history"');
    expect(html).toContain('data-mode="dir"');
    expect(html).toContain('data-mode="live"');
    expect(html).toContain('data-mode="console"');
    expect(html).toContain('data-mode="recent"');
    expect(html).toContain('data-mode="guide"');
    expect(html).toContain('data-mode="ringout"');
    expect(html).toContain('data-mode="reportcard"');
  });

  it('marks the report card tab active by default', () => {
    const html = renderMarkup();
    expect(html).toContain('class="mode-tab active" data-mode="reportcard"');
  });

  it('marks whichever tab matches appMode as active instead', () => {
    useLiveCaptureStore.setState({ appMode: 'live' });
    const html = renderMarkup();
    const liveButton = html.slice(html.indexOf('data-mode="live"'), html.indexOf('data-mode="console"'));
    expect(html).toContain('class="mode-tab active" data-mode="live"');
    expect(liveButton).toContain('data-mode="live"');
    expect(liveButton).toContain('Session');
    expect(html).not.toContain('class="mode-tab active" data-mode="reportcard"');
  });

  it('renders the tab-lock decoration on Live only', () => {
    const html = renderMarkup();
    const liveButton = html.slice(html.indexOf('data-mode="live"'), html.indexOf('data-mode="console"'));
    const dirButton = html.slice(html.indexOf('data-mode="dir"'), html.indexOf('data-mode="live"'));
    const consoleButton = html.slice(html.indexOf('data-mode="console"'), html.indexOf('data-mode="recent"'));
    expect(liveButton).toContain('class="tab-lock"');
    expect(dirButton).not.toContain('tab-lock');
    expect(consoleButton).not.toContain('tab-lock');
  });

  it('does not mark History active by default (only set via a redirect click)', () => {
    const html = renderMarkup();
    expect(html).toContain('id="nav-history" data-mode="history"');
    expect(html).not.toContain('class="mode-tab active" id="nav-history"');
  });

  it('keeps every tab unhidden while settings are still loading', () => {
    const html = renderMarkup();
    expect(html).not.toContain('hidden=""');
  });

  it('marks advanced tabs hidden in Simple mode without removing them from the DOM', () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });
    const html = renderMarkup();

    for (const mode of ['dir', 'live', 'console', 'recent', 'guide', 'ringout', 'reportcard']) {
      const marker = `data-mode="${mode}"`;
      const start = html.indexOf(marker);
      const end = html.indexOf('</button>', start);
      const button = html.slice(start, end);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(button).toContain('hidden=""');
    }
    const analyzeStart = html.indexOf('id="nav-analyze"');
    const analyzeEnd = html.indexOf('</button>', analyzeStart);
    const analyzeButton = html.slice(analyzeStart, analyzeEnd);
    expect(analyzeStart).toBeGreaterThanOrEqual(0);
    expect(analyzeButton).not.toContain('hidden=""');

    const historyStart = html.indexOf('id="nav-history"');
    const historyEnd = html.indexOf('</button>', historyStart);
    const historyButton = html.slice(historyStart, historyEnd);
    expect(historyStart).toBeGreaterThanOrEqual(0);
    expect(historyButton).not.toContain('hidden=""');
  });

  it('shows the Report Card tab unhidden in Advanced mode', () => {
    useSettingsStore.setState({ settings: settings() });
    const html = renderMarkup();

    const start = html.indexOf('data-mode="reportcard"');
    const end = html.indexOf('</button>', start);
    const button = html.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(button).not.toContain('hidden=""');
  });

});

describe('ModeTabs Listen live wiring (#1485)', () => {
  const NO_ROOM_MIC = '';
  const ROOM_MIC = 'MOTU M2';

  const modeTabsSource = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ModeTabs.tsx'), 'utf8');

  it('routes the Analyze tab through enterAnalyze()', () => {
    expect(modeTabsSource).toContain('enterAnalyze()');
  });

  // handleClick carries a justified /* c8 ignore */ (no jsdom in this harness),
  // so these text guards plus the behavioral matrix below are the unit tier's
  // only hold on the wiring; tests/e2e/analyze-listen-live.spec.ts is the
  // end-to-end gate.
  it('never reintroduces lineCheckCalibration into the tab wiring', () => {
    expect(modeTabsSource).not.toContain('lineCheckCalibration');
  });

  it('never reintroduces the feature-tier gate shouldOfferListenLive', () => {
    expect(modeTabsSource).not.toContain('shouldOfferListenLive');
  });

  it('can no longer reach the file chooser directly from the tab click', () => {
    expect(modeTabsSource).not.toContain('chooseAndAnalyzeFile');
  });

  type AnalyzeTarget = 'dialog' | 'live-eq';

  async function analyzeTabTarget(roomMic: string): Promise<AnalyzeTarget> {
    const decision = resolveModeSwitch('analyze', 'reportcard');
    expect(decision).toEqual({ type: 'analyzeEntry' });

    const openSettingsAudio = vi.fn();
    const startSecondaryMeasurement = vi.fn(async () => {});
    const chooseAndAnalyzeFile = vi.fn(async () => {});
    const deps: AnalyzeEntryDeps = {
      chooseAndAnalyzeFile,
      getSecondaryDeviceName: () => roomMic,
      getCadence: () => ({ windowSecs: 3, meterIntervalMs: 100 }),
      startSecondaryMeasurement,
      stopSecondaryMeasurement: vi.fn(async () => {}),
      openSettingsAudio,
    };
    const store = createAnalyzeEntryStore(deps);
    await store.getState().enterAnalyze();

    expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
    if (store.getState().dialogOpen) {
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(store.getState().listening).toBe(false);
      return 'dialog';
    }
    expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
    expect(store.getState().listening).toBe(true);
    return 'live-eq';
  }

  const MATRIX: ReadonlyArray<{ advanced: boolean; roomMic: string; expected: AnalyzeTarget }> = [
    { advanced: false, roomMic: NO_ROOM_MIC, expected: 'dialog' },
    { advanced: false, roomMic: ROOM_MIC, expected: 'live-eq' },
    { advanced: true, roomMic: NO_ROOM_MIC, expected: 'dialog' },
    { advanced: true, roomMic: ROOM_MIC, expected: 'live-eq' },
  ];

  // Proves the tier no longer changes the outcome: the same (roomMic) input
  // yields the same target whether advancedFeaturesEnabled is true or false —
  // resolveModeSwitch/enterAnalyze take no settings argument at all.
  it.each(MATRIX)(
    'Advanced=$advanced roomMic="$roomMic" -> $expected',
    async ({ roomMic, expected }) => {
      expect(await analyzeTabTarget(roomMic)).toBe(expected);
    },
  );

  it('Simple mode reaches the live-EQ view in one click when a room mic is configured (AC1)', async () => {
    expect(await analyzeTabTarget(ROOM_MIC)).toBe('live-eq');
  });
});
