// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveAdjustmentsPanel from './LiveAdjustmentsPanel';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import type { LiveDevice } from './live-capture-panel';
import type { AppSettings } from '../../electron/ipc/api';

// LiveAdjustmentsPanel (#1411) — the ONLY Live-tab component that subscribes
// to liveWindows/lapCoaching, split out of LiveCapturePanel so the DAW board
// shell stops rebuilding at window-tick rate. Same window/store beforeEach
// convention as LiveCapturePanel.test.ts.

const armState = require('../arm-state.js');
const groupState = require('../group-state.js');
const rigReconcile = require('../rig-reconcile.js');
const trackWorkspace = require('../track-workspace.js');
const instrumentProfiles = require('../instrument-profiles.js');
const liveSetupState = require('../live-setup-state.js');
const liveAdjustmentsState = require('../live-adjustments-state.js');
const dawWorkspaceState = require('../daw-workspace-state.js');
const dawPlayheadState = require('../daw-playhead-state.js');
const dawWaveformState = require('../daw-waveform-state.js');
const grading = require('../grading.js');
const liveTransitionState = require('../live-transition-state.js');

const DEVICES: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 },
];

const CONFIG = [
  { kind: 'mono' as const, a: 0, b: 1, armed: true },
  { kind: 'mono' as const, a: 1, b: 2, armed: false },
];

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    splCalibrationOffsetDb: null, lastAppMode: '',
    ...overrides,
  };
}

function renderMarkup(): string {
  return renderToString(createElement(LiveAdjustmentsPanel));
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    trackWorkspace, groupState, armState, rigReconcile, instrumentProfiles,
    liveSetupState, liveAdjustmentsState, dawWorkspaceState, dawPlayheadState,
    dawWaveformState, grading, liveTransitionState,
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  useLiveCaptureStore.setState({
    channelConfig: CONFIG,
    channelGroups: [],
    devices: DEVICES,
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

describe('LiveAdjustmentsPanel', () => {
  it('renders null (empty markup) off the Live tab', () => {
    useLiveCaptureStore.setState({ appMode: 'reportcard' });
    expect(renderMarkup()).toBe('');
  });

  it('renders an empty wrapper when the liveAdjustments flag is off', () => {
    useSettingsStore.setState({ settings: settings({ liveAdjustmentsEnabled: false }) });
    const html = renderMarkup();
    expect(html).toContain('live-adjustments-root');
    expect(html).not.toContain('live-adjustments-panel');
  });

  it('renders the panel when the flag is on', () => {
    useSettingsStore.setState({ settings: settings({ liveAdjustmentsEnabled: true }) });
    expect(renderMarkup()).toContain('live-adjustments-panel');
  });

  it('renders no board markup — the panel is independent of the board shell (AC2)', () => {
    useSettingsStore.setState({ settings: settings({ liveAdjustmentsEnabled: true }) });
    expect(renderMarkup()).not.toContain('daw-shell');
  });

  it('re-derives from the newest liveWindows buffer', () => {
    useSettingsStore.setState({ settings: settings({ liveAdjustmentsEnabled: true }) });
    const waiting = renderMarkup();
    expect(waiting).toContain('Listening… collecting live analysis data.');

    // MIN_WINDOWS (3) usable windows flips the mix-candidates body out of the
    // waiting copy — bands values are flat/neutral so the concrete outcome is
    // the steady-state copy, not a specific candidate, but either way it must
    // no longer be the waiting placeholder (proves re-derivation off the
    // newest buffer, not a stale render).
    useLiveCaptureStore.setState({
      liveWindows: Array.from({ length: 3 }, (_, i) => ({
        type: 'window' as const,
        window: i,
        ts: i,
        masking: [],
        channels: [
          {
            index: 0, name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400, rolloff: 0,
            bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 },
          },
        ],
      })),
    });
    const filled = renderMarkup();
    expect(filled).not.toBe(waiting);
    expect(filled).not.toContain('Listening… collecting live analysis data.');
  });
});
