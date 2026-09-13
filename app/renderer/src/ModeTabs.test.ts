// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ModeTabs from './ModeTabs';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
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
    crashReportingEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, advancedFeaturesEnabled: true, shareChurchName: '',
    weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    ...overrides,
  };
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

  it('does not hide tabs when report-first-ux has precedence', () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false, reportFirstUxEnabled: true }) });
    const html = renderMarkup();
    expect(html).not.toContain('hidden=""');
  });
});
