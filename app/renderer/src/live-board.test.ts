// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  stripViewAt,
  livePanelView,
  lapFocusView,
  lapObservationContext,
  currentPaneChannels,
  liveBoardPatchPlan,
  eqPaneViewFor,
  workspaceToolbarHTML,
  setupStepsHTML,
  setupStepsView,
  heroHTML,
  bannerHTML,
  boardHTML,
  dawShellHTML,
  liveStatsRowView,
  fileStatsRowView,
  liveBoardShowing,
  liveAdjustmentsPanelHTML,
  idleChannelsFor,
  type LiveBoardState,
  type SetupStep,
  type LapFocusView,
} from './live-board';
import {
  type StripConfig,
  type ChannelGroup,
  type LiveDevice,
  type LiveMeterChannel,
  type LiveEvent,
} from './live-capture-panel';

// The pure helper classic-scripts live-board reads off `window` — real modules
// (not hand-rolled stubs), same convention as liveCaptureStore.test.ts.
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
import { roomPaneOverride } from './measurement-device-state';

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

let storage: Storage;

beforeEach(() => {
  storage = makeStorage();
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
    measurementDeviceState: { roomPaneOverride },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

const DEVICES: LiveDevice[] = [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }];

function strip(overrides: Partial<StripConfig> = {}): StripConfig {
  return { kind: 'mono', a: 0, b: 1, armed: true, ...overrides };
}

function channel(overrides: Partial<LiveMeterChannel> = {}): LiveMeterChannel {
  return {
    bands: { sub_bass: -50, bass: -40, low_mid: -30, mid: -20, high_mid: -30, presence: -40, brilliance: -60 },
    rms: -18,
    peak: -6,
    clipping: false,
    ...overrides,
  } as LiveMeterChannel;
}



function windowTick(channels: LiveMeterChannel[]): LiveEvent {
  return { type: 'window', window: 1, ts: 0, channels } as unknown as LiveEvent;
}

function makeBoardState(overrides: Partial<LiveBoardState> = {}): LiveBoardState {
  return {
    appMode: 'live',
    isCapturing: false,
    liveMode: 'monitor',
    channelConfig: [strip()],
    channelGroups: [],
    selectedChannel: null,
    measurementSource: null,
    selectedDevice: '',
    devices: DEVICES,
    settings: {
      idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
      usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
      crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false,
      reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
      weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, measurementDeviceName: '',
      gradingProfile: 'casual', consoleNetworkConsentGranted: false, soundcheckBuses: [],
    },
    lastTick: null,
    lastLiveChannels: null,
    liveWindows: [],
    lapCoaching: null,
    focusedInputIndex: null,
    secondaryActive: false,
    secondaryWindows: [],
    lastMeasurementChannels: null,
    secondaryDeviceName: '',
    ...overrides,
  };
}

describe('stripViewAt', () => {
  it('resolves displayName through rigReconcile (label → channel name → Ch N)', () => {
    expect(stripViewAt({ index: 0, ch: channel(), channelConfig: [strip({ label: 'Kick' })], channelGroups: [], selectedChannel: null, savedInstrumentProfiles: {} }).displayName).toBe('Kick');
    expect(stripViewAt({ index: 0, ch: channel({ name: 'USB Audio 1' }), channelConfig: [strip()], channelGroups: [], selectedChannel: null, savedInstrumentProfiles: {} }).displayName).toBe('USB Audio 1');
    expect(stripViewAt({ index: 0, ch: channel(), channelConfig: [strip()], channelGroups: [], selectedChannel: null, savedInstrumentProfiles: {} }).displayName).toBe('Ch 1');
  });

  it('marks a strip selected when its index is selectedChannel (#668)', () => {
    const input = (idx: number) => ({ index: idx, ch: channel(), channelConfig: [strip(), strip()], channelGroups: [], selectedChannel: 1, savedInstrumentProfiles: {} });
    expect(stripViewAt(input(0)).selected).toBe(false);
    expect(stripViewAt(input(1)).selected).toBe(true);
  });

  it('resolves armed via armState (default-armed unless armed:false)', () => {
    expect(stripViewAt({ index: 0, ch: channel(), channelConfig: [strip()], channelGroups: [], selectedChannel: null, savedInstrumentProfiles: {} }).armed).toBe(true);
    expect(stripViewAt({ index: 0, ch: channel(), channelConfig: [strip({ armed: false })], channelGroups: [], selectedChannel: null, savedInstrumentProfiles: {} }).armed).toBe(false);
  });

  it('resolves group index + collapse state via groupState (#483)', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [1], collapsed: true }];
    const input = (idx: number) => ({ index: idx, ch: channel(), channelConfig: [strip(), strip()], channelGroups: groups, selectedChannel: null, savedInstrumentProfiles: {} });
    expect(stripViewAt(input(0)).groupIndex).toBe(-1);
    expect(stripViewAt(input(0)).groupCollapsed).toBe(false);
    expect(stripViewAt(input(1)).groupIndex).toBe(0);
    expect(stripViewAt(input(1)).groupCollapsed).toBe(true);
  });

  it('resolves the effective instrument profile + auto flag (#524)', () => {
    const withOverride = stripViewAt({
      index: 0, ch: channel(), channelConfig: [strip({ a: 0 })], channelGroups: [], selectedChannel: null,
      savedInstrumentProfiles: { '0': 'vocal' },
    });
    expect(withOverride.instrumentProfileId).toBe('vocal');
    expect(withOverride.instrumentAuto).toBe(false);
    const auto = stripViewAt({
      index: 1, ch: channel(), channelConfig: [strip({ a: 0 }), strip({ label: 'Kick drum', a: 1, b: 2 })], channelGroups: [], selectedChannel: null,
      savedInstrumentProfiles: {},
    });
    expect(auto.instrumentProfileId).toBe('kick');
    expect(auto.instrumentAuto).toBe(true);
  });
});

