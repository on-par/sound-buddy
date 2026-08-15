// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveCapturePanel from './LiveCapturePanel';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import {
  liveMetersHTML,
  type StripConfig,
  type ChannelWindowData,
} from './live-capture-panel';
import { stripViewAt, livePanelView, liveBoardState } from './live-board';

// The pure helper classic-scripts the board's view functions read off window
// — real modules, same convention as live-board.test.ts.
const armState = require('../arm-state.js');
const groupState = require('../group-state.js');
const instrumentProfiles = require('../instrument-profiles.js');
const rigReconcile = require('../rig-reconcile.js');
const liveSetupState = require('../live-setup-state.js');
const trackWorkspace = require('../track-workspace.js');
const liveAdjustmentsState = require('../live-adjustments-state.js');
const dawWorkspaceState = require('../daw-workspace-state.js');
const dawWaveformState = require('../daw-waveform-state.js');
const dawPlayheadState = require('../daw-playhead-state.js');

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as unknown as Storage;
}

const CONFIG: StripConfig[] = [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }];

function tickChannels(): ChannelWindowData[] {
  return [
    { index: 0, name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400, rolloff: 8000,
      bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
    { index: 1, name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300, rolloff: 5000,
      bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
  ];
}

beforeEach(() => {
  const storage = makeStorage();
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
    armState,
    groupState,
    instrumentProfiles,
    rigReconcile,
    liveSetupState,
    trackWorkspace,
    liveAdjustmentsState,
    dawWorkspaceState,
    dawWaveformState,
    dawPlayheadState,
  };
  useSettingsStore.setState({ settings: {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, measurementDeviceName: '',
    gradingProfile: 'casual', consoleNetworkConsentGranted: false, soundcheckBuses: [],
  }, settingsError: null });
  useLiveCaptureStore.setState({
    appMode: 'live',
    isCapturing: false,
    liveMode: 'monitor',
    channelConfig: CONFIG,
    channelGroups: [],
    selectedChannel: null,
    measurementSource: null,
    selectedDevice: '',
    devices: [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }],
    lastTick: null,
    lastLiveChannels: null,
    liveWindows: [],
    lapCoaching: null,
    focusedInputIndex: null,
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
    lastMeasurementChannels: null,
    boardShapeVersion: 0,
  });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useSettingsStore.setState({ settings: null, settingsError: null });
  useLiveCaptureStore.setState({
    appMode: 'reportcard',
    isCapturing: false,
    liveMode: 'monitor',
    channelConfig: [],
    channelGroups: [],
    selectedChannel: null,
    measurementSource: null,
    selectedDevice: '',
    devices: [],
    lastTick: null,
    lastLiveChannels: null,
    liveWindows: [],
    lapCoaching: null,
    focusedInputIndex: null,
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
    lastMeasurementChannels: null,
    boardShapeVersion: 0,
  });
});

function renderMarkup(): string {
  return renderToString(createElement(LiveCapturePanel));
}

describe('LiveCapturePanel', () => {
  it('renders null off the live tab', () => {
    useLiveCaptureStore.setState({ appMode: 'reportcard' });
    expect(renderMarkup()).toBe('');
  });

  it('renders the guided first-use hero for an empty config', () => {
    useLiveCaptureStore.setState({ channelConfig: [] });
    const html = renderMarkup();
    expect(html).toContain('live-setup-hero');
    expect(html).toContain('Set up your live check');
    expect(html).toContain('Add your first track');
    expect(html).not.toContain('sb-live-meters');
  });

  it('renders the toolbar + idle meter card for a seeded config', () => {
    const html = renderMarkup();
    expect(html).toContain('id="live-ws-add"');
    expect(html).toContain('id="live-ws-cap">2 / 8 used</span>');
    expect(html).toContain('class="meter-card sb-live-meters idle"');
    expect(html).toContain('>Idle<');
  });

  it('renders the liveMetersHTML markup byte-identically for a tick snapshot', () => {
    const channels = tickChannels();
    useLiveCaptureStore.setState({
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels } as never,
      lastLiveChannels: channels,
      boardShapeVersion: 1,
    });
    const boardState = liveBoardState();
    const expectedMeters = liveMetersHTML(
      channels,
      channels.map((c, i) => stripViewAt(CONFIG, c, i, boardState)),
      livePanelView(boardState),
    );
    const html = renderMarkup();
    expect(html).toContain(expectedMeters);
    expect(html).toContain('class="meter-card sb-live-meters"');
    expect(html).toContain('Vocals');
    expect(html).toContain('Band');
  });

  it('appends the live adjustments panel when the experiment is enabled', () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings!,
        liveAdjustmentsEnabled: true,
      },
    });
    const html = renderMarkup();
    expect(html).toContain('class="live-adjustments-panel"');
    expect(html).toContain('Live adjustments');
  });

  it('omits the adjustments panel when the experiment is disabled', () => {
    const html = renderMarkup();
    expect(html).not.toContain('live-adjustments-panel');
  });

  it('renders the DAW shell branch when the experimental toggle is on', () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings!,
        dawWorkspaceEnabled: true,
      },
    });
    const html = renderMarkup();
    expect(html).toContain('class="daw-shell"');
    expect(html).toContain('daw-transport');
    expect(html).toContain('daw-mix-lane');
    expect(html).toContain('daw-lane-name">Overall mix</span>');
    expect(html).toContain('data-ch="0"');
    expect(html).not.toContain('sb-live-meters');
  });

  it('shows the first-use banner for a seeded config while the guide is incomplete', () => {
    const html = renderMarkup();
    expect(html).toContain('id="live-setup-skip"');
    expect(html).toContain('Getting set up');
  });

  it('hides the first-use banner once the guide has been dismissed', () => {
    liveSetupState.markSetupComplete((globalThis as { window: { localStorage: Storage } }).window.localStorage);
    const html = renderMarkup();
    expect(html).not.toContain('live-setup-skip');
  });

  it('hides the first-use banner while capturing', () => {
    useLiveCaptureStore.setState({ isCapturing: true });
    const html = renderMarkup();
    expect(html).not.toContain('live-setup-skip');
  });
});
