// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveWorkspace from './LiveWorkspace';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import type { AppSettings } from '../../electron/ipc/api';

// LiveWorkspace renders the <LiveCapturePanel> board island (TD-001 slice 6g,
// #710) — the per-tick meter controller and #live-island visibility wiring it
// also owns run in effects that don't fire under renderToString (no jsdom in
// this harness); that reactivity is exercised by tests/e2e/live-capture.spec.ts
// and live-capture-workspace.spec.ts. This test pins the render contract: the
// board markup is produced on the Live tab and nothing renders off it.

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
const liveTransitionState = require('../live-transition-state.js');

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    splCalibrationOffsetDb: null,
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    trackWorkspace, armState, groupState, rigReconcile, instrumentProfiles,
    liveSetupState, liveAdjustmentsState, dawWorkspaceState, dawPlayheadState,
    dawWaveformState, grading, liveTransitionState,
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  useLiveCaptureStore.setState({
    channelConfig: [{ kind: 'mono', a: 0, b: 1, armed: true }, { kind: 'mono', a: 1, b: 2, armed: true }],
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
    lastLiveChannels: null,
    demoting: false,
  });
  useSettingsStore.setState({ settings: settings() });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({ appMode: 'reportcard', isCapturing: false, liveWindows: [], lastTick: null, lastLiveChannels: null });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

describe('LiveWorkspace', () => {
  it('renders the Session arrangement shell on the Live tab', () => {
    const html = renderToString(createElement(LiveWorkspace));
    expect(html).toContain('daw-shell');
    expect(html).not.toContain('meter-card');
  });

  it('renders nothing off the Live tab — the board island gates itself on appMode', () => {
    useLiveCaptureStore.setState({ appMode: 'reportcard' });
    expect(renderToString(createElement(LiveWorkspace))).toBe('');
  });
});