describe('livePanelView', () => {
  it('exposes deviceChannels, liveRunning, groups, and the profile catalog', () => {
    const panel = livePanelView({ deviceChannels: 8, liveRunning: true, channelGroups: [] });
    expect(panel.deviceChannels).toBe(8);
    expect(panel.liveRunning).toBe(true);
    expect(panel.groups).toEqual([]);
    expect(panel.instrumentProfiles?.map((p) => p.id)).toContain('vocal');
  });
});

describe('lapFocusView', () => {
  it('resolves each input name + effective profile and carries focusedIndex', () => {
    const focus = lapFocusView({
      focusedIndex: 1,
      channelConfig: [strip({ label: 'Bass', a: 0 }), strip({ a: 1, b: 2 })],
      channels: [channel(), channel()],
      savedInstrumentProfiles: { '0': 'bass' },
    });
    expect(focus.focusedIndex).toBe(1);
    expect(focus.inputs).toHaveLength(2);
    expect(focus.inputs[0].name).toBe('Bass');
    expect((focus.inputs[0].profile as { id: string }).id).toBe('bass');
    expect((focus.inputs[1].profile as { id: string }).id).toBe('generic');
  });

  it('falls back to the channel name when a lane carries no label', () => {
    const focus = lapFocusView({ focusedIndex: null, channelConfig: [strip()], channels: [channel({ name: 'Vox' })], savedInstrumentProfiles: {} });
    expect(focus.inputs[0].name).toBe('Vox');
  });
});

describe('lapObservationContext', () => {
  it('delegates to liveAdjustmentsState.observationContext with the focused input name as the source label', () => {
    const spy = vi.spyOn(liveAdjustmentsState, 'observationContext').mockReturnValue({ mixValid: true });
    const focus: LapFocusView = { focusedIndex: 0, inputs: [{ index: 0, name: 'Room', profile: { id: 'generic' } }] };
    const out = lapObservationContext([], null, focus);
    expect(spy).toHaveBeenCalledWith([], null, focus, 'Room');
    expect(out).toEqual({ mixValid: true });
  });
});

describe('currentPaneChannels', () => {
  it('returns the tick channels when present, else idle placeholders for the config', () => {
    const tick = [channel({ name: 'Vocals' })];
    expect(currentPaneChannels(tick, [strip(), strip()])).toHaveLength(1);
    expect(currentPaneChannels(tick, [strip(), strip()])[0].name).toBe('Vocals');
    const idle = currentPaneChannels(null, [strip(), strip()]);
    expect(idle).toHaveLength(2);
    expect(idle[0].idle).toBe(true);
    expect(currentPaneChannels([], [strip()])[0].idle).toBe(true);
  });
});

