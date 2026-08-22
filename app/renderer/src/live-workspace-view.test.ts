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
  meterCardHTML,
  dawShellHTML,
  dawTrackHeaderHTML,
  dawShellPatchView,
  dawTrackRows,
  dawStatusLineView,
  liveAdjustmentsPanelHTML,
  statsRowView,
  liveStatsRowView,
  boardRunning,
  type LiveWorkspaceViewState,
} from './live-workspace-view';
import { levelPercent, type LiveDevice, type StripConfig, type ChannelGroup, type LiveEvent, type LiveMeterChannel } from './live-capture-panel';
import type { AppSettings } from '../../electron/ipc/api';
import { dawTimelineX, dawRulerTicks, dawLaneGridlines, DAW_TIMELINE_SPAN_SECS, DAW_TIMELINE_ORIGIN_PX } from './daw-shell-runtime';

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
    crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    ...overrides,
  };
}

const TICK_CHANNELS: Array<{ name: string; rms: number; peak: number; clipping: boolean; centroid: number; bands: Record<string, number> }> = [
  { name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400,
    bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
  { name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300,
    bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
];

const TICK: LiveEvent = { type: 'meter', ts: 0, channels: TICK_CHANNELS } as LiveEvent;

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

  it('resolves the effective instrument profile and the auto flag (#524)', () => {
    const auto = stripViewAt(makeState(), 0, TICK_CHANNELS[0]);
    expect(auto.instrumentProfileId).toBe('generic');
    expect(auto.instrumentAuto).toBe(true);

    const overridden = stripViewAt(makeState({
      selectedDevice: '0',
      settings: settings({ inputInstrumentProfiles: { 'Scarlett 18i20': { '0': 'vocal' } } }),
    }), 0, TICK_CHANNELS[0]);
    expect(overridden.instrumentProfileId).toBe('vocal');
    expect(overridden.instrumentAuto).toBe(false);
  });
});

describe('livePanelView', () => {
  it('maps device channels, live running, groups, and instrument profiles', () => {
    const view = livePanelView(makeState({ selectedDevice: '0', isCapturing: true }));
    expect(view.deviceChannels).toBe(8);
    expect(view.liveRunning).toBe(true);
    expect(view.groups).toBe(GROUPS);
    expect(view.instrumentProfiles).toEqual(instrumentProfiles.PROFILES.map((p: { id: string; label: string }) => ({ id: p.id, label: p.label })));
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
      lastLiveChannels: TICK_CHANNELS as never,
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
    expect(currentEqPaneChannels(makeState({ lastLiveChannels: TICK_CHANNELS as never }))).toBe(TICK_CHANNELS);
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
    expect(html).toContain('Press the top-bar Record button when you’re ready.');
    expect(html).toContain('>3</span>');
  });
});

describe('meterCardHTML', () => {
  it('builds the running card from the tick when capturing with a lastTick', () => {
    const { html, idle } = meterCardHTML(makeState({ isCapturing: true, lastTick: TICK }));
    expect(idle).toBe(false);
    expect(html).toContain('<div class="meter-card sb-live-meters">');
    expect(html).toContain('Vocals');
    expect(html).not.toContain(' id="live-ws-add"');
  });

  it('builds the idle card from idle placeholders otherwise', () => {
    const { html, idle } = meterCardHTML(makeState());
    expect(idle).toBe(true);
    expect(html).toContain('<div class="meter-card sb-live-meters idle">');
    expect(html).toContain('Idle');
    expect(html).not.toContain('Vocals');
  });
});

