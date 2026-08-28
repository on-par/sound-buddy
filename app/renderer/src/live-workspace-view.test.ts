// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  stripViewAt,
  livePanelView,
  lapFocusView,
  lapObservationContext,
  currentEqPaneChannels,
  liveWorkspaceToolbarHTML,
  liveSetupStepsView,
  liveSetupStepsHTML,
  addTrackDisabled,
  dawShellHTML,
  dawTrackHeaderHTML,
  dawShellPatchView,
  dawTrackRows,
  dawTrackListEntries,
  dawStatusLineView,
  liveAdjustmentsPanelHTML,
  statsRowView,
  liveStatsRowView,
  eqPaneLevelTilesView,
  selectedEqPaneLevelTilesView,
  boardRunning,
  liveWorkspaceViewState,
  type LiveWorkspaceViewState,
} from './live-workspace-view';
import { sessionTabSessionPickerView } from './session-tab-session-picker';
import { levelPercent, type LiveDevice, type StripConfig, type ChannelGroup, type LiveEvent, type LiveMeterChannel } from './live-capture-panel';
import type { AppSettings } from '../../electron/ipc/api';
import { dawTimelineX, dawRulerTicks, dawLaneGridlines, DAW_TIMELINE_SPAN_SECS, DAW_TIMELINE_ORIGIN_PX } from './daw-shell-runtime';
import type { SessionTabWaveformView } from './session-tab-waveforms';
import { sessionTabPlaybackView } from './session-tab-playback';

// The pure helper classic-scripts the view module reads off `window` — real
// modules (not hand-rolled stubs), same convention as
// liveCaptureStore.test.ts / arm-state.test.ts.
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

function countClassToken(html: string, token: string): number {
  return html.match(new RegExp(`<div class="[^"]*\\b${token}\\b`, 'g'))?.length ?? 0;
}

const DEVICES: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 },
  { index: 1, name: 'Built-in Microphone', channels: 2, default_sr: 44100 },
];

const CONFIG: StripConfig[] = [
  { kind: 'mono', a: 0, b: 1, armed: true },
  { kind: 'mono', a: 1, b: 2, armed: false },
];

const GROUPS: ChannelGroup[] = [{ name: 'Drums', members: [0], collapsed: true }];

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    ...overrides,
  };
}