describe('liveBoardPatchPlan', () => {
  it('derives per-strip views + group summary deltas from the tick and deps', () => {
    const groups: ChannelGroup[] = [{ name: 'Drums', members: [1] }];
    const tick = windowTick([channel({ name: 'Vocals', clipping: true }), channel({ name: 'Kick' })]);
    const plan = liveBoardPatchPlan(tick, {
      channelConfig: [strip({ label: 'V' }), strip()],
      channelGroups: groups,
      selectedChannel: 1,
      isCapturing: true,
      savedInstrumentProfiles: {},
    });
    expect(plan.stripViews).toHaveLength(2);
    expect(plan.stripViews[0].displayName).toBe('V');
    expect(plan.stripViews[0].selected).toBe(false);
    expect(plan.stripViews[1].selected).toBe(true);
    expect(plan.summaries).toHaveLength(1);
    expect(plan.summaries[0].group).toBe(0);
    expect(plan.summaries[0].text).toContain('1 track');
    expect(plan.summaries[0].clipping).toBe(false);
  });

  it('handles a channel-less tick with no strips or summaries', () => {
    const plan = liveBoardPatchPlan({ type: 'window', window: 1, ts: 0 } as never, {
      channelConfig: [], channelGroups: [], selectedChannel: null, isCapturing: true, savedInstrumentProfiles: {},
    });
    expect(plan.stripViews).toEqual([]);
    expect(plan.summaries).toEqual([]);
  });
});

describe('eqPaneViewFor', () => {
  it('resolves the pane view from store state, with the secondary Room override when active', () => {
    const view = eqPaneViewFor({
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels: [channel({ name: 'Vocals' })] } as never,
      lastLiveChannels: [channel({ name: 'Vocals' })],
      channelConfig: [strip()],
      measurementSource: null,
      selectedChannel: null,
      secondaryMeasurement: { status: 'off', deviceName: '' },
      secondaryWindows: [],
      lastMeasurementChannels: null,
    } as never);
    expect(view.primary?.ch.name).toBe('Vocals');
    expect(view.primary?.idx).toBe(0);

    const secondary = eqPaneViewFor({
      isCapturing: true,
      lastTick: null,
      lastLiveChannels: null,
      channelConfig: [strip()],
      measurementSource: null,
      selectedChannel: null,
      secondaryMeasurement: { status: 'active', deviceName: 'USB Mic' },
      secondaryWindows: [{ type: 'window', window: 1 } as never],
      lastMeasurementChannels: [channel({ name: 'Room Mic' })],
    } as never);
    expect(secondary.primary?.label).toBe('USB Mic');
  });
});

describe('workspaceToolbarHTML', () => {
  it('renders Add track, the cap, and the advanced controls + arm cluster once tracks exist', () => {
    const html = workspaceToolbarHTML(makeBoardState());
    expect(html).toContain('id="live-ws-add"');
    expect(html).toContain('id="live-ws-cap">1 / 8 used</span>');
    expect(html).toContain('id="live-ws-new-group"');
    expect(html).toContain('id="live-ws-arm-count">1 / 1 armed</span>');
    expect(html).toContain('id="live-ws-arm-all"');
    expect(html).toContain('id="live-ws-disarm-all"');
  });

  it('omits advanced controls + the arm cluster at zero tracks', () => {
    const html = workspaceToolbarHTML(makeBoardState({ channelConfig: [] }));
    expect(html).not.toContain('live-ws-new-group');
    expect(html).not.toContain('live-ws-arm-count');
    expect(html).toContain('id="live-ws-add"');
  });

  it('disables Add at the device channel cap or mid-capture', () => {
    const full = workspaceToolbarHTML(makeBoardState({
      channelConfig: Array.from({ length: 8 }, () => strip()),
    }));
    expect(full).toMatch(/id="live-ws-add"[^>]* disabled/);
    const locked = workspaceToolbarHTML(makeBoardState({ isCapturing: true }));
    expect(locked).toMatch(/id="live-ws-add"[^>]* disabled/);
  });

  it('disables new-group mid-capture', () => {
    const html = workspaceToolbarHTML(makeBoardState({ isCapturing: true }));
    expect(html).toMatch(/id="live-ws-new-group"[^>]* disabled/);
  });

  it('disables the arm cluster only while recording (#757)', () => {
    const recording = workspaceToolbarHTML(makeBoardState({ isCapturing: true, liveMode: 'record' }));
    expect(recording).toMatch(/id="live-ws-arm-all"[^>]* disabled/);
    expect(recording).toMatch(/id="live-ws-disarm-all"[^>]* disabled/);
    const monitoring = workspaceToolbarHTML(makeBoardState({ isCapturing: true, liveMode: 'monitor' }));
    expect(monitoring).not.toMatch(/id="live-ws-arm-all"[^>]* disabled/);
  });
});