describe('dawShellHTML / dawShellPatchView', () => {
  it('derives each header row state and RMS level from the shared snapshot', () => {
    const rows = dawTrackRows(makeState({
      mutedChannels: { 0: true }, soloedChannels: { 1: true },
      lastLiveChannels: TICK_CHANNELS as never,
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
    expect(dawTrackRows(makeState({ lastLiveChannels: [{ ...TICK_CHANNELS[0], idle: true }] as never }))[0].levelPercent).toBe(0);
  });

  it('builds an accessible escaped track header with its initial inline level', () => {
    const html = dawTrackHeaderHTML({ index: 0, name: 'Kick &lt;3', armed: true, muted: false, soloed: true, levelPercent: 70 });
    expect(html).toContain('class="daw-track-head-arm"');
    expect(html).toContain('aria-label="Disarm track"');
    expect(html).toContain('class="daw-track-head-mute"');
    expect(html).toContain('aria-label="Mute track"');
    expect(html).toContain('class="daw-track-head-mute" aria-label="Mute track" aria-pressed="false"');
    expect(html).toContain('class="daw-track-head-solo"');
    expect(html).toContain('aria-label="Unsolo track"');
    expect(html).toContain('class="daw-track-head-remove"');
    expect(html).toContain('aria-label="Remove track"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('style="width:70%"');
    expect(html).toContain('>Kick &lt;3</span>');
  });

  it('keeps header markup byte-identical for equal rows', () => {
    const row = { index: 0, name: 'Kick', armed: true, muted: false, soloed: false, levelPercent: 0 };
    expect(dawTrackHeaderHTML(row)).toBe(dawTrackHeaderHTML(row));
  });

  it('renders controls once per track but never in the master header', () => {
    const html = dawShellHTML(makeState());
    expect(html.split('daw-track-head-arm').length - 1).toBe(CONFIG.length);
    const master = html.slice(html.indexOf('daw-master-head'));
    expect(master).not.toContain('daw-track-head-arm');
  });
  it('renders the transport header, ruler, playhead, and mix lane', () => {
    const html = dawShellHTML(makeState());
    expect(html).toContain('daw-shell');
    expect(html).toContain('daw-transport');
    expect(html).toContain('daw-ruler');
    expect(html).toContain('daw-playhead');
    expect(html).toContain('daw-mix-lane');
    expect(html).toContain('daw-transport-time');
  });

  it('renders one playhead segment per timeline region and none at the shell level (#1049)', () => {
    const html = dawShellHTML(makeState());
    expect(html).toContain('<span class="daw-playhead daw-playhead-ruler"></span>');
    expect(html).toContain('<span class="daw-playhead daw-playhead-lanes"></span>');
    expect(html.split('class="daw-playhead').length - 1).toBe(2);
    expect(html).not.toContain('<div class="daw-playhead"></div>');
  });

  it("the ruler segment is the ruler row's last child, above every tick (#1049)", () => {
    const html = dawShellHTML(makeState());
    expect(html.indexOf('daw-playhead-ruler')).toBeGreaterThan(html.lastIndexOf('class="daw-ruler-tick"'));
    expect(html.indexOf('daw-playhead-ruler')).toBeLessThan(html.indexOf('<div class="daw-lane-column">'));
  });

  it("the lane segment is the lane column's last child, above every lane (#1049)", () => {
    const html = dawShellHTML(makeState());
    expect(html.indexOf('daw-playhead-lanes')).toBeGreaterThan(html.indexOf('daw-mix-lane'));
    expect(html.indexOf('daw-playhead-lanes')).toBeLessThan(html.indexOf('<div class="daw-status-line">'));
  });

  it('both segments render with zero configured tracks (#1049)', () => {
    const html = dawShellHTML(makeState({ channelConfig: [] }));
    expect(html).toContain('<span class="daw-playhead daw-playhead-ruler"></span>');
    expect(html).toContain('<span class="daw-playhead daw-playhead-lanes"></span>');
  });

  it('maps one lane per channel config entry with an escaped name', () => {
    const html = dawShellHTML(makeState({ channelConfig: [{ ...CONFIG[0], label: 'Kick <3' }] }));
    expect(html).toContain('data-ch="0"');
    expect(html).toContain('>Kick &lt;3</span>');
    expect(html).toContain('daw-channel-waveform');
  });

  it('resolves lane names from the latest tick channels while the shell shows (#39)', () => {
    const html = dawShellHTML(makeState({ lastLiveChannels: TICK_CHANNELS as never }));
    expect(html).toContain('>Vocals</span>');
  });

  it('renders the empty-state row with no channels', () => {
    expect(dawShellHTML(makeState({ channelConfig: [] }))).toContain('Add tracks to see channel lanes');
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

  it('points users at the top-bar Record button for capture controls (#757)', () => {
    expect(dawShellHTML(makeState())).toContain('Start and stop recording from the top-bar Record button');
  });

  it('wraps the ruler and lanes in a semantic arrangement frame (#1042)', () => {
    const html = dawShellHTML(makeState());
    expect(html).toContain('<div class="daw-arrangement">');
    expect(html).toContain('<div class="daw-track-heads">');
    expect(html).toContain('<div class="daw-timeline">');
    expect(html).toContain('<div class="daw-lane-column">');
  });

  it('nests the ruler in the timeline region, not the track-header column (#1042)', () => {
    const html = dawShellHTML(makeState());
    // The head column is now populated (#1043), so anchor on its opening tag
    // rather than the #1042 empty-column literal.
    const heads = html.indexOf('<div class="daw-track-heads">');
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
    expect(html.indexOf('Add tracks to see channel lanes'))
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
    const heads = html.indexOf('<div class="daw-track-heads">');
    const gutter = html.indexOf('<div class="daw-ruler-gutter"></div>');
    const firstHead = html.indexOf('class="daw-track-head"');
    expect(gutter).toBeGreaterThan(heads);
    expect(gutter).toBeLessThan(firstHead);
    expect(html.split('<div class="daw-ruler-gutter"></div>').length - 1).toBe(1);
    const timelineSlice = html.slice(html.indexOf('<div class="daw-timeline">'));
    expect(timelineSlice).not.toContain('daw-ruler-gutter');
  });

  it('pairs the zero-track empty state with an empty head cell (#1048)', () => {
    const html = dawShellHTML(makeState({ channelConfig: [] }));
    const headsSlice = html.slice(html.indexOf('<div class="daw-track-heads">'), html.indexOf('<div class="daw-timeline">'));
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
    const rows = dawTrackRows(makeState({ lastLiveChannels: TICK_CHANNELS as never }));
    expect(rows[0].name).toBe('Vocals');
  });

  it('dawShellHTML renders one .daw-track-head per configured channel, in lane order', () => {
    const html = dawShellHTML(makeState());
    expect(html.split('class="daw-track-head"').length - 1).toBe(CONFIG.length);
    const headsSlice = html.slice(html.indexOf('<div class="daw-track-heads">'), html.indexOf('<div class="daw-timeline">'));
    expect(headsSlice.indexOf('data-ch="0"')).toBeLessThan(headsSlice.indexOf('data-ch="1"'));
  });

  it('each head row carries a track-header representation with the resolved name and a 1-based displayed index', () => {
    const html = dawShellHTML(makeState({ channelConfig: [{ ...CONFIG[0], label: 'Kick <3' }] }));
    const headsSlice = html.slice(html.indexOf('<div class="daw-track-heads">'), html.indexOf('<div class="daw-timeline">'));
    expect(headsSlice).toContain('class="daw-track-head-index"');
    expect(headsSlice).toContain('class="daw-track-head-name"');
    expect(headsSlice).toContain('>1</span>');
    expect(headsSlice).toContain('>Kick &lt;3</span>');
  });

  it('unarmed configured tracks get both a head row and a lane', () => {
    const html = dawShellHTML(makeState({ channelConfig: [{ kind: 'mono', a: 3, b: 4, armed: false }] }));
    expect(html).toContain('class="daw-track-head" data-ch="0"');
    expect(html).toContain('class="daw-lane daw-channel-lane" data-ch="0"');
    expect(html).not.toContain('Add tracks to see channel lanes');
  });

  it('head and lane row counts stay in parity across every supplied view state', () => {
    for (const length of [0, 1, 2, 3]) {
      const config = Array.from({ length }, () => ({ ...CONFIG[0] }));
      const html = dawShellHTML(makeState({ channelConfig: config }));
      const headCount = html.split('class="daw-track-head"').length - 1;
      const laneCount = html.split('class="daw-lane daw-channel-lane"').length - 1;
      expect(headCount).toBe(length);
      expect(laneCount).toBe(length);
    }
  });

  it('empty config renders a head column with no track rows, only the master row, and still shows the lane empty state (#1044)', () => {
    const html = dawShellHTML(makeState({ channelConfig: [] }));
    expect(html.split('class="daw-track-head"').length - 1).toBe(0);
    expect(html).toContain('class="daw-master-head"');
    expect(html).toContain('Add tracks to see channel lanes');
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
    const slice = html.slice(html.indexOf('<div class="daw-track-heads">'), html.indexOf('<div class="daw-timeline">'));
    expect(slice).toContain('class="daw-master-head"');
    expect(slice).toContain('>Overall mix</span>');
    expect(slice.indexOf('class="daw-master-head"')).toBeGreaterThan(slice.lastIndexOf('class="daw-track-head"'));
  });

  it('the mix lane closes the lane column', () => {
    const html = dawShellHTML(makeState());
    expect(html.indexOf('daw-mix-lane')).toBeGreaterThan(html.lastIndexOf('daw-channel-lane'));
  });

  it('the master row is never counted as a track row', () => {
    for (const length of [0, 1, 2, 3]) {
      const config = Array.from({ length }, () => ({ ...CONFIG[0] }));
      const html = dawShellHTML(makeState({ channelConfig: config }));
      expect(html.split('class="daw-track-head"').length - 1).toBe(length);
      expect(html.split('class="daw-master-head"').length - 1).toBe(1);
    }
  });

  it('the overall-mix row still renders with no configured tracks', () => {
    const html = dawShellHTML(makeState({ channelConfig: [] }));
    expect(html).toContain('class="daw-master-head"');
    expect(html).toContain('daw-mix-lane');
    expect(html).toContain('Add tracks to see channel lanes');
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
      lastLiveChannels: TICK_CHANNELS as never,
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
      rms: '-8.0', rmsTone: '', peak: '-0.5', peakTone: 'issue',
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
});

describe('liveStatsRowView', () => {
  it('renders the live variant with an em-dash DR and CLIP marker', () => {
    const view = liveStatsRowView({ rms: -5, peak: -0.5, clipping: true, centroid: 3000, bands: {} } as LiveMeterChannel);
    expect(view.rms).toBe('-5.0');
    expect(view.rmsTone).toBe('check');
    expect(view.peakTone).toBe('issue');
    expect(view.dr).toBe('—');
    expect(view.clip).toBe('CLIP');
    expect(view.clipTone).toBe('issue');
    expect(view.centroid).toBe('3,000');
  });

  it('uses em dashes for the centroid and No for a clean clip', () => {
    const view = liveStatsRowView({ rms: -20, peak: -10, clipping: false, centroid: undefined, bands: {} } as LiveMeterChannel);
    expect(view.clip).toBe('No');
    expect(view.centroid).toBe('—');
  });
});
