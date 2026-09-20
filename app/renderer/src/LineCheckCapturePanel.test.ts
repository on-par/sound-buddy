// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LineCheckCapturePanel from './LineCheckCapturePanel';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useLineCheckCaptureStore } from './stores/lineCheckCaptureStore';
import type { LiveDevice } from './live-capture-panel';
import type { AppSettings } from '../../electron/ipc/api';

// Same window/store beforeEach convention as LiveAdjustmentsPanel.test.ts —
// only rigReconcile is needed here (resolveStripLabel, via labelAt).
const rigReconcile = require('../rig-reconcile.js');

const DEVICES: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 },
];

const CONFIG = [
  { kind: 'mono' as const, a: 0, b: 1, label: 'Kick' },
  { kind: 'mono' as const, a: 1, b: 2, label: '' },
];

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    splCalibrationOffsetDb: null, lastAppMode: '',
    ...overrides,
  };
}

function renderMarkup(): string {
  return renderToString(createElement(LineCheckCapturePanel));
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { rigReconcile };
  useLiveCaptureStore.setState({
    channelConfig: CONFIG,
    devices: DEVICES,
    selectedDevice: '0',
    appMode: 'live',
    soloedChannels: {},
    lastLiveChannels: null,
  });
  useSettingsStore.setState({ settings: settings({ lineCheckCalibrationEnabled: true }) });
  useLineCheckCaptureStore.setState({ capturing: false, status: '' });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({ appMode: 'reportcard', soloedChannels: {}, lastLiveChannels: null });
  useSettingsStore.setState({ settings: null, settingsError: null });
  useLineCheckCaptureStore.setState({ capturing: false, status: '' });
});

describe('LineCheckCapturePanel (#1467)', () => {
  it('renders nothing off the Live tab', () => {
    useLiveCaptureStore.setState({ appMode: 'reportcard' });
    expect(renderMarkup()).toBe('');
  });

  it('renders nothing when lineCheckCalibrationEnabled is off, even with an unambiguous solo', () => {
    useSettingsStore.setState({ settings: settings({ lineCheckCalibrationEnabled: false }) });
    useLiveCaptureStore.setState({ soloedChannels: { 0: true } });
    expect(renderMarkup()).toBe('');
  });

  it('renders a disabled control with the idle hint when no channel is soloed', () => {
    const html = renderMarkup();
    expect(html).toContain('disabled');
    expect(html).toContain('Solo exactly one channel to enable capture.');
    expect(html).toContain('Capture this channel');
  });

  it('renders a disabled control when more than one channel is soloed (ambiguous)', () => {
    useLiveCaptureStore.setState({ soloedChannels: { 0: true, 1: true } });
    const html = renderMarkup();
    expect(html).toContain('disabled');
  });

  it('renders an enabled control naming the sole soloed channel by its configured label', () => {
    useLiveCaptureStore.setState({ soloedChannels: { 0: true } });
    const html = renderMarkup();
    expect(html).not.toContain('disabled');
    expect(html).toContain('Ready to capture Kick.');
  });

  it('falls back to "Ch N" when the soloed strip has no label and no live channel name', () => {
    useLiveCaptureStore.setState({ soloedChannels: { 1: true } });
    const html = renderMarkup();
    expect(html).toContain('Ready to capture Ch 2.');
  });

  it('falls back to the live channel name when the soloed strip has no configured label', () => {
    useLiveCaptureStore.setState({
      soloedChannels: { 1: true },
      lastLiveChannels: [
        { index: 0, name: '', rms: -20, peak: -10, clipping: false },
        { index: 1, name: 'SM58', rms: -20, peak: -10, clipping: false },
      ] as never,
    });
    const html = renderMarkup();
    expect(html).toContain('Ready to capture SM58.');
  });

  it('falls back to "Ch N" when lastLiveChannels has no entry at the soloed index', () => {
    useLiveCaptureStore.setState({
      soloedChannels: { 1: true },
      lastLiveChannels: [{ index: 0, name: 'Kick mic', rms: -20, peak: -10, clipping: false }] as never,
    });
    const html = renderMarkup();
    expect(html).toContain('Ready to capture Ch 2.');
  });

  it('falls back to "Ch N" when the soloed index has no channelConfig entry at all', () => {
    useLiveCaptureStore.setState({ soloedChannels: { 5: true } });
    const html = renderMarkup();
    expect(html).toContain('Ready to capture Ch 6.');
  });

  it('shows a "Stop capture" affordance while capturing, naming the current target', () => {
    useLiveCaptureStore.setState({ soloedChannels: { 0: true } });
    useLineCheckCaptureStore.setState({ capturing: true, status: 'Capturing…' });
    const html = renderMarkup();
    expect(html).toContain('Stop capture');
    expect(html).toContain('Capturing Kick…');
    expect(html).not.toContain('disabled');
  });

  it('stays enabled to stop even if the solo state changes away from the target mid-capture', () => {
    useLineCheckCaptureStore.setState({ capturing: true, status: 'Capturing…' });
    const html = renderMarkup();
    expect(html).toContain('Stop capture');
    expect(html).not.toContain('disabled');
  });
});