describe('setupStepsHTML / setupStepsView', () => {
  it('renders each step with done/active state, numbers, and the active hint', () => {
    const steps: SetupStep[] = [
      { key: 'device', label: 'Choose your input device', hint: 'h1', done: true },
      { key: 'track', label: 'Add a track', hint: 'h2', done: false, active: true },
    ];
    const html = setupStepsHTML(steps);
    expect(html).toContain('class="ls-step done"');
    expect(html).toContain('class="ls-step active"');
    // A completed step renders the check icon in place of its number; the
    // active step renders its ordinal.
    expect(html).toContain('stroke="currentColor"'); // check icon svg
    expect(html).toContain('>2</span>');
    expect(html).toContain('Choose your input device');
    expect(html).toContain('<span class="ls-hint">h2</span>');
    expect(html).not.toContain('<span class="ls-hint">h1</span>');
  });

  it('setupStepsView delegates to liveSetupState.setupSteps with the board state', () => {
    const spy = vi.spyOn(liveSetupState, 'setupSteps');
    setupStepsView(makeBoardState({ devices: DEVICES, liveMode: 'record' }));
    expect(spy).toHaveBeenCalledWith({ deviceReady: true, trackCount: 1, liveMode: 'record' });
  });
});

describe('heroHTML', () => {
  it('renders the zero-track hero with the first-track CTA', () => {
    const html = heroHTML(makeBoardState({ channelConfig: [] }));
    expect(html).toContain('live-setup-hero');
    expect(html).toContain('Set up your live check');
    expect(html).toContain('id="live-ws-add"');
    expect(html).toContain('Add your first track');
  });

  it('keeps the CTA enabled at zero tracks on an idle board', () => {
    const html = heroHTML(makeBoardState({ channelConfig: [] }));
    expect(html).not.toMatch(/id="live-ws-add"[^>]* disabled/);
  });
});

describe('bannerHTML', () => {
  it('renders the first-use banner when the guide is not complete and the board is idle', () => {
    const html = bannerHTML(makeBoardState());
    expect(html).toContain('id="live-setup-skip"');
    expect(html).toContain('Getting set up');
  });

  it('is empty once the guide has been completed', () => {
    liveSetupState.markSetupComplete(storage);
    expect(bannerHTML(makeBoardState())).toBe('');
  });

  it('is empty while capturing (the banner only exists while the board is idle)', () => {
    expect(bannerHTML(makeBoardState({ isCapturing: true }))).toBe('');
  });
});

