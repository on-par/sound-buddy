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
import { isSimpleMode } from './simple-mode';
import { shouldOfferListenLive } from './analyze-entry';
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

    for (const mode of ['dir', 'live', 'console', 'recent', 'guide', 'ringout']) {
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
    expect(html).toContain('id="nav-history" data-mode="history"');
    expect(html).toContain('data-mode="reportcard"');
  });

});

describe('ModeTabs Listen live wiring (#1481)', () => {
  const NO_ROOM_MIC = '';
  const ROOM_MIC = 'MOTU M2';

  const modeTabsSource = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ModeTabs.tsx'), 'utf8');

  it('hands resolveModeSwitch exactly the analyze-entry predicate for listenLiveAvailable', () => {
    expect(modeTabsSource).toContain('listenLiveAvailable: shouldOfferListenLive(settings)');
  });

  // handleClick carries a justified /* c8 ignore */ (no jsdom in this harness),
  // so this text guard plus the behavioral matrix below is the unit tier's
  // only hold on the wiring; tests/e2e/analyze-listen-live.spec.ts is the
  // end-to-end gate.
  it('never reintroduces lineCheckCalibration into the tab wiring', () => {
    expect(modeTabsSource).not.toContain('lineCheckCalibration');
  });

  type AnalyzeTarget = 'file-chooser' | 'settings-audio' | 'live-eq';

  async function analyzeTabTarget(s: AppSettings, roomMic: string): Promise<AnalyzeTarget> {
    const decision = resolveModeSwitch('analyze', 'reportcard', {
      simpleMode: isSimpleMode(s),
      listenLiveAvailable: shouldOfferListenLive(s),
    });
    if (decision.type === 'chooseFile') return 'file-chooser';
    expect(decision).toEqual({ type: 'analyzeEntry' });

    const openSettingsAudio = vi.fn();
    const startSecondaryMeasurement = vi.fn(async () => {});
    const deps: AnalyzeEntryDeps = {
      chooseAndAnalyzeFile: vi.fn(async () => {}),
      getSecondaryDeviceName: () => roomMic,
      getCadence: () => ({ windowSecs: 3, meterIntervalMs: 100 }),
      startSecondaryMeasurement,
      stopSecondaryMeasurement: vi.fn(async () => {}),
      openSettingsAudio,
    };
    const store = createAnalyzeEntryStore(deps);
    store.getState().open();
    await store.getState().listenLive();

    if (openSettingsAudio.mock.calls.length > 0) {
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(store.getState().listening).toBe(false);
      return 'settings-audio';
    }
    expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
    expect(store.getState().listening).toBe(true);
    return 'live-eq';
  }

  const MATRIX: ReadonlyArray<{ advanced: boolean; roomMic: string; calibration: boolean; expected: AnalyzeTarget }> = [
    { advanced: false, roomMic: NO_ROOM_MIC, calibration: false, expected: 'file-chooser' },
    { advanced: false, roomMic: NO_ROOM_MIC, calibration: true, expected: 'file-chooser' },
    { advanced: false, roomMic: ROOM_MIC, calibration: false, expected: 'file-chooser' },
    { advanced: false, roomMic: ROOM_MIC, calibration: true, expected: 'file-chooser' },
    { advanced: true, roomMic: NO_ROOM_MIC, calibration: false, expected: 'settings-audio' },
    { advanced: true, roomMic: NO_ROOM_MIC, calibration: true, expected: 'settings-audio' },
    { advanced: true, roomMic: ROOM_MIC, calibration: false, expected: 'live-eq' },
    { advanced: true, roomMic: ROOM_MIC, calibration: true, expected: 'live-eq' },
  ];

  it.each(MATRIX)(
    'Advanced=$advanced roomMic="$roomMic" calibration=$calibration -> $expected',
    async ({ advanced, roomMic, calibration, expected }) => {
      const s = settings({
        advancedFeaturesEnabled: advanced,
        measurementDeviceName: roomMic,
        lineCheckCalibrationEnabled: calibration,
      });
      expect(await analyzeTabTarget(s, roomMic)).toBe(expected);
    },
  );

  it('Simple mode still opens the file chooser in one click', () => {
    const s = settings({ advancedFeaturesEnabled: false });
    const decision = resolveModeSwitch('analyze', 'reportcard', {
      simpleMode: isSimpleMode(s),
      listenLiveAvailable: shouldOfferListenLive(s),
    });
    expect(decision).toEqual({ type: 'chooseFile' });
    expect(shouldOfferListenLive(s)).toBe(false);
  });

  it('offers Listen live with the calibration flag off (the #1483 correction)', async () => {
    const s = settings({
      advancedFeaturesEnabled: true,
      lineCheckCalibrationEnabled: false,
      measurementDeviceName: ROOM_MIC,
    });
    const decision = resolveModeSwitch('analyze', 'reportcard', {
      simpleMode: isSimpleMode(s),
      listenLiveAvailable: shouldOfferListenLive(s),
    });
    expect(decision).toEqual({ type: 'analyzeEntry' });
    expect(await analyzeTabTarget(s, ROOM_MIC)).toBe('live-eq');
  });
});
