// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveWorkspace from './LiveWorkspace';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import type { StripConfig } from './live-capture-panel';

// LiveWorkspace renders <LiveCapturePanel /> into #live-island (slice 6g,
// #710), replacing the old render-null + window.liveWorkspaceRuntime handoff.
// The panel subscribes ONLY to discrete store fields; per-tick values reach
// the DOM only through LiveWorkspace's live-meter-controller patch appliers
// (ADR-0005). renderToString pins the board markup + the never-subscribe-to-
// lastTick contract; the effects (controller mount, island visibility, DAW
// repaint) don't run under renderToString — they're exercised by
// tests/e2e/live-capture.spec.ts + live-capture-workspace.spec.ts.

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

const capturePanelSrc = fs.readFileSync(fileURLToPath(new URL('./LiveCapturePanel.tsx', import.meta.url)), 'utf8');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
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
    channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }] as StripConfig[],
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
    channelConfig: [],
    lastTick: null,
    lastLiveChannels: null,
    boardShapeVersion: 0,
  });
});

function renderMarkup(): string {
  return renderToString(createElement(LiveWorkspace));
}

describe('LiveWorkspace', () => {
  it('renders the mounted board into #live-island for the live tab', () => {
    const html = renderMarkup();
    expect(html).toContain('id="live-ws-add"');
    expect(html).toContain('class="meter-card sb-live-meters idle"');
    expect(html).toContain('id="live-ws-cap">2 / 8 used</span>');
  });

  it('renders nothing off the live tab', () => {
    useLiveCaptureStore.setState({ appMode: 'reportcard' });
    expect(renderMarkup()).toBe('');
  });

  it('never subscribes to per-tick fields — lastTick enters only as the !null boolean (ADR-0005)', () => {
    // The subscription selector must gate on the boolean, never select the
    // per-tick array/object fields themselves — those flow to the DOM only
    // through the rAF patch appliers.
    expect(capturePanelSrc).toContain('hasTick: s.lastTick !== null');
    expect(capturePanelSrc).not.toContain('lastTick: s.lastTick');
    expect(capturePanelSrc).not.toContain('lastLiveChannels: s.lastLiveChannels');
    expect(capturePanelSrc).not.toContain('lastMeasurementChannels: s.lastMeasurementChannels');
    expect(capturePanelSrc).not.toContain('liveWindows: s.liveWindows');
  });
});
