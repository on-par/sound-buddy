// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveEqPane from './LiveEqPane';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { eqPaneHTML, eqPaneView, type EqPaneView } from './live-capture-panel';
import type { LiveEvent } from './live-capture-panel';
import type { AppSettings } from '../../electron/ipc/api';

const trackWorkspace = require('../track-workspace.js');
const armState = require('../arm-state.js');
const groupState = require('../group-state.js');
const rigReconcile = require('../rig-reconcile.js');
const instrumentProfiles = require('../instrument-profiles.js');
const liveSetupState = require('../live-setup-state.js');
const liveAdjustmentsState = require('../live-adjustments-state.js');
const dawWorkspaceState = require('../daw-workspace-state.js');
const dawPlayheadState = require('../daw-playhead-state.js');
const dawWaveformState = require('../daw-waveform-state.js');
const grading = require('../grading.js');

const CONFIG = [
  { kind: 'mono' as const, a: 0, b: 1, armed: true },
  { kind: 'mono' as const, a: 1, b: 2, armed: true },
];

const TICK_CHANNELS = [
  { index: 0, name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400, rolloff: 8000,
    bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
  { index: 1, name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300, rolloff: 5000,
    bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
];

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 400,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    ...overrides,
  };
}

function renderMarkup(): string {
  return renderToString(createElement(LiveEqPane));
}

// The exact output eqPaneHTML would produce for the current discrete slots —
// pinned so a change to the pane's own logic (not the store wiring) is what
// fails when it drifts.
function expectedPaneHTML(): string {
  const s = useLiveCaptureStore.getState();
  const channels = s.lastLiveChannels || CONFIG.map(() => trackWorkspace.idleChannel(['sub_bass', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance']));
  const secondaryActive = s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0;
  const override = secondaryActive && s.lastMeasurementChannels
    ? { ch: s.lastMeasurementChannels[0], label: s.secondaryMeasurement.deviceName }
    : null;
  const view: EqPaneView = eqPaneView(channels, s.channelConfig, s.measurementSource, s.selectedChannel, override);
  return eqPaneHTML(view);
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    trackWorkspace, armState, groupState, rigReconcile, instrumentProfiles,
    liveSetupState, liveAdjustmentsState, dawWorkspaceState, dawPlayheadState,
    dawWaveformState, grading,
  };
  useLiveCaptureStore.setState({
    channelConfig: CONFIG,
    channelGroups: [],
    devices: [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }],
    selectedDevice: '',
    isCapturing: false,
    liveMode: 'monitor',
    appMode: 'live',
    selectedChannel: null,
    measurementSource: null,
    focusedInputIndex: null,
    lapCoaching: null,
    liveWindows: [],
    lastTick: null,
    lastLiveChannels: TICK_CHANNELS as never,
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
    lastMeasurementChannels: null,
  });
  useSettingsStore.setState({ settings: settings() });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({
    appMode: 'reportcard', selectedChannel: null, measurementSource: null, lastLiveChannels: null,
    secondaryMeasurement: { status: 'off', deviceName: '' }, secondaryWindows: [], lastMeasurementChannels: null,
  });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

describe('LiveEqPane', () => {
  it('renders the Room section only until a strip is selected (#668)', () => {
    const html = renderMarkup();
    expect(html).toBe(`<div>${expectedPaneHTML()}</div>`);
    expect(html).toContain('eq-pane-primary');
    expect(html).toContain('Room — Track 1');
    expect(html).toContain('eq-pane-empty-hint');
    expect(html).not.toContain('eq-pane-secondary">');
  });

  it('adds the Selected section for the clicked strip with the measurement-source suffix when it is also the room', () => {
    useLiveCaptureStore.setState({ selectedChannel: 0 });
    const html = renderMarkup();
    expect(html).toBe(`<div>${expectedPaneHTML()}</div>`);
    expect(html).toContain('Selected — Track 1 · Measurement source');
    expect(html).not.toContain('eq-pane-empty-hint');
  });

  it('shows a distinct Selected label for a non-room strip', () => {
    useLiveCaptureStore.setState({ selectedChannel: 1 });
    const html = renderMarkup();
    expect(html).toBe(`<div>${expectedPaneHTML()}</div>`);
    expect(html).toContain('Selected — Track 2');
  });

  it('swaps the Room slot to the secondary room mic when active (#460)', () => {
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'active', deviceName: 'Room Mic' },
      secondaryWindows: [{ type: 'window', window: 1, ts: 0, channels: TICK_CHANNELS, masking: [] } as LiveEvent],
      lastMeasurementChannels: [TICK_CHANNELS[0]] as never,
    });
    const html = renderMarkup();
    expect(html).toBe(`<div>${expectedPaneHTML()}</div>`);
    expect(html).toContain('Room — Room Mic');
  });

  it('keeps the board Room slot byte-identical while the secondary source is merely selected but not active', () => {
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'off', deviceName: 'Room Mic' },
      secondaryWindows: [],
      lastMeasurementChannels: null,
    });
    const html = renderMarkup();
    expect(html).toContain('Room — Track 1');
    expect(html).not.toContain('Room — Room Mic');
  });
});
