// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    splCalibrationOffsetDb: null, lastAppMode: '',
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

describe('applyLiveTick patches track-head level fills (#1411)', () => {
  // applyLiveTick is DOM-patching code under a /* c8 ignore */ block with no
  // jsdom in this harness — gated structurally, like live-adjustments-gate.test.ts
  // does elsewhere. The behavior itself is covered by the patchTrackHeadLevels /
  // dawTrackLevelPatchView unit tests in live-workspace-view.test.ts.
  it('calls patchTrackHeadLevels with dawTrackLevelPatchView(state)', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./LiveWorkspace.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('patchTrackHeadLevels(');
    expect(src).toContain('dawTrackLevelPatchView(state)');
  });
});

describe('applyLiveTick caches per-track DOM lookups (#1413)', () => {
  // Same DOM-patching/no-jsdom constraint as above — createTrackNodeCache's
  // invalidation logic is exhaustively unit-tested in live-workspace-view.test.ts
  // against plain-object fakes; this test only pins that applyLiveTick wires it in.
  it('scopes the shell through the module-level track node cache, keyed on boardShapeVersion, before querying track nodes', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./LiveWorkspace.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('createTrackNodeCache<HTMLElement>()');
    expect(src).toContain('trackNodeCache.scope(shell, lc.boardShapeVersion)');
    expect(src).toContain('cachedShell.querySelector(`.daw-track-head[data-ch="${row.index}"] .daw-track-head-name`)');
    expect(src).toContain('patchTrackHeadLevels(cachedShell, dawTrackLevelPatchView(state))');
  });
});

describe('applyLiveTick skips EQ-pane patch work while the pane is hidden (#1413)', () => {
  // Same DOM-patching/no-jsdom constraint as above — eqPaneTickPatchEnabled's
  // visibility rule is exhaustively unit-tested in live-workspace-view.test.ts
  // against plain-object fakes; this test only pins that applyLiveTick gates on it.
  it('gates the EQ-pane patch-plan work on eqPaneTickPatchEnabled', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./LiveWorkspace.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('if (pane && eqPaneTickPatchEnabled(pane))');
  });
});
