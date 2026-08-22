// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveCapturePanel, {
  ensureSessionRouting,
  normalizeGroupName,
  routeHeaderChannelAction,
  type HeaderChannelActions,
} from './LiveCapturePanel';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSoundcheckStore } from './stores/soundcheckStore';
import { useRouteStore } from './stores/routeStore';
import type { LiveDevice, ChannelWindowData } from './live-capture-panel';
import type { AppSettings } from '../../electron/ipc/api';

// The pure helper classic-scripts the board reads off `window` — real modules
// (not hand-rolled stubs), same convention as liveCaptureStore.test.ts.
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

const TICK_CHANNELS: ChannelWindowData[] = [
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
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    ...overrides,
  };
}

let storage: { getItem: (k: string) => string | null; setItem: () => void };

function renderMarkup(): string {
  return renderToString(createElement(LiveCapturePanel));
}

beforeEach(() => {
  storage = { getItem: () => null, setItem: () => {} };
  (globalThis as { window?: unknown }).window = {
    trackWorkspace, groupState, armState, rigReconcile, instrumentProfiles,
    liveSetupState, liveAdjustmentsState, dawWorkspaceState, dawPlayheadState,
    dawWaveformState, grading, liveTransitionState,
    localStorage: storage,
    dawShellRuntime: {
      renderPlayhead: () => {},
      renderWaveform: () => {},
      playheadElapsedMs: () => 0,
    },
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
  useSoundcheckStore.setState({
    recordedSessions: [], recordedSessionsLoaded: false, sessionDir: null,
    manifest: null, statusMessage: null, playing: false, looping: false, lastElapsedTick: null,
  });
  useRouteStore.setState({ routesBySession: {} });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({ appMode: 'reportcard', isCapturing: false, liveWindows: [], lastTick: null, lastLiveChannels: null });
  useSettingsStore.setState({ settings: null, settingsError: null });
  useSoundcheckStore.setState({
    recordedSessions: [], recordedSessionsLoaded: false, sessionDir: null,
    manifest: null, statusMessage: null, playing: false, looping: false, lastElapsedTick: null,
  });
  useRouteStore.setState({ routesBySession: {} });
});

describe('LiveCapturePanel', () => {
  it('synchronizes master mixdown when switching sessions and restores it when returning', () => {
    const sessionA = {
      tracks: [],
      savedBuses: [],
      masterMixdown: false,
    };
    const sessionB = {
      tracks: [],
      savedBuses: [],
      masterMixdown: false,
    };

    ensureSessionRouting('session-a', sessionA, useRouteStore.getState(), useSoundcheckStore.getState());
    useRouteStore.getState().setMasterMixdown('session-a', true);
    ensureSessionRouting('session-b', sessionB, useRouteStore.getState(), useSoundcheckStore.getState());
    expect(useSoundcheckStore.getState().master).toBe(false);

    ensureSessionRouting('session-a', sessionA, useRouteStore.getState(), useSoundcheckStore.getState());
    expect(useSoundcheckStore.getState().master).toBe(true);
  });

  it('renders nothing off the Live tab', () => {
    useLiveCaptureStore.setState({ appMode: 'reportcard' });
    expect(renderMarkup()).toBe('');
  });

  it('renders the idle board: toolbar, cap, and the idle meter card', () => {
    const html = renderMarkup();
    expect(html).toContain('id="live-ws-add"');
    expect(html).toContain('2 / 8 used');
    expect(html).toContain('meter-card sb-live-meters idle');
    expect(html).toContain('>1 / 2 armed</span>');
    expect(html).toContain('Idle');
  });

  it('renders the running card from the latest tick once capturing with a lastTick', () => {
    useLiveCaptureStore.setState({
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels: TICK_CHANNELS },
      lastLiveChannels: TICK_CHANNELS,
    });
    const html = renderMarkup();
    expect(html).toContain('meter-card sb-live-meters">');
    expect(html).not.toContain('meter-card sb-live-meters idle');
    expect(html).toContain('>Vocals</span>');
    expect(html).toContain('>Band</span>');
  });

  it('keeps the running board while demoting a record stop back to monitoring (#847)', () => {
    useLiveCaptureStore.setState({
      isCapturing: false, // stopCapture() already flipped it
      demoting: true, // …but the monitor session is about to resume
      liveMode: 'record',
      lastTick: { type: 'meter', ts: 0, channels: TICK_CHANNELS },
      lastLiveChannels: TICK_CHANNELS,
    });
    const html = renderMarkup();
    expect(html).toContain('meter-card sb-live-meters">');
    expect(html).not.toContain('meter-card sb-live-meters idle'); // no transient idle card
    expect(html).toContain('id="live-ws-disarm-all" disabled'); // capture-locked controls stay locked
    expect(html).toContain('id="live-ws-add" disabled');
  });

  it('renders the guided first-use hero at zero tracks (no toolbar, CTA present)', () => {
    useLiveCaptureStore.setState({ channelConfig: [] });
    const html = renderMarkup();
    expect(html).toContain('live-setup-hero');
    expect(html).toContain('Set up your live check');
    expect(html).toContain('id="live-ws-add"');
    expect(html).toContain('Add your first track');
    expect(html).not.toContain('live-ws-arm-count');
  });

  it('marks the selected strip via stripViewAt when a channel is selected (#668)', () => {
    useLiveCaptureStore.setState({ selectedChannel: 1 });
    const html = renderMarkup();
    expect(html).toMatch(/class="live-ch[^"]*\bselected\b[^"]*" data-ch="1"/);
    expect(html).toMatch(/data-ch="1"[^>]*aria-current="true"/);
  });

  it('renders the first-use banner above the toolbar until setup is complete', () => {
    const html = renderMarkup();
    expect(html).toContain('live-setup-banner');
    expect(html).toContain('Getting set up');
    expect(html).toContain('id="live-setup-skip"');
  });

  it('omits the banner once setup is marked complete', () => {
    storage.getItem = (k: string) => (k === liveSetupState.KEY ? '1' : null);
    const html = renderMarkup();
    expect(html).not.toContain('live-setup-banner');
  });

  it('renders the DAW shell instead of the meter board when the toggle is on', () => {
    useSettingsStore.setState({ settings: settings({ dawWorkspaceEnabled: true }) });
    const html = renderMarkup();
    expect(html).toContain('daw-shell');
    expect(html).toContain('daw-mix-lane');
    expect(html).toContain('daw-track-head-arm');
    expect(html).not.toContain('meter-card');
  });

  it('binds the DAW toolbar picker to the shared soundcheck selection state', () => {
    useSettingsStore.setState({ settings: settings({ dawWorkspaceEnabled: true }) });
    useSoundcheckStore.setState({
      recordedSessions: [{ sessionDir: '/recordings/sunday', name: 'Discovered label' }],
      recordedSessionsLoaded: true,
      sessionDir: '/recordings/sunday',
      manifest: { name: 'Sunday service', tracks: [{ kind: 'mono' }] },
      statusMessage: 'Could not read session.json.',
    });

    const html = renderMarkup();
    expect(html).toContain('daw-session-picker-select');
    expect(html).toContain('Sunday service');
    expect(html).toContain('open session folder…');
    expect(html).toContain('Could not read session.json.');
  });

  it('renders the Session toolbar transport cluster from the loaded take and discrete playback state', () => {
    useSettingsStore.setState({ settings: settings({ dawWorkspaceEnabled: true }) });
    useSoundcheckStore.setState({ manifest: { tracks: [{ kind: 'mono' }] }, playing: false });
    expect(renderMarkup()).toContain('id="daw-session-play"');
    expect(renderMarkup()).toContain('id="daw-session-loop"');
    expect(renderMarkup()).toContain('id="daw-session-return"');

    useSoundcheckStore.setState({ playing: true });
    const html = renderMarkup();
    expect(html).toContain('id="daw-session-stop"');
    expect(html).toContain('id="daw-session-play" aria-label="Play recorded session" disabled');

    useSoundcheckStore.setState({ looping: true });
    expect(renderMarkup()).toContain('id="daw-session-loop" aria-label="Loop recorded session playback" aria-pressed="true"');
  });

  it('composes shared Session routing state into the DAW drawer', () => {
    useSettingsStore.setState({ settings: settings({ dawWorkspaceEnabled: true }) });
    useSoundcheckStore.setState({
      sessionDir: '/recordings/sunday',
      manifest: { tracks: [{ kind: 'mono' }, { kind: 'mono' }] },
      routes: [[2], [3]],
      deviceChannels: 4,
    });
    useRouteStore.getState().ensureSession('/recordings/sunday', {
      tracks: [
        { inputChannels: [1], outputChannels: [2] },
        { inputChannels: [0], outputChannels: [3] },
      ],
      savedBuses: [{ id: 'bus-1', name: 'Lead Vocal', pattern: 'lead', outputChannel: 2 }],
      masterMixdown: true,
    });

    const html = renderMarkup();

    expect(html).toContain('class="daw-routing-source" data-routing-kind="input" data-routing-track-index="0"');
    expect(html).toContain('<option value="1" selected>Ch 2</option>');
    expect(html).toContain('data-routing-kind="output" data-routing-track-index="0" data-routing-channels="2"');
    expect(html).toContain('data-routing-channels="2" aria-label="Track 1 output Ch 3" aria-pressed="true"');
    expect(html).toContain('Lead Vocal');
    expect(html).toContain('lead');
    expect(html).toContain('class="daw-routing-master-mixdown"');
    expect(html).toContain('aria-label="Force stereo master mixdown" checked');
  });

  it('renders cached session takes only in their provenance-matched lanes and replaces generation copy when ready', () => {
    useSettingsStore.setState({ settings: settings({ dawWorkspaceEnabled: true }) });
    useSoundcheckStore.setState({
      manifest: { tracks: [{ kind: 'mono', sourceChannels: [1] }] },
      peaks: null,
      peaksStatus: 'generating',
    });
    expect(renderMarkup()).toContain('Generating waveforms…');

    useSoundcheckStore.setState({
      peaksStatus: 'ready',
      peaks: { bucketsPerSecond: 2, tracks: [{ index: 0, label: 'Band', kind: 'mono', bucketCount: 1, data: btoa(String.fromCharCode(0, 255)) }] },
    });
    const html = renderMarkup();
    expect(html).not.toContain('Generating waveforms…');
    expect((html.match(/data-session-track-index/g) ?? [])).toHaveLength(1);
    expect(html.indexOf('data-session-track-index="0"')).toBeGreaterThan(html.indexOf('daw-channel-lane" data-ch="1"'));
  });

  it('renders the live-adjustments panel when the flag is on, and omits it when off', () => {
    useSettingsStore.setState({ settings: settings({ liveAdjustmentsEnabled: true }) });
    expect(renderMarkup()).toContain('live-adjustments-panel');
    useSettingsStore.setState({ settings: settings() });
    expect(renderMarkup()).not.toContain('live-adjustments-panel');
  });

  it('never renders the in-tab capture controls (#757, #517)', () => {
    const html = renderMarkup();
    expect(html).not.toContain('id="live-mode"');
    expect(html).not.toContain('id="live-start-btn"');
    expect(html).not.toContain('id="live-stop-btn"');
  });
});