describe('boardHTML', () => {
  it('renders idle placeholder channels with the idle container class when not capturing', () => {
    const html = boardHTML(makeBoardState({ channelConfig: [strip(), strip()] }));
    expect(html).toContain('class="meter-card sb-live-meters idle"');
    expect(html).toContain('live-setup-banner');
    expect((html.match(/data-ch="/g) || []).length).toBe(2);
    expect(html).toContain('>Idle<');
  });

  it('renders the tick channels without the idle class while capturing with data', () => {
    const tick = windowTick([channel({ name: 'Vocals' }), channel({ name: 'Band' })]);
    const html = boardHTML(makeBoardState({ isCapturing: true, lastTick: tick, lastLiveChannels: tick.channels as LiveMeterChannel[] }));
    expect(html).toContain('class="meter-card sb-live-meters"');
    expect(html).not.toContain('live-setup-banner');
    expect(html).toContain('Vocals');
    expect(html).toContain('Band');
  });

  it('falls back to idle channels while capturing before the first tick lands', () => {
    const html = boardHTML(makeBoardState({ isCapturing: true }));
    expect(html).toContain('class="meter-card sb-live-meters idle"');
  });
});

describe('dawShellHTML', () => {
  it('renders the transport/ruler/mix lane and per-input lane names from channelConfig', () => {
    const state = makeBoardState({
      channelConfig: [strip({ label: 'Kick' }), strip({ label: 'Vox' })],
    });
    const html = dawShellHTML(state);
    expect(html).toContain('class="daw-shell"');
    expect(html).toContain('daw-transport');
    expect(html).toContain('daw-ruler');
    expect(html).toContain('daw-mix-lane');
    expect(html).toContain('data-capture-mode="stopped"');
    expect(html).toContain('daw-lane-name">Kick</span>');
    expect(html).toContain('daw-lane-name">Vox</span>');
    expect(html).toContain('data-ch="0"');
    expect(html).toContain('daw-channel-waveform');
    expect(html).toContain('daw-mix-waveform');
  });

  it('escapes user-entered lane names before innerHTML', () => {
    const html = dawShellHTML(makeBoardState({ channelConfig: [strip({ label: '<script>Kick</script>' })] }));
    expect(html).toContain('daw-lane-name">&lt;script&gt;Kick&lt;/script&gt;</span>');
    expect(html).not.toContain('<script>Kick</script>');
  });

  it('renders the empty-state row at zero tracks', () => {
    const html = dawShellHTML(makeBoardState({ channelConfig: [] }));
    expect(html).toContain('Add tracks to see channel lanes');
  });

  it('bakes the transport chip + capture mode from live state', () => {
    const html = dawShellHTML(makeBoardState({ isCapturing: true, liveMode: 'record' }));
    expect(html).toContain('daw-transport-state-recording');
    expect(html).toContain('>Recording</span>');
    expect(html).toContain('data-capture-mode="recording"');
  });
});

describe('liveStatsRowView / fileStatsRowView', () => {
  it('live: formats rms/peak, renders DR as —, and tones clip/peak', () => {
    const view = liveStatsRowView(channel({ rms: -18, peak: -0.5, clipping: true, centroid: 2400 }));
    expect(view.rms).toEqual({ text: '-18.0', tone: '' });
    expect(view.peak).toEqual({ text: '-0.5', tone: 'issue' });
    expect(view.dr).toEqual({ text: '—', tone: '' });
    expect(view.clip).toEqual({ text: 'CLIP', tone: 'issue' });
    expect(view.centroid).toBe('2,400');
  });

  it('live: tones rms as check above -6 dBFS and falls back centroid to —', () => {
    const view = liveStatsRowView(channel({ rms: -3, peak: -10, centroid: undefined as unknown as number }));
    expect(view.rms).toEqual({ text: '-3.0', tone: 'check' });
    expect(view.centroid).toBe('—');
  });

  it('file: formats sox values with tones and the centroid from spectrum', () => {
    const sox = { rmsDbfs: -18, peakDbfs: -0.5, dynamicRangeDb: 12, clipping: false };
    const view = fileStatsRowView(sox, { spectralCentroid: 1200 });
    expect(view.rms).toEqual({ text: '-18.0', tone: '' });
    expect(view.peak).toEqual({ text: '-0.5', tone: 'issue' });
    expect(view.dr).toEqual({ text: '12.0', tone: '' });
    expect(view.clip).toEqual({ text: 'No', tone: '' });
    expect(view.centroid).toBe('1,200');
  });

  it('file: tones a loud rms as check and clipping as issue; DR under 6 dB tones check', () => {
    const view = fileStatsRowView({ rmsDbfs: -4, peakDbfs: -0.5, dynamicRangeDb: 4, clipping: true }, {});
    expect(view.rms.tone).toBe('check');
    expect(view.peak.tone).toBe('issue');
    expect(view.dr.tone).toBe('check');
    expect(view.clip).toEqual({ text: 'YES', tone: 'issue' });
  });

  it('file: missing sox/spectrum degrade to placeholders', () => {
    const view = fileStatsRowView(null, null);
    expect(view.rms.text).toBe('-∞');
    expect(view.centroid).toBe('—');
  });
});

describe('liveBoardShowing', () => {
  it('is true only while the live tab shows a running tick (not idle, not the DAW shell)', () => {
    const base = makeBoardState({
      isCapturing: true,
      lastTick: windowTick([channel()]),
      lastLiveChannels: [channel()],
    });
    expect(liveBoardShowing(base)).toBe(true);
    expect(liveBoardShowing({ ...base, isCapturing: false })).toBe(false);
    expect(liveBoardShowing({ ...base, lastTick: null })).toBe(false);
    expect(liveBoardShowing({ ...base, appMode: 'reportcard' })).toBe(false);
    expect(liveBoardShowing({
      ...base,
      settings: { ...base.settings, dawWorkspaceEnabled: true } as LiveBoardState['settings'],
    })).toBe(false);
  });
});

describe('liveAdjustmentsPanelHTML', () => {
  it('delegates to liveAdjustmentsState.panelHTML with the board state + coaching', () => {
    const spy = vi.spyOn(liveAdjustmentsState, 'panelHTML').mockReturnValue('<div class="live-adjustments-panel"></div>');
    const coaching = liveAdjustmentsState.createCoachingState();
    const state = makeBoardState({
      liveWindows: [windowTick([channel()])],
      lapCoaching: coaching,
      focusedInputIndex: 0,
    });
    const html = liveAdjustmentsPanelHTML(state);
    expect(html).toContain('live-adjustments-panel');
    expect(spy).toHaveBeenCalledWith(
      state.settings, 'live', state.liveWindows, null,
      expect.objectContaining({ focusedIndex: 0 }),
      coaching,
      expect.any(Number),
    );
  });
});

describe('idleChannelsFor', () => {
  it('builds one all-floor idle channel per configured strip', () => {
    const idle = idleChannelsFor([strip(), strip()]);
    expect(idle).toHaveLength(2);
    expect(idle[0].idle).toBe(true);
    expect(idle[0].bands.sub_bass).toBe(-120);
  });
});