const TICK_CHANNELS: LiveMeterChannel[] = [
  { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
    bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
  { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
    bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
];

function makeState(overrides: Partial<LiveWorkspaceViewState> = {}): LiveWorkspaceViewState {
  return {
    channelConfig: CONFIG,
    channelGroups: GROUPS,
    devices: DEVICES,
    selectedDevice: '',
    isCapturing: false,
    liveMode: 'monitor',
    appMode: 'live',
    selectedChannel: null,
    measurementSource: null,
    focusedInputIndex: null,
    mutedChannels: {},
    soloedChannels: {},
    lastTick: null,
    lastLiveChannels: null,
    liveWindows: [],
    settings: settings(),
    lapCoaching: null,
    playheadElapsedMs: 0,
    ...overrides,
    sessionPicker: overrides.sessionPicker ?? null,
    sessionWaveforms: overrides.sessionWaveforms ?? null,
    sessionPlayback: overrides.sessionPlayback ?? null,
    capturePhase: overrides.capturePhase ?? 'idle',
    sessionRoutingDrawerOpen: overrides.sessionRoutingDrawerOpen ?? false,
  };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    trackWorkspace, groupState, armState, rigReconcile, instrumentProfiles,
    liveSetupState, liveAdjustmentsState, dawWorkspaceState, dawPlayheadState,
    dawWaveformState, grading,
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('boardRunning (#847)', () => {
  it('returns true when isCapturing is true and demoting false', () => {
    expect(boardRunning({ isCapturing: true, demoting: false })).toBe(true);
  });

  it('returns true when isCapturing is false and demoting true (holds the board live across the stop IPC)', () => {
    expect(boardRunning({ isCapturing: false, demoting: true })).toBe(true);
  });

  it('returns false when both are false', () => {
    expect(boardRunning({ isCapturing: false, demoting: false })).toBe(false);
  });
});

describe('Session take clips (#1072)', () => {
  const sessionWaveforms: SessionTabWaveformView = {
    generating: false,
    clips: [{ trackIndex: 3, stripIndex: 1, leftPx: dawTimelineX(0), widthPx: 16, pairs: [], bucketsPerSecond: 2 }],
  };

  it('threads the discrete view into one mapped lane and fingerprints its geometry', () => {
    const state = makeState({ sessionWaveforms });
    const rows = dawTrackRows(state);
    const html = dawShellHTML(state);

    expect(rows[0].takeClip).toBeNull();
    expect(rows[1].takeClip).toEqual(sessionWaveforms.clips[0]);
    expect((html.match(/data-session-track-index/g) ?? [])).toHaveLength(1);
    expect(html.indexOf('data-session-track-index="3"')).toBeGreaterThan(html.indexOf('daw-channel-lane" data-ch="1"'));
    expect(html).toContain(`style="left:${dawTimelineX(0)}px;width:16px"`);
    expect(dawShellPatchView(state).laneSignature).toContain(`${dawTimelineX(0)}\u000116`);
  });

  it('shows only the generation hint while a loaded session is generating', () => {
    const html = dawShellHTML(makeState({ sessionWaveforms: { generating: true, clips: [] } }));
    expect(html).toContain('Generating waveforms…');
    expect(html).not.toContain('daw-take-clip');
  });
});

describe('Session toolbar playback (#1073)', () => {
  it('includes the compact Session transport beside the session picker', () => {
    const html = dawShellHTML(makeState({
      sessionPlayback: sessionTabPlaybackView({ tracks: [{ kind: 'mono' }] }, false, true),
    }));

    expect(html).toContain('id="daw-session-play"');
    expect(html).toContain('id="daw-session-stop"');
    expect(html).toContain('id="daw-session-loop"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('id="daw-session-return"');
    expect(html).toContain('daw-session-playback-btn');
  });

  it('keeps default callers free of Session playback markup', () => {
    expect(liveWorkspaceViewState({ ...makeState(), demoting: false }, settings()).sessionPlayback).toBeNull();
    expect(dawShellHTML(makeState())).not.toContain('daw-session-playback-btn');
  });
});

describe('Session routing drawer shell (#1089)', () => {
  it('places supplied routing content after the drawer heading', () => {
    const html = dawShellHTML(makeState({ sessionRoutingDrawerOpen: true }), '<div id="routing-controls">Controls</div>');

    const sectionStart = html.indexOf('<section class="daw-session-routing-drawer"');
    const heading = html.indexOf('<h2 class="daw-session-routing-title">Routing</h2>');
    const controls = html.indexOf('<div id="routing-controls">Controls</div>');
    const sectionEnd = html.indexOf('</section>', sectionStart);
    expect(sectionStart).toBeLessThan(heading);
    expect(heading).toBeLessThan(controls);
    expect(controls).toBeLessThan(sectionEnd);
  });

  it('renders an expanded Routing toggle and visible drawer after the arrangement and status line', () => {
    const html = dawShellHTML(makeState({ sessionRoutingDrawerOpen: true }));

    expect(html).toContain('id="daw-session-routing-toggle"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="daw-session-routing-drawer"');
    expect(html).toContain('<section class="daw-session-routing-drawer" id="daw-session-routing-drawer" aria-label="Routing">');
    expect(html).not.toContain('daw-session-routing-drawer" id="daw-session-routing-drawer" aria-label="Routing" hidden');
    expect(html.indexOf('<div class="daw-arrangement">')).toBeLessThan(html.indexOf('<section class="daw-session-routing-drawer"'));
    expect(html.indexOf('<div class="daw-status-line">')).toBeLessThan(html.indexOf('<section class="daw-session-routing-drawer"'));
  });

  it('keeps the Routing drawer collapsed for default callers', () => {
    const html = dawShellHTML(makeState());

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<section class="daw-session-routing-drawer" id="daw-session-routing-drawer" aria-label="Routing" hidden>');
  });
});

describe('stripViewAt', () => {
  it('marks the strip selected when its index is the selectedChannel', () => {
    const view = stripViewAt(makeState({ selectedChannel: 1 }), 1, TICK_CHANNELS[1]);
    expect(view.selected).toBe(true);
    expect(stripViewAt(makeState({ selectedChannel: 1 }), 0, TICK_CHANNELS[0]).selected).toBe(false);
  });

  it('resolves the display name from the strip label, then the device channel, then "Ch N"', () => {
    const labelled = stripViewAt(makeState({ channelConfig: [{ ...CONFIG[0], label: 'Kick' }] }), 0, TICK_CHANNELS[0]);
    expect(labelled.displayName).toBe('Kick');
    expect(stripViewAt(makeState(), 0, TICK_CHANNELS[0]).displayName).toBe('Vocals');
    expect(stripViewAt(makeState(), 2, {} as LiveMeterChannel).displayName).toBe('Ch 3');
  });

  it('resolves the group index and collapse state', () => {
    const view = stripViewAt(makeState(), 0, TICK_CHANNELS[0]);
    expect(view.groupIndex).toBe(0);
    expect(view.groupCollapsed).toBe(true);
    expect(stripViewAt(makeState(), 1, TICK_CHANNELS[1]).groupIndex).toBe(-1);
    expect(stripViewAt(makeState(), 1, TICK_CHANNELS[1]).groupCollapsed).toBe(false);
  });

  it('reads armed from the strip (default-armed unless explicitly false)', () => {
    expect(stripViewAt(makeState(), 0, TICK_CHANNELS[0]).armed).toBe(true);
    expect(stripViewAt(makeState(), 1, TICK_CHANNELS[1]).armed).toBe(false);
  });

  it('leaves profile derivation to the selected-channel inspector', () => {
    const view = stripViewAt(makeState(), 0, TICK_CHANNELS[0]);
    expect(view).not.toHaveProperty('instrumentProfileId');
    expect(view).not.toHaveProperty('instrumentAuto');
  });
});

describe('livePanelView', () => {
  it('maps device channels, live running, and groups', () => {
    const view = livePanelView(makeState({ selectedDevice: '0', isCapturing: true }));
    expect(view.deviceChannels).toBe(8);
    expect(view.liveRunning).toBe(true);
    expect(view.groups).toBe(GROUPS);
  });

  it('threads liveMode through — the per-strip arm stamp derives from it (#711)', () => {
    expect(livePanelView(makeState({ liveMode: 'record' })).liveMode).toBe('record');
    expect(livePanelView(makeState({ liveMode: 'monitor' })).liveMode).toBe('monitor');
  });

  it('falls back to the default-device channel count', () => {
    expect(livePanelView(makeState()).deviceChannels).toBe(8);
  });
});

describe('lapFocusView', () => {
  it('reports the focused index and every input with its resolved name/profile', () => {
    const view = lapFocusView(makeState({
      focusedInputIndex: 1,
      lastLiveChannels: TICK_CHANNELS,
      channelConfig: [{ ...CONFIG[0], label: 'Kick' }],
    }));
    expect(view.focusedIndex).toBe(1);
    expect(view.inputs).toEqual([
      { index: 0, name: 'Kick', profile: expect.objectContaining({ id: 'kick', label: 'Kick drum' }) },
    ]);
  });
});

describe('lapObservationContext', () => {
  it('resolves the source, focus, label, and validity from state (#614)', () => {
    const ctx = lapObservationContext(makeState({ measurementSource: 1, focusedInputIndex: 0 })) as {
      measurementSource: number;
      focusIndex: number | null;
      label: string | null;
      mixValid: boolean;
      inputValid: boolean;
      clipping: boolean;
    };
    expect(ctx.measurementSource).toBe(1);
    expect(ctx.focusIndex).toBe(0);
    expect(ctx.label).toBe('Track 2');
    expect(ctx.mixValid).toBe(false);
    expect(ctx.inputValid).toBe(false);
    expect(ctx.clipping).toBe(false);
  });

  it('uses channel 0 for a null measurement source and names the strip label', () => {
    const ctx = lapObservationContext(makeState({ channelConfig: [{ ...CONFIG[0], label: 'Kick' }] })) as { label: string };
    expect(ctx.label).toBe('Kick');
  });
});

describe('currentEqPaneChannels', () => {
  it('returns the latest tick channels once any have arrived', () => {
    expect(currentEqPaneChannels(makeState({ lastLiveChannels: TICK_CHANNELS }))).toBe(TICK_CHANNELS);
  });

  it('falls back to all-idle placeholder channels before the first tick', () => {
    const channels = currentEqPaneChannels(makeState());
    expect(channels).toHaveLength(CONFIG.length);
    expect(channels.every((ch) => ch.idle === true)).toBe(true);
    expect(channels.every((ch) => ch.bands.sub_bass === -120)).toBe(true);
  });
});

describe('addTrackDisabled', () => {
  it('disables at the device channel cap', () => {
    const full: StripConfig[] = Array.from({ length: 8 }, (_, i) => ({ kind: 'mono', a: i, b: (i + 1) % 8, armed: true }));
    expect(addTrackDisabled(makeState({ channelConfig: full }))).toBe(true);
  });

  it('disables while a capture is running', () => {
    expect(addTrackDisabled(makeState({ isCapturing: true }))).toBe(true);
  });

  it('enables otherwise', () => {
    expect(addTrackDisabled(makeState())).toBe(false);
  });
});

describe('liveWorkspaceToolbarHTML', () => {
  it('renders Add track, the cap count, and advanced controls once a track exists', () => {
    const html = liveWorkspaceToolbarHTML(makeState());
    expect(html).toContain('id="live-ws-add"');
    expect(html).toContain('id="live-ws-cap"');
    expect(html).toContain('2 / 8 used');
    expect(html).toContain('id="live-ws-arm-count"');
    expect(html).toContain('>1 / 2 armed</span>');
  });

  it('hides the advanced cluster at zero tracks (guided first use)', () => {
    const html = liveWorkspaceToolbarHTML(makeState({ channelConfig: [] }));
    expect(html).not.toContain('live-ws-arm-count');
    expect(html).not.toContain('live-ws-new-group');
    expect(html).toContain('0 / 8 used');
  });

  it('disables Add at the cap and New group while capturing', () => {
    const full: StripConfig[] = Array.from({ length: 8 }, (_, i) => ({ kind: 'mono', a: i, b: (i + 1) % 8, armed: true }));
    const html = liveWorkspaceToolbarHTML(makeState({ channelConfig: full, isCapturing: true }));
    expect(html).toMatch(/id="live-ws-add"[^>]*disabled/);
    expect(html).toMatch(/id="live-ws-new-group"[^>]*disabled/);
  });

  it('disables the arm cluster only while actually recording (#757)', () => {
    const recording = liveWorkspaceToolbarHTML(makeState({ isCapturing: true, liveMode: 'record' }));
    expect(recording).toMatch(/id="live-ws-arm-all"[^>]*disabled/);
    expect(recording).toMatch(/id="live-ws-disarm-all"[^>]*disabled/);
    const monitoring = liveWorkspaceToolbarHTML(makeState({ isCapturing: true, liveMode: 'monitor' }));
    expect(monitoring).not.toMatch(/id="live-ws-arm-all"[^>]*disabled/);
  });
});

describe('liveSetupStepsView / liveSetupStepsHTML', () => {
  it('marks device/track done and activates the first undone step', () => {
    const steps = liveSetupStepsView(makeState());
    expect(steps.map((s) => ({ key: s.key, done: s.done, active: s.active }))).toEqual([
      { key: 'device', done: true, active: false },
      { key: 'track', done: true, active: false },
      { key: 'start', done: false, active: true },
    ]);
  });

  it('labels the final step from liveMode', () => {
    expect(liveSetupStepsView(makeState())[2].label).toBe('Start monitoring');
    expect(liveSetupStepsView(makeState({ liveMode: 'record' }))[2].label).toBe('Start recording');
  });

  it('renders a done check icon, the active hint, and numbered steps', () => {
    const steps = liveSetupStepsView(makeState());
    const html = liveSetupStepsHTML(steps);
    expect(html).toContain('<li class="ls-step done');
    expect(html).toContain('<li class="ls-step active"');
    expect(html).toContain('svg');
    expect(html).toContain('Press the Session Record button when you’re ready.');
    expect(html).toContain('>3</span>');
  });
});


describe('dawShellHTML / dawShellPatchView', () => {
  it('composes the supplied session picker into the DAW toolbar', () => {
    const picker = sessionTabSessionPickerView(
      [{ sessionDir: '/recordings/sunday', name: 'Sunday AM', createdAt: '2026-08-17T10:00:00.000Z' }],
      '/recordings/sunday',
      { name: 'Sunday AM', tracks: [] },
      'Could not read session.json.',
    );
    const html = dawShellHTML(makeState({ sessionPicker: picker }));

    expect(html).toContain('daw-session-picker');
    expect(html).toContain('Sunday AM');
    expect(html).toContain('open session folder…');
    expect(html).toContain('Could not read session.json.');
  });

  it('leaves the picker null for existing view-state callers', () => {
    const state = liveWorkspaceViewState({ ...makeState(), demoting: false }, settings());
    expect(state.sessionPicker).toBeNull();
  });
  it('derives each header row state and RMS level from the shared snapshot', () => {
    const rows = dawTrackRows(makeState({
      mutedChannels: { 0: true }, soloedChannels: { 1: true },
      lastLiveChannels: TICK_CHANNELS,
    }));
    expect(rows).toMatchObject([
      { index: 0, armed: true, muted: true, soloed: false },
      { index: 1, armed: false, muted: false, soloed: true },
    ]);
    expect(rows[0].levelPercent).toBeCloseTo(levelPercent(TICK_CHANNELS[0].rms, false), 10);
    expect(rows[1].levelPercent).toBeCloseTo(levelPercent(TICK_CHANNELS[1].rms, false), 10);
  });

  it('uses a zero header level for missing or idle live channels', () => {
    expect(dawTrackRows(makeState())[0].levelPercent).toBe(0);
    expect(dawTrackRows(makeState({ lastLiveChannels: [{ ...TICK_CHANNELS[0], idle: true }] }))[0].levelPercent).toBe(0);
  });

  it('builds an accessible escaped track header with its initial inline level', () => {
    const html = dawTrackHeaderHTML({ index: 0, name: 'Kick &lt;3', armed: true, armDisabled: false, muted: false, soloed: true, monitorActive: true, levelPercent: 70, takeClip: null });
    expect(html).toMatch(/class="[^"]*\bdaw-track-head-arm\b[^"]*"/);
    expect(html).toContain('aria-label="Disarm track"');
    expect(html).toContain('title="Disarm track"');
    expect(html).not.toContain('>Arm</button>');
    expect(html).toMatch(/class="[^"]*\bdaw-track-head-mute\b[^"]*"/);
    expect(html).toContain('aria-label="Mute track"');
    expect(html).toMatch(/class="[^"]*\bdaw-track-head-mute\b[^"]*" aria-label="Mute track" aria-pressed="false"/);
    expect(html).toMatch(/class="[^"]*\bdaw-track-head-solo\b[^"]*"/);
    expect(html).toContain('aria-label="Unsolo track"');
    expect(html).toMatch(/class="[^"]*\bdaw-track-head-remove\b[^"]*"/);
    expect(html).toContain('aria-label="Remove track"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('style="width:70%"');
    expect(html).toContain('>Kick &lt;3</span>');
  });

  it('renders an overview-only head row with no per-channel setting controls (#849)', () => {
    const html = dawTrackHeaderHTML({ index: 0, name: 'Vox 1', armed: false, armDisabled: false, muted: false, soloed: false, monitorActive: true, levelPercent: 0, takeClip: null });
    expect(html).not.toContain('<select');
    expect(html).not.toContain('daw-track-head-def');
    expect(html).not.toContain('daw-track-head-input');
    expect(html).toContain('daw-track-head-index');
    expect(html).toContain('daw-track-head-name');
    expect(html).toContain('daw-track-head-arm');
    expect(html).toContain('daw-track-head-mute');
    expect(html).toContain('daw-track-head-solo');
    expect(html).toContain('daw-track-head-level');
    expect(html).toContain('daw-track-head-meta');
    expect(html).toContain('daw-track-head-remove');
  });

  it('disables only track-header Arm controls during an active recording (#1058)', () => {
    const armButton = (html: string) => html.match(/<button type="button" class="[^"]*\bdaw-track-head-arm\b[^"]*"[^>]*>/)?.[0];
    const recordingHTML = dawShellHTML(makeState({ isCapturing: true, liveMode: 'record' }));
    const recordingHeads = recordingHTML.slice(
      recordingHTML.indexOf('<div class="daw-track-heads'),
      recordingHTML.indexOf('<div class="daw-timeline">'),
    );
    expect(armButton(recordingHeads)).toContain('disabled');
    expect(armButton(recordingHeads)).toContain('title="Disarm track"');
    expect(recordingHeads.match(/class="[^"]*\bdaw-track-head-arm\b[^"]*"[^>]* disabled/g)).toHaveLength(CONFIG.length);
    expect(recordingHeads).not.toContain('<select');
    expect(armButton(dawShellHTML(makeState({ isCapturing: true, liveMode: 'monitor' })))).not.toContain('disabled');
    expect(armButton(dawShellHTML(makeState({ isCapturing: false, liveMode: 'record' })))).not.toContain('disabled');
  });

  it('keeps header markup byte-identical for equal rows', () => {
    const row = { index: 0, name: 'Kick', armed: true, armDisabled: false, muted: false, soloed: false, monitorActive: true, levelPercent: 0, takeClip: null };
    expect(dawTrackHeaderHTML(row)).toBe(dawTrackHeaderHTML(row));
  });

  it('renders controls once per track but never in the master header', () => {
    const html = dawShellHTML(makeState());
    expect(html.split('daw-track-head-arm').length - 1).toBe(CONFIG.length);
    const master = html.slice(html.indexOf('daw-master-head'));
    expect(master).not.toContain('daw-track-head-arm');
  });

  it('keeps no <select> anywhere in the track-head column (#849)', () => {
    const html = dawShellHTML(makeState());
    const headColumn = html.slice(html.indexOf('<div class="daw-track-heads'), html.indexOf('<div class="daw-timeline">'));
    expect(headColumn).not.toContain('<select');
  });

  it('renders the transport header, ruler, and mix lane', () => {
    const html = dawShellHTML(makeState());
    expect(html).toContain('daw-shell');
    expect(html).toContain('daw-transport');
    expect(html).toContain('daw-ruler');
    expect(html).toContain('daw-mix-lane');
    expect(html).toContain('daw-transport-time');
  });

  it('renders one playhead segment per timeline region while recording and none at the shell level (#1049)', () => {
    const html = dawShellHTML(makeState({ isCapturing: true, liveMode: 'record' }));
    expect(html).toContain('<span class="daw-playhead daw-playhead-ruler"></span>');
    expect(html).toContain('<span class="daw-playhead daw-playhead-lanes"></span>');
    expect(html.split('class="daw-playhead').length - 1).toBe(2);
    expect(html).not.toContain('<div class="daw-playhead"></div>');
  });

  it("the ruler segment is the ruler row's last child, above every tick (#1049)", () => {
    const html = dawShellHTML(makeState({ isCapturing: true, liveMode: 'record' }));
    expect(html.indexOf('daw-playhead-ruler')).toBeGreaterThan(html.lastIndexOf('class="daw-ruler-tick"'));
    expect(html.indexOf('daw-playhead-ruler')).toBeLessThan(html.indexOf('<div class="daw-lane-column">'));
  });

  it("the lane segment is the lane column's last child, above every lane (#1049)", () => {
    const html = dawShellHTML(makeState({ isCapturing: true, liveMode: 'record' }));
    expect(html.indexOf('daw-playhead-lanes')).toBeGreaterThan(html.indexOf('daw-mix-lane'));
    expect(html.indexOf('daw-playhead-lanes')).toBeLessThan(html.indexOf('<div class="daw-status-line">'));
  });

  it('both segments render while recording with zero configured tracks (#1049)', () => {
    const html = dawShellHTML(makeState({ channelConfig: [], isCapturing: true, liveMode: 'record' }));
    expect(html).toContain('<span class="daw-playhead daw-playhead-ruler"></span>');
    expect(html).toContain('<span class="daw-playhead daw-playhead-lanes"></span>');
  });

  it('omits recording playhead and generated waveform canvases while monitoring (#1124)', () => {
    const html = dawShellHTML(makeState({ isCapturing: true, liveMode: 'monitor' }));
    expect(html).toContain('daw-transport-state-monitoring');
    expect(html).not.toContain('daw-playhead');
    expect(html).not.toContain('daw-channel-waveform');
    expect(html).not.toContain('daw-mix-waveform');
    expect(html).toContain('daw-channel-lane');
    expect(html).toContain('daw-lane-grid');
  });

  it('keeps the recording playhead and waveform canvases while recording (#1124)', () => {
    const html = dawShellHTML(makeState({ isCapturing: true, liveMode: 'record' }));
    expect(html).toContain('daw-transport-state-recording');
    expect(html).toContain('daw-playhead');
    expect(html).toContain('daw-channel-waveform');
    expect(html).toContain('daw-mix-waveform');
  });

  it('keeps a timeline playhead for recorded-session playback without live waveform canvases (#1124)', () => {
    const html = dawShellHTML(makeState({
      sessionPlayback: sessionTabPlaybackView({ tracks: [{ kind: 'mono' }] }, false, true),
    }));
    expect(html).toContain('daw-playhead');
    expect(html).not.toContain('daw-channel-waveform');
    expect(html).not.toContain('daw-mix-waveform');
  });

  it('maps one lane per channel config entry with an escaped name', () => {
    const html = dawShellHTML(makeState({ channelConfig: [{ ...CONFIG[0], label: 'Kick <3' }], isCapturing: true, liveMode: 'record' }));
    expect(html).toContain('data-ch="0"');
    expect(html).toContain('>Kick &lt;3</span>');
    expect(html).toContain('daw-channel-waveform');
  });

  it('resolves lane names from the latest tick channels while the shell shows (#39)', () => {
    const html = dawShellHTML(makeState({ lastLiveChannels: TICK_CHANNELS }));
    expect(html).toContain('>Vocals</span>');
  });

  it('renders the empty-state row with no channels', () => {
    expect(dawShellHTML(makeState({ channelConfig: [] }))).toContain('Add your first track');
  });

  it('stamps the transport chip and capture-mode token from live state', () => {
    const html = dawShellHTML(makeState({ isCapturing: true, liveMode: 'record' }));
    expect(html).toContain('daw-transport-state-recording');
    expect(html).toContain('data-capture-mode="recording"');
    expect(dawShellHTML(makeState({ isCapturing: true, liveMode: 'monitor' }))).toContain('daw-transport-state-monitoring');
    expect(dawShellHTML(makeState())).toContain('daw-transport-state-stopped');
  });

  it('renders ruler ticks from the shared timeline geometry (#1032)', () => {
    const html = dawShellHTML(makeState());
    expect(html).toContain('class="daw-ruler-tick"');
    expect(html).toContain(`style="left:${dawTimelineX(0)}px"`);
    expect(html).toContain(`style="left:${dawTimelineX(10)}px"`);
    const occurrences = html.split('class="daw-ruler-tick"').length - 1;
    expect(occurrences).toBe(dawRulerTicks(DAW_TIMELINE_SPAN_SECS).length);
    expect(html).toContain('<div class="daw-ruler">');
  });

  it('renders lane gridlines from the shared timeline geometry (#1033)', () => {
    const state = makeState();
    const html = dawShellHTML(state);
    expect(html).toContain('class="daw-lane-grid"');
    expect(html).toContain('class="daw-gridline major"');
    expect(html).toContain(`<span class="daw-gridline" style="left:${dawTimelineX(5)}px"></span>`);
    expect(html).toContain(`<span class="daw-gridline major" style="left:${dawTimelineX(10)}px"></span>`);
    const perLane = dawLaneGridlines(DAW_TIMELINE_SPAN_SECS).length;
    const total = html.split('class="daw-gridline').length - 1;
    expect(total).toBe(perLane * (1 + state.channelConfig.length)); // mix lane + one per channel lane
  });

  it('seeds the transport time from the bridged playhead elapsed so a rebuild never flashes 0:00', () => {
    const html = dawShellHTML(makeState({ playheadElapsedMs: 90000 }));
    expect(html).toContain('>1:30</span>');
  });

  it('signatures the lanes by joined escaped names so a same-count rig swap forces a rebuild', () => {
    const a = dawShellPatchView(makeState());
    const b = dawShellPatchView(makeState({ channelConfig: [{ ...CONFIG[0], label: 'Renamed' }, CONFIG[1]] }));
    expect(a.laneSignature).not.toBe(b.laneSignature);
    expect(a.laneSignature).toContain('\u0000');
  });

  it('composes the shared Session Record control into the transport', () => {
    const html = dawShellHTML(makeState({ capturePhase: 'recording' }));
    expect(html).toContain('id="daw-session-record"');
    expect(html).toContain('daw-session-record--recording');
    expect(html).toContain('>Stop</button>');
  });

  it('wraps the ruler and lanes in a semantic arrangement frame (#1042)', () => {
    const html = dawShellHTML(makeState());
    expect(html).toContain('<div class="daw-arrangement">');
    expect(html).toContain('<div class="daw-track-heads');
    expect(html).toContain('<div class="daw-timeline">');
    expect(html).toContain('<div class="daw-lane-column">');
  });

  it('nests the ruler in the timeline region, not the track-header column (#1042)', () => {
    const html = dawShellHTML(makeState());
    // The head column is now populated (#1043), so anchor on its opening tag
    // rather than the #1042 empty-column literal.
    const heads = html.indexOf('<div class="daw-track-heads');
    const timeline = html.indexOf('<div class="daw-timeline">');
    const ruler = html.indexOf('<div class="daw-ruler">');
    const laneColumn = html.indexOf('<div class="daw-lane-column">');
    // Head column is closed before the timeline region opens, so the ruler
    // cannot be inside it; inside the timeline the ruler precedes the lane
    // column, and every lane lives in the lane column.
    expect(heads).toBeGreaterThan(-1);
    expect(timeline).toBeGreaterThan(heads);
    expect(ruler).toBeGreaterThan(timeline);
    expect(laneColumn).toBeGreaterThan(ruler);
    expect(html.indexOf('daw-mix-lane')).toBeGreaterThan(laneColumn);
    expect(html.indexOf('daw-channel-lane')).toBeGreaterThan(laneColumn);
  });

  it('keeps the empty-state row inside the lane column (#1042)', () => {
    const html = dawShellHTML(makeState({ channelConfig: [] }));
    expect(html.indexOf('Add your first track'))
      .toBeGreaterThan(html.indexOf('<div class="daw-lane-column">'));
  });

  it('emits the head-column width from the shared timeline origin so CSS cannot drift (#1042)', () => {
    expect(dawShellHTML(makeState()))
      .toContain(`<div class="daw-shell" style="--daw-head-w:${DAW_TIMELINE_ORIGIN_PX}px">`);
  });

  it('the ruler origin is the lane column time origin — both start at the shared t=0 x (#1042)', () => {
    const html = dawShellHTML(makeState());
    expect(html).toContain(`<span class="daw-ruler-tick" style="left:${DAW_TIMELINE_ORIGIN_PX}px"></span>`);
    expect(html).toContain(`<span class="daw-gridline major" style="left:${DAW_TIMELINE_ORIGIN_PX}px"></span>`);
    expect(dawTimelineX(0)).toBe(DAW_TIMELINE_ORIGIN_PX);
  });

  it('is pure — equal state renders an identical frame with no DOM or store reads (#1042)', () => {
    expect(dawShellHTML(makeState())).toBe(dawShellHTML(makeState()));
  });

  it('opens the head column with a ruler gutter, ahead of any track head (#1048)', () => {
    const html = dawShellHTML(makeState());
    const heads = html.indexOf('<div class="daw-track-heads');
    const gutter = html.indexOf('<div class="daw-ruler-gutter"></div>');
    const firstHead = html.search(/class="[^"]*\bdaw-track-head\b/);
    expect(gutter).toBeGreaterThan(heads);
    expect(gutter).toBeLessThan(firstHead);
    expect(html.split('<div class="daw-ruler-gutter"></div>').length - 1).toBe(1);
    const timelineSlice = html.slice(html.indexOf('<div class="daw-timeline">'));
    expect(timelineSlice).not.toContain('daw-ruler-gutter');
  });

  it('pairs the zero-track empty state with an empty head cell (#1048)', () => {
    const html = dawShellHTML(makeState({ channelConfig: [] }));
    const headsSlice = html.slice(html.indexOf('<div class="daw-track-heads'), html.indexOf('<div class="daw-timeline">'));
    expect(headsSlice.split('class="daw-empty-head"').length - 1).toBe(1);
    expect(html.split('daw-empty-state').length - 1).toBe(1);
    expect(html).toContain('class="daw-master-head"');
  });

  it('emits no empty head cell when tracks are configured (#1048)', () => {
    expect(dawShellHTML(makeState())).not.toContain('daw-empty-head');
  });
});

describe('dawTrackRows / configured track rows (#1043)', () => {
  it('returns one entry per configured channel with sequential 0-based indices, resolved through resolveStripLabel', () => {
    const rows = dawTrackRows(makeState());
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
    expect(rows).toHaveLength(CONFIG.length);
  });

  it('escapes a user-entered label', () => {
    const rows = dawTrackRows(makeState({ channelConfig: [{ ...CONFIG[0], label: 'Kick <3' }] }));
    expect(rows[0].name).toBe('Kick &lt;3');
  });

  it('falls back to the latest tick channel name', () => {
    const rows = dawTrackRows(makeState({ lastLiveChannels: TICK_CHANNELS }));
    expect(rows[0].name).toBe('Vocals');
  });

  it('derives monitor activity from mute and solo without changing armed state (#1056)', () => {
    const ordinary = dawTrackRows(makeState());
    expect(ordinary.map((row) => row.monitorActive)).toEqual([true, true]);

    const muted = dawTrackRows(makeState({ mutedChannels: { 0: true } }));
    expect(muted[0]).toMatchObject({ armed: true, muted: true, monitorActive: false });
    expect(muted[1].monitorActive).toBe(true);

    const soloed = dawTrackRows(makeState({ soloedChannels: { 1: true } }));
    expect(soloed.map((row) => row.monitorActive)).toEqual([false, true]);

    const finalSoloCleared = dawTrackRows(makeState({ soloedChannels: {} }));
    expect(finalSoloCleared.map((row) => row.monitorActive)).toEqual([true, true]);

    const mutedSolo = dawTrackRows(makeState({ mutedChannels: { 1: true }, soloedChannels: { 1: true } }));
    expect(mutedSolo[1]).toMatchObject({ muted: true, soloed: true, monitorActive: false });
  });

  it('marks only dimmed channel lanes and clears that modifier after the final solo (#1056)', () => {
    const laneAt = (html: string, index: number) => html.match(new RegExp(`<div class="(daw-lane daw-channel-lane[^"]*)" data-ch="${index}">`))?.[1];

    const mutedHTML = dawShellHTML(makeState({ mutedChannels: { 0: true } }));
    expect(laneAt(mutedHTML, 0)).toContain('daw-channel-lane--dimmed');
    expect(laneAt(mutedHTML, 1)).not.toContain('daw-channel-lane--dimmed');

    const soloedHTML = dawShellHTML(makeState({ soloedChannels: { 1: true } }));
    expect(laneAt(soloedHTML, 0)).toContain('daw-channel-lane--dimmed');
    expect(laneAt(soloedHTML, 1)).not.toContain('daw-channel-lane--dimmed');

    const clearedHTML = dawShellHTML(makeState({ soloedChannels: {} }));
    expect(laneAt(clearedHTML, 0)).not.toContain('daw-channel-lane--dimmed');
    expect(laneAt(clearedHTML, 1)).not.toContain('daw-channel-lane--dimmed');
    expect(clearedHTML).not.toContain('daw-mix-lane daw-channel-lane--dimmed');
  });

  it('dawShellHTML renders one .daw-track-head per configured channel, in lane order', () => {
    const html = dawShellHTML(makeState({ channelGroups: [] }));
    expect(countClassToken(html, 'daw-track-head')).toBe(CONFIG.length);
    const headsSlice = html.slice(html.indexOf('<div class="daw-track-heads'), html.indexOf('<div class="daw-timeline">'));
    expect(headsSlice.indexOf('data-ch="0"')).toBeLessThan(headsSlice.indexOf('data-ch="1"'));
  });

  it('stamps selected state on DAW track heads for the EQ-pane interaction contract', () => {
    const html = dawShellHTML(makeState({ selectedChannel: 1 }));
    expect(html).toMatch(/class="[^"]*\bdaw-track-head\b[^"]*\bselected\b[^"]*" data-ch="1" aria-current="true"/);
    const first = html.match(/<div class="[^"]*\bdaw-track-head\b[^"]*" data-ch="0"[^>]*>/)?.[0] ?? '';
    expect(first).not.toContain('selected');
    expect(first).not.toContain('aria-current');
  });

  it('uses DAW track heads without the retired meter hook', () => {
    expect(dawShellHTML(makeState())).toContain('daw-track-heads');
    expect(dawShellHTML(makeState())).not.toContain('sb-' + 'live-meters');
  });

  it('renders DAW track heads in grouped order with group collapse state and drag handles', () => {
    const state = makeState({
      channelConfig: [...CONFIG, { kind: 'mono', a: 2, b: 3, armed: true }],
      channelGroups: [
        { name: 'Drums', members: [2, 0], collapsed: true },
      ],
    });
    const entries = dawTrackListEntries(state);
    expect(entries.map((entry) => entry.type === 'track' ? entry.row.index : entry.type)).toEqual(['group', 2, 0, 'ungrouped', 1]);

    const html = dawShellHTML(state);
    const headsSlice = html.slice(html.indexOf('<div class="daw-track-heads'), html.indexOf('<div class="daw-timeline">'));
    expect(headsSlice).toContain('class="live-group-head collapsed" data-group="0"');
    expect(headsSlice.indexOf('data-ch="2"')).toBeLessThan(headsSlice.indexOf('data-ch="0"'));
    expect(headsSlice.indexOf('data-ch="0"')).toBeLessThan(headsSlice.indexOf('class="live-group-head ungrouped"'));
    expect(headsSlice).toMatch(/class="[^"]*\bdaw-track-head\b[^"]*\bidle\b[^"]*\bgroup-collapsed\b[^"]*" data-ch="2"/);
    expect(headsSlice).toMatch(/class="[^"]*\bdaw-track-head\b[^"]*\bidle\b[^"]*\bgroup-collapsed\b[^"]*" data-ch="0"/);
    expect(headsSlice).toContain('class="daw-track-head-drag"');
    expect(html).toContain('class="daw-lane-group-spacer collapsed" data-group="0"');
    expect(html).toContain('class="daw-lane-group-spacer ungrouped" data-group="-1"');
  });

  it('each head row carries a track-header representation with the resolved name and a 1-based displayed index', () => {
    const html = dawShellHTML(makeState({ channelConfig: [{ ...CONFIG[0], label: 'Kick <3' }] }));
    const headsSlice = html.slice(html.indexOf('<div class="daw-track-heads'), html.indexOf('<div class="daw-timeline">'));
    expect(headsSlice).toContain('class="daw-track-head-index"');
    expect(headsSlice).toMatch(/class="[^"]*\bdaw-track-head-name\b[^"]*"/);
    expect(headsSlice).toContain('>1</span>');
    expect(headsSlice).toContain('>Kick &lt;3</span>');
  });

  it('unarmed configured tracks get both a head row and a lane', () => {
    const html = dawShellHTML(makeState({ channelConfig: [{ kind: 'mono', a: 3, b: 4, armed: false }], channelGroups: [] }));
    expect(html).toMatch(/class="[^"]*\bdaw-track-head\b[^"]*" data-ch="0"/);
    expect(html).toContain('class="daw-lane daw-channel-lane" data-ch="0"');
    expect(html).not.toContain('Add your first track');
  });

  it('head and lane row counts stay in parity across every supplied view state', () => {
    for (const length of [0, 1, 2, 3]) {
      const config = Array.from({ length }, () => ({ ...CONFIG[0] }));
      const html = dawShellHTML(makeState({ channelConfig: config, channelGroups: [] }));
      const headCount = countClassToken(html, 'daw-track-head');
      const laneCount = html.split('class="daw-lane daw-channel-lane"').length - 1;
      expect(headCount).toBe(length);
      expect(laneCount).toBe(length);
    }
  });

  it('empty config renders a head column with no track rows, only the master row, and still shows the lane empty state (#1044)', () => {
    const html = dawShellHTML(makeState({ channelConfig: [] }));
    expect(countClassToken(html, 'daw-track-head')).toBe(0);
    expect(html).toContain('class="daw-master-head"');
    expect(html).toContain('Add your first track');
  });

  it('dawShellHTML is pure — equal state renders an identical head column, and changing channelConfig changes it', () => {
    expect(dawShellHTML(makeState())).toBe(dawShellHTML(makeState()));
    const withTracks = dawShellHTML(makeState());
    const withoutTracks = dawShellHTML(makeState({ channelConfig: [] }));
    expect(withTracks).not.toBe(withoutTracks);
  });
});

describe('overall-mix row and status line (#1044)', () => {
  it('dawStatusLineView pluralizes the track count', () => {
    expect(dawStatusLineView(makeState({ channelConfig: [] })).tracks).toBe('No tracks');
    expect(dawStatusLineView(makeState({ channelConfig: [CONFIG[0]] })).tracks).toBe('1 track');
    expect(dawStatusLineView(makeState()).tracks).toBe('2 tracks');
  });

  it('dawStatusLineView.capture always equals the transport chip', () => {
    const states = [
      makeState(),
      makeState({ isCapturing: true, liveMode: 'monitor' }),
      makeState({ isCapturing: true, liveMode: 'record' }),
    ];
    const expected = ['Stopped', 'Monitoring', 'Recording'];
    states.forEach((state, i) => {
      const view = dawStatusLineView(state);
      expect(view.capture).toBe(dawShellPatchView(state).transportChip);
      expect(view.capture).toBe(expected[i]);
    });
  });

  it('dawStatusLineView.device reads the selected device name, escaped, or a fallback', () => {
    expect(dawStatusLineView(makeState()).device).toBe('No device selected');
    expect(dawStatusLineView(makeState({ selectedDevice: '0' })).device).toBe('Scarlett 18i20');
    const escapedState = makeState({
      devices: [{ index: 9, name: 'Mixer <2>', channels: 2, default_sr: 48000 }],
      selectedDevice: '9',
    });
    expect(dawStatusLineView(escapedState).device).toBe('Mixer &lt;2&gt;');
  });

  it('dawShellHTML renders the status line below the arrangement content', () => {
    const state = makeState();
    const html = dawShellHTML(state);
    const view = dawStatusLineView(state);
    expect(html).toContain('<div class="daw-status-line">');
    expect(html.indexOf('<div class="daw-status-line">')).toBeGreaterThan(html.indexOf('daw-mix-lane'));
    expect(html.indexOf('<div class="daw-status-line">')).toBeGreaterThan(html.indexOf('<div class="daw-lane-column">'));
    expect(html).toContain(`<span class="daw-status-tracks">${view.tracks}</span>`);
    expect(html).toContain(`<span class="daw-status-capture">${view.capture}</span>`);
    expect(html).toContain(`<span class="daw-status-device">${view.device}</span>`);
  });

  it('the overall-mix head cell closes the head column', () => {
    const html = dawShellHTML(makeState());
    const slice = html.slice(html.indexOf('<div class="daw-track-heads'), html.indexOf('<div class="daw-timeline">'));
    expect(slice).toContain('class="daw-master-head"');
    expect(slice).toContain('>Overall mix</span>');
    expect(slice.indexOf('class="daw-master-head"')).toBeGreaterThan(slice.lastIndexOf('daw-track-head'));
  });

  it('the mix lane closes the lane column', () => {
    const html = dawShellHTML(makeState());
    expect(html.indexOf('daw-mix-lane')).toBeGreaterThan(html.lastIndexOf('daw-channel-lane'));
  });

  it('the master row is never counted as a track row', () => {
    for (const length of [0, 1, 2, 3]) {
      const config = Array.from({ length }, () => ({ ...CONFIG[0] }));
      const html = dawShellHTML(makeState({ channelConfig: config, channelGroups: [] }));
      expect(countClassToken(html, 'daw-track-head')).toBe(length);
      expect(html.split('class="daw-master-head"').length - 1).toBe(1);
    }
  });

  it('the overall-mix row still renders with no configured tracks', () => {
    const html = dawShellHTML(makeState({ channelConfig: [] }));
    expect(html).toContain('class="daw-master-head"');
    expect(html).toContain('daw-mix-lane');
    expect(html).toContain('Add your first track');
  });

  it('dawShellHTML stays pure and reflects the supplied snapshot, not fixed markup', () => {
    const states = [
      makeState(),
      makeState({ channelConfig: [] }),
      makeState({ isCapturing: true, liveMode: 'record' }),
      makeState({ selectedDevice: '1' }),
    ];
    for (const state of states) {
      expect(dawShellHTML({ ...state })).toBe(dawShellHTML({ ...state }));
    }
    const withTracks = dawShellHTML(makeState());
    const withoutTracks = dawShellHTML(makeState({ channelConfig: [] }));
    expect(withTracks).not.toBe(withoutTracks);
    const noDevice = dawShellHTML(makeState());
    const withDevice = dawShellHTML(makeState({ selectedDevice: '1' }));
    expect(noDevice).not.toBe(withDevice);
  });
});

describe('liveAdjustmentsPanelHTML', () => {
  it('returns empty when the experimental flag is off', () => {
    expect(liveAdjustmentsPanelHTML(makeState())).toBe('');
  });

  it('renders the panel on the Live tab once the flag is on', () => {
    const html = liveAdjustmentsPanelHTML(makeState({ settings: settings({ liveAdjustmentsEnabled: true }) }));
    expect(html).toContain('live-adjustments-panel');
    expect(html).toContain('Live adjustments');
  });

  it('passes the rolling windows, measurement source, focus view, and coaching through', () => {
    const coaching = liveAdjustmentsState.createCoachingState();
    const html = liveAdjustmentsPanelHTML(makeState({
      settings: settings({ liveAdjustmentsEnabled: true }),
      liveWindows: [{ type: 'window', window: 1, ts: 0, channels: [], masking: [] } as LiveEvent],
      lastLiveChannels: TICK_CHANNELS,
      measurementSource: 1,
      focusedInputIndex: 0,
      lapCoaching: coaching,
    }));
    expect(html).toContain('Listening…');
    // Focused-input inspector lists both configured strips.
    expect(html).toContain('Focused input');
    expect(html).toContain('<option value="0" selected>Vocals</option>');
  });
});

describe('statsRowView', () => {
  it('renders the file-analysis stats with the exact threshold tones', () => {
    const view = statsRowView(
      { rmsDbfs: -8, peakDbfs: -0.5, dynamicRangeDb: 12, clipping: false },
      { spectralCentroid: 1200 },
    );
    expect(view).toEqual({
      rms: '-8.0', rmsTone: '', peak: '-0.5', peakTone: 'issue', headroom: '0.5', headroomTone: 'issue',
      dr: '12.0', drTone: '', clip: 'No', clipTone: '', centroid: '1,200',
    });
  });

  it('flags a hot RMS and a crushed DR as checks', () => {
    const view = statsRowView(
      { rmsDbfs: -4, peakDbfs: -10, dynamicRangeDb: 4, clipping: true },
      { spectralCentroid: 900 },
    );
    expect(view.rmsTone).toBe('check');
    expect(view.drTone).toBe('check');
    expect(view.clip).toBe('YES');
    expect(view.clipTone).toBe('issue');
  });

  it('renders an em dash centroid when the spectrum carries none', () => {
    expect(statsRowView({ rmsDbfs: -20, peakDbfs: -10, dynamicRangeDb: 10, clipping: false }, {}).centroid).toBe('—');
  });

  it('uses an unavailable neutral headroom when the file peak is non-finite', () => {
    const view = statsRowView({ rmsDbfs: -20, peakDbfs: Number.POSITIVE_INFINITY, dynamicRangeDb: 10, clipping: false }, {});
    expect(view.headroom).toBe('—');
    expect(view.headroomTone).toBe('');
  });
});

describe('liveStatsRowView', () => {
  it('renders the live variant with an em-dash DR and CLIP marker', () => {
    const view = liveStatsRowView({ rms: -5, peak: -0.5, clipping: true, centroid: 3000, bands: {} } as LiveMeterChannel);
    expect(view.rms).toBe('-5.0');
    expect(view.rmsTone).toBe('check');
    expect(view.peakTone).toBe('issue');
    expect(view.headroom).toBe('0.5');
    expect(view.headroomTone).toBe('issue');
    expect(view.dr).toBe('—');
    expect(view.clip).toBe('CLIP');
    expect(view.clipTone).toBe('issue');
    expect(view.centroid).toBe('3,000');
  });

  it('uses em dashes for the centroid and No for a clean clip', () => {
    const view = liveStatsRowView({ rms: -20, peak: -10, clipping: false, centroid: undefined, bands: {} } as LiveMeterChannel);
    expect(view.clip).toBe('No');
    expect(view.centroid).toBe('—');
    expect(view.headroom).toBe('10.0');
    expect(view.headroomTone).toBe('');
  });

  it('uses an em dash for headroom when the peak is unavailable', () => {
    const view = liveStatsRowView({ rms: Number.NaN, peak: Number.POSITIVE_INFINITY, clipping: false, bands: {} } as LiveMeterChannel);
    expect(view.peak).toBe('-∞');
    expect(view.headroom).toBe('—');
    expect(view.headroomTone).toBe('');
  });

  it('returns null level tiles for an idle or missing selected channel', () => {
    expect(eqPaneLevelTilesView(null)).toBeNull();
    expect(eqPaneLevelTilesView({ rms: Number.NEGATIVE_INFINITY, peak: Number.NEGATIVE_INFINITY, clipping: false, bands: {}, idle: true } as LiveMeterChannel)).toBeNull();
  });

  it('returns unavailable level tiles for an out-of-range selected channel', () => {
    const channel = { rms: -20, peak: -10, clipping: false, bands: {} } as LiveMeterChannel;
    expect(selectedEqPaneLevelTilesView([channel], 1)).toBeNull();
    expect(selectedEqPaneLevelTilesView([channel], -1)).toBeNull();
    expect(selectedEqPaneLevelTilesView([channel], 1.5)).toBeNull();
  });
});