describe('routeHeaderChannelAction', () => {
  function actions(): HeaderChannelActions {
    return {
      toggleArm: vi.fn(), hideArmHint: vi.fn(), removeStrip: vi.fn(),
      toggleChannelMute: vi.fn(), toggleChannelSolo: vi.fn(),
      isCapturing: false, liveMode: 'monitor',
    };
  }

  it('arms the supplied channel and clears the arm hint', () => {
    const a = actions();
    routeHeaderChannelAction('arm', 3, a);
    expect(a.toggleArm).toHaveBeenCalledWith(3);
    expect(a.hideArmHint).toHaveBeenCalledOnce();
  });

  it('does not change an arm or clear its hint during an active recording (#1058)', () => {
    const a = actions();
    a.isCapturing = true;
    a.liveMode = 'record';

    routeHeaderChannelAction('arm', 3, a);

    expect(a.toggleArm).not.toHaveBeenCalled();
    expect(a.hideArmHint).not.toHaveBeenCalled();
  });

  it('removes the supplied channel', () => {
    const a = actions(); routeHeaderChannelAction('remove', 4, a);
    expect(a.removeStrip).toHaveBeenCalledWith(4);
  });

  it('routes mute only to its matching reducer', () => {
    const a = actions(); routeHeaderChannelAction('mute', 1, a);
    expect(a.toggleChannelMute).toHaveBeenCalledWith(1);
    expect(a.toggleChannelSolo).not.toHaveBeenCalled();
    expect(a.toggleArm).not.toHaveBeenCalled();
    expect(a.removeStrip).not.toHaveBeenCalled();
    expect(a.hideArmHint).not.toHaveBeenCalled();
  });

  it('routes solo only to its matching reducer', () => {
    const a = actions(); routeHeaderChannelAction('solo', 2, a);
    expect(a.toggleChannelSolo).toHaveBeenCalledWith(2);
    expect(a.toggleChannelMute).not.toHaveBeenCalled();
    expect(a.toggleArm).not.toHaveBeenCalled();
    expect(a.removeStrip).not.toHaveBeenCalled();
    expect(a.hideArmHint).not.toHaveBeenCalled();
  });
});

describe('normalizeGroupName (TD-001 slice 6h, #711)', () => {
  it('trims a dialog-entered group name', () => {
    expect(normalizeGroupName('  Drums  ')).toBe('Drums');
  });

  it('caps the name at MAX_LABEL_LEN (40)', () => {
    expect(normalizeGroupName('a'.repeat(60))).toBe('a'.repeat(40));
  });

  it('returns null for an empty or whitespace-only name', () => {
    expect(normalizeGroupName('')).toBeNull();
    expect(normalizeGroupName('   ')).toBeNull();
  });

  it('returns null for non-string dialog results (cancel/confirm-mode)', () => {
    expect(normalizeGroupName(null)).toBeNull();
    expect(normalizeGroupName(true)).toBeNull();
    expect(normalizeGroupName(false)).toBeNull();
  });
});
