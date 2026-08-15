// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Live-workspace board + docked-EQ-pane + stats-row rendering module (slice
// 6g, #710): the live board surface moved out of inline-app.js's imperative
// renderers and onto React components driven by liveCaptureStore, with every
// per-tick DOM write staying on the ADR-0005 rAF patch path. This module
// follows the live-capture-panel.ts / spectrum-display.ts extraction pattern:
// the PURE views take a LiveBoardState view-input shape (built by
// liveBoardState() from the stores) and read classic scripts off `window` via
// typed accessors (same style as liveCaptureStore.ts reads armState/
// groupState); the c8-ignored DOM appliers (patchBoardTick/patchEqPane/
// patchStatsRow) are the per-tick writers driven by LiveWorkspace's
// live-meter-controller, never through React state.

import {
  LIVE_BAND_KEYS,
  deviceChannelCount,
  liveMetersHTML,
  measurementChannel,
  measurementSourceOptionLabel,
  eqPaneView,
  eqPaneHTML,
  eqPaneSignature,
  eqPanePatchPlan,
  patchLiveChannel,
  groupSummary,
  groupSummaryText,
  usedChannelCount,
  type StripConfig,
  type ChannelGroup,
  type LiveDevice,
  type LiveEvent,
  type LiveMeterChannel,
  type StripView,
  type PanelView,
  type EqPaneRoomOverride,
  type EqPanePatchPlan,
} from './live-capture-panel';
import { escapeHtml, patchBarsAndLabels, patchGridBarsAndBandLabels, type SpectrumCurvePaths } from './spectrum-display';
import { iconSvg, fmt } from './report-card';
import { useLiveCaptureStore, deviceNameFor, type LiveCaptureState } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import type { AppSettings } from '../../electron/ipc/api';

/* ── Typed `window.*` accessors for the pure helper classic-scripts ──
 * Mirrors liveCaptureStore.ts's getArmState()-style accessors: these modules
 * are boot-injected once (App.tsx's BOOT_SCRIPTS) and read off `window`
 * rather than imported, so live-board shares the exact same instance
 * inline-app.js reads. */

interface LiveSetupStateApi {
  showAdvancedControls(trackCount: number): boolean;
  setupSteps(view: { deviceReady: boolean; trackCount: number; liveMode: string }): SetupStep[];
  shouldShowGuide(storage: Storage): boolean;
  markSetupComplete(storage: Storage): void;
}
interface TrackWorkspaceApi {
  idleChannel(bandKeys: string[]): LiveMeterChannel;
  addEnabled(usedChannels: number, totalChannels: number, capturing: boolean): boolean;
  isEmpty(configuredCount: number): boolean;
}
interface ArmStateApi {
  stripToken(strip: StripConfig): string;
  isArmed(strip: StripConfig | null | undefined): boolean;
  armedCount(cfg: StripConfig[]): number;
}
interface GroupStateApi {
  groupOf(groups: ChannelGroup[], idx: number): number;
  isGroupCollapsed(groups: ChannelGroup[], g: number): boolean;
}
interface InstrumentProfilesApi {
  PROFILES: Array<{ id: string; label: string }>;
  profileById(id: string): { id: string; label: string; bands?: Record<string, number> };
  effectiveProfileId(overridesForDevice: Record<string, string>, token: string, label?: string): string;
  isKnownProfileId(id: string): boolean;
}
interface RigReconcileApi {
  resolveStripLabel(strip: StripConfig | null, ch: LiveMeterChannel | null, index: number): string;
}
interface LiveAdjustmentsStateApi {
  panelHTML(
    settings: AppSettings | null,
    mode: string,
    windows: LiveEvent[],
    measurementSource: number | null,
    focusView: LapFocusView,
    coaching: unknown,
    now: number,
  ): string;
  observationContext(windows: LiveEvent[], measurementSource: number | null, focusView: LapFocusView, sourceName: string): unknown;
}
interface DawWorkspaceStateApi {
  showShell(settings: AppSettings | null, mode: string): boolean;
  transportLabel(liveRunning: boolean, liveMode: string): string;
}
interface DawWaveformStateApi {
  captureModeToken(liveRunning: boolean, liveMode: string): string;
}
interface DawPlayheadStateApi {
  formatElapsed(ms: number): string;
}
interface MeasurementDeviceStateApi {
  roomPaneOverride(
    secondaryActive: boolean,
    secondaryWindows: LiveEvent[],
    lastMeasurementChannels: LiveMeterChannel[] | null,
    deviceName: string,
  ): EqPaneRoomOverride | null;
}

function getLiveSetupState(): LiveSetupStateApi {
  return (window as unknown as { liveSetupState: LiveSetupStateApi }).liveSetupState;
}
function getTrackWorkspace(): TrackWorkspaceApi {
  return (window as unknown as { trackWorkspace: TrackWorkspaceApi }).trackWorkspace;
}
function getArmState(): ArmStateApi {
  return (window as unknown as { armState: ArmStateApi }).armState;
}
function getGroupState(): GroupStateApi {
  return (window as unknown as { groupState: GroupStateApi }).groupState;
}
function getInstrumentProfiles(): InstrumentProfilesApi {
  return (window as unknown as { instrumentProfiles: InstrumentProfilesApi }).instrumentProfiles;
}
function getRigReconcile(): RigReconcileApi {
  return (window as unknown as { rigReconcile: RigReconcileApi }).rigReconcile;
}
function getLiveAdjustmentsState(): LiveAdjustmentsStateApi {
  return (window as unknown as { liveAdjustmentsState: LiveAdjustmentsStateApi }).liveAdjustmentsState;
}
function getDawWorkspaceState(): DawWorkspaceStateApi {
  return (window as unknown as { dawWorkspaceState: DawWorkspaceStateApi }).dawWorkspaceState;
}
function getDawWaveformState(): DawWaveformStateApi {
  return (window as unknown as { dawWaveformState: DawWaveformStateApi }).dawWaveformState;
}
function getDawPlayheadState(): DawPlayheadStateApi {
  return (window as unknown as { dawPlayheadState: DawPlayheadStateApi }).dawPlayheadState;
}
function getMeasurementDeviceState(): MeasurementDeviceStateApi {
  return (window as unknown as { measurementDeviceState: MeasurementDeviceStateApi }).measurementDeviceState;
}

/* ── Views ── */

export interface SetupStep {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  active?: boolean;
}

export interface LapFocusView {
  focusedIndex: number | null;
  inputs: Array<{ index: number; name: string; profile: unknown }>;
}

export interface LiveStatsRowView {
  rms: { text: string; tone: string };
  peak: { text: string; tone: string };
  dr: { text: string; tone: string };
  clip: { text: string; tone: string };
  centroid: string;
}

// The view-input shape the pure functions take — everything the board
// rendering needs, built from liveCaptureStore + useSettingsStore by
// liveBoardState() (mirroring what inline-app.js's module-level vars held).
// Per-tick fields (lastTick/lastLiveChannels/lastMeasurementChannels/
// liveWindows) are read as one-time snapshots at render time, never
// subscribed (ADR-0005).
export interface LiveBoardState {
  appMode: string;
  isCapturing: boolean;
  liveMode: 'monitor' | 'record';
  channelConfig: StripConfig[];
  channelGroups: ChannelGroup[];
  selectedChannel: number | null;
  measurementSource: number | null;
  selectedDevice: string;
  devices: LiveDevice[];
  settings: AppSettings | null;
  lastTick: LiveEvent | null;
  lastLiveChannels: LiveMeterChannel[] | null;
  liveWindows: LiveEvent[];
  lapCoaching: unknown;
  focusedInputIndex: number | null;
  secondaryActive: boolean;
  secondaryWindows: LiveEvent[];
  lastMeasurementChannels: LiveMeterChannel[] | null;
  secondaryDeviceName: string;
}

// Resolves the selected device's name ('' = Default Device), mirroring
// inline-app.js's selectedDeviceName() and liveCaptureStore's deviceNameFor.
function selectedDeviceName(state: LiveBoardState): string {
  return deviceNameFor(state.selectedDevice, state.devices);
}

// The persisted instrument-profile overrides (#524) saved for the currently
// selected device, mirroring inline-app.js's savedInstrumentProfilesForDevice().
function savedInstrumentProfilesForDevice(state: LiveBoardState): Record<string, string> {
  return ((state.settings || {}).inputInstrumentProfiles || {})[selectedDeviceName(state)] || {};
}

export function idleChannelsFor(config: StripConfig[]): LiveMeterChannel[] {
  return config.map(() => getTrackWorkspace().idleChannel(LIVE_BAND_KEYS));
}

// Exported for the React components: the DAW-shell gate, the empty-config
// hero gate, the first-use banner dismiss write, and strip-name resolution —
// thin wrappers over the typed accessors so the components never touch window.
export function dawShellShowing(settings: AppSettings | null, appMode: string): boolean {
  return getDawWorkspaceState().showShell(settings, appMode);
}
export function workspaceIsEmpty(config: StripConfig[]): boolean {
  return getTrackWorkspace().isEmpty(config.length);
}
export function markSetupGuideComplete(storage: Storage): void {
  getLiveSetupState().markSetupComplete(storage);
}
export function resolveStripName(strip: StripConfig | null, ch: LiveMeterChannel | null, idx: number): string {
  return getRigReconcile().resolveStripLabel(strip, ch, idx);
}

// Strip view adapter — port of inline-app.js's stripViewAt(idx, ch), taking
// its inputs as one StripViewInput struct instead of reading the module-level
// vars (#307 pattern).
export function stripViewAt(input: StripViewInput): StripView {
  const { index: idx, ch, channelConfig, channelGroups, selectedChannel, savedInstrumentProfiles } = input;
  const groupIndex = getGroupState().groupOf(channelGroups, idx);
  const token = channelConfig[idx] ? getArmState().stripToken(channelConfig[idx]) : String(idx);
  return {
    strip: channelConfig[idx] || null,
    displayName: getRigReconcile().resolveStripLabel(channelConfig[idx], ch, idx),
    selected: selectedChannel === idx,
    armed: getArmState().isArmed(channelConfig[idx]),
    groupIndex,
    groupCollapsed: getGroupState().isGroupCollapsed(channelGroups, groupIndex),
    instrumentProfileId: getInstrumentProfiles().effectiveProfileId(savedInstrumentProfiles, token, channelConfig[idx] && channelConfig[idx].label),
    instrumentAuto: !(savedInstrumentProfiles[token] && getInstrumentProfiles().isKnownProfileId(savedInstrumentProfiles[token])),
  };
}

// Panel view adapter — port of inline-app.js's livePanelView().
export function livePanelView(input: LivePanelViewInput): PanelView {
  return {
    deviceChannels: input.deviceChannels,
    liveRunning: input.liveRunning,
    groups: input.channelGroups,
    instrumentProfiles: getInstrumentProfiles().PROFILES.map((p) => ({ id: p.id, label: p.label })),
  };
}

// The channel array backing the EQ pane right now (#668): a live tick's
// channels while any have arrived this session, else the idle placeholder set —
// the same fallback liveChannelAt() uses for the #39 name resolution, kept in
// one place so every patch/render call site agrees on "current". Port of
// inline-app.js's currentEqPaneChannels().
export function currentPaneChannels(
  lastLiveChannels: LiveMeterChannel[] | null | undefined,
  channelConfig: StripConfig[],
): LiveMeterChannel[] {
  return lastLiveChannels && lastLiveChannels.length > 0 ? lastLiveChannels : idleChannelsFor(channelConfig);
}

// Focused-input view for the per-input instrument-aware adjustment candidates
// panel (#525) — port of inline-app.js's lapFocusView().
export function lapFocusView(input: LapFocusInput): LapFocusView {
  const { focusedIndex, channelConfig, channels, savedInstrumentProfiles } = input;
  const profs = getInstrumentProfiles();
  return {
    focusedIndex,
    inputs: channelConfig.map((strip, idx) => ({
      index: idx,
      name: getRigReconcile().resolveStripLabel(strip, channels ? channels[idx] : null, idx),
      profile: profs.profileById(
        profs.effectiveProfileId(savedInstrumentProfiles, getArmState().stripToken(strip), strip && strip.label)),
    })),
  };
}

// Observation context for #614 — port of inline-app.js's lapObservationContext().
export function lapObservationContext(
  windows: LiveEvent[],
  measurementSource: number | null,
  focusView: LapFocusView,
): unknown {
  const idx = measurementSource == null ? 0 : measurementSource;
  // The source display label the evaluation context carries: the focused
  // input's resolved name for the resolved measurement source strip.
  const sourceName = focusView.inputs[idx]?.name ?? '';
  return getLiveAdjustmentsState().observationContext(windows, measurementSource, focusView, sourceName);
}

// Shared "Add track" disabled rule (device channel cap or a capture running,
// #38) — port of inline-app.js's addTrackDisabled().
export function addTrackDisabled(state: LiveBoardState): boolean {
  const used = usedChannelCount(state.channelConfig);
  const total = deviceChannelCount(state.selectedDevice, state.devices);
  return !getTrackWorkspace().addEnabled(used, total, state.isCapturing);
}

// Shared by the idle workspace and the running live board (#188) — port of
// inline-app.js's liveWorkspaceToolbarHTML(). Advanced controls + the arm
// cluster are gated behind showAdvancedControls(trackCount > 0); the arm
// cluster renders always once tracks exist (#757) with the record-disable
// rule preserved verbatim.
export function workspaceToolbarHTML(state: LiveBoardState): string {
  const total = deviceChannelCount(state.selectedDevice, state.devices);
  const used = usedChannelCount(state.channelConfig);
  const addDisabled = addTrackDisabled(state);
  const advanced = getLiveSetupState().showAdvancedControls(state.channelConfig.length);
  const armHTML = advanced
    ? `<span class="live-ws-arm">`
      + `<span class="arm-count" id="live-ws-arm-count">${getArmState().armedCount(state.channelConfig)} / ${state.channelConfig.length} armed</span>`
      + `<button type="button" class="ghost-btn sm" id="live-ws-arm-all"${state.isCapturing && state.liveMode === 'record' ? ' disabled' : ''} title="Arm every track for recording">Arm all</button>`
      + `<button type="button" class="ghost-btn sm" id="live-ws-disarm-all"${state.isCapturing && state.liveMode === 'record' ? ' disabled' : ''} title="Disarm every track">Disarm all</button>`
      + `</span>`
    : '';
  return `<div class="live-meters-toolbar">`
    + `<button type="button" class="ghost-btn" id="live-ws-add"${addDisabled ? ' disabled' : ''}>+ Add track</button>`
    + (advanced ? `<button type="button" class="ghost-btn" id="live-ws-new-group"${state.isCapturing ? ' disabled' : ''} title="Create a named channel group">+ New group</button>` : '')
    + `<span class="cap" id="live-ws-cap">${used} / ${total} used</span>`
    + armHTML
    + `</div>`;
}

// Shared renderer for the guided first-use setup's 3-step list (#294) — port
// of inline-app.js's liveSetupStepsHTML().
export function setupStepsHTML(steps: SetupStep[]): string {
  return steps.map((s, i) =>
    `<li class="ls-step${s.done ? ' done' : ''}${s.active ? ' active' : ''}">`
    + `<span class="ls-num">${s.done ? iconSvg('check', 12) : i + 1}</span>`
    + `<span class="ls-body"><span class="ls-label">${s.label}</span>`
    + (s.active ? `<span class="ls-hint">${s.hint}</span>` : '')
    + `</span></li>`).join('');
}

// View adapter bridging the board state onto the setupSteps() view shape
// (#294) — port of inline-app.js's liveSetupStepsView().
export function setupStepsView(state: LiveBoardState): SetupStep[] {
  return getLiveSetupState().setupSteps({
    deviceReady: state.devices.length > 0,
    trackCount: state.channelConfig.length,
    liveMode: state.liveMode,
  });
}

// Zero-track hero (#294) — port of inline-app.js:498-508.
export function heroHTML(state: LiveBoardState): string {
  const addDisabled = addTrackDisabled(state);
  return `<div class="live-setup-hero">`
    + iconSvg('radio', 34)
    + `<h2 class="lsh-title">Set up your live check</h2>`
    + `<p class="lsh-sub">Three steps from silence to live meters.</p>`
    + `<ol class="ls-steps">${setupStepsHTML(setupStepsView(state))}</ol>`
    + `<button type="button" class="btn btn-primary" id="live-ws-add"${addDisabled ? ' disabled' : ''}>${iconSvg('plus', 16)}Add your first track</button>`
    + `</div>`;
}

// First-use banner (#294) — port of inline-app.js:516-522. Gated on the guide
// not being completed AND the board being idle (isCapturing false): the banner
// can only exist while the board is idle.
export function bannerHTML(state: LiveBoardState): string {
  if (state.isCapturing || !getLiveSetupState().shouldShowGuide(window.localStorage)) return '';
  return `<div class="live-setup-banner" role="note">`
    + `<span class="lsb-title">Getting set up</span>`
    + `<ol class="ls-steps compact">${setupStepsHTML(setupStepsView(state))}</ol>`
    + `<button type="button" class="ghost-btn sm" id="live-setup-skip">Dismiss</button>`
    + `</div>`;
}

// The idle/running meter workspace: banner (idle only) + toolbar + the
// meter-card. Channels are the tick's when capturing with data, else the idle
// placeholder set; the `idle` container class is present exactly when using
// idle channels (mirrors renderLiveWorkspace vs renderLiveMeters).
export function boardHTML(state: LiveBoardState): string {
  const config = state.channelConfig;
  const usingIdle = !(state.isCapturing && state.lastTick?.channels?.length);
  const channels = usingIdle ? idleChannelsFor(config) : state.lastTick!.channels as LiveMeterChannel[];
  const savedProfiles = savedInstrumentProfilesForDevice(state);
  const stripViews = channels.map((c, i) => stripViewAt({
    index: i,
    ch: c,
    channelConfig: config,
    channelGroups: state.channelGroups,
    selectedChannel: state.selectedChannel,
    savedInstrumentProfiles: savedProfiles,
  }));
  return bannerHTML(state)
    + workspaceToolbarHTML(state)
    + `<div class="meter-card sb-live-meters${usingIdle ? ' idle' : ''}">${liveMetersHTML(channels, stripViews, livePanelView({
      deviceChannels: deviceChannelCount(state.selectedDevice, state.devices),
      liveRunning: state.isCapturing,
      channelGroups: state.channelGroups,
    }))}</div>`;
}

// Timeline-oriented DAW shell markup (#517, epic #515) — port of
// inline-app.js's renderDawShell() markup only (no playhead/waveform drawing,
// that stays 6j). Lane names use escapeHtml(stripLabel(...)); the transport
// chip and capture-mode marker are baked from the classic-script state helpers.
export function dawShellHTML(state: LiveBoardState): string {
  const laneNames = state.channelConfig.map((strip, idx) =>
    escapeHtml(getRigReconcile().resolveStripLabel(strip, state.lastLiveChannels ? state.lastLiveChannels[idx] : null, idx)));
  const transportChip = getDawWorkspaceState().transportLabel(state.isCapturing, state.liveMode);
  const captureMode = getDawWaveformState().captureModeToken(state.isCapturing, state.liveMode);
  const laneHTML = state.channelConfig.length > 0
    ? `<div class="daw-channel-lanes">${state.channelConfig.map((_strip, idx) =>
      `<div class="daw-lane daw-channel-lane" data-ch="${idx}">`
      + `<span class="daw-lane-name">${laneNames[idx]}</span>`
      + `<span class="daw-lane-body"><canvas class="daw-channel-waveform"></canvas></span>`
      + `</div>`).join('')}</div>`
    : `<div class="daw-lane daw-empty-state">Add tracks to see channel lanes</div>`;
  // The transport time is seeded 0:00 in markup and patched by the 6j
  // renderDawPlayhead (via window.liveDawShellRepaint) before paint, so a
  // mid-capture React rebuild never flashes stale elapsed time (#518).
  const seededElapsed = getDawPlayheadState().formatElapsed(0);
  return `<div class="daw-shell">`
    + `<div class="daw-transport">`
    + `<span class="daw-transport-title">Live Workspace</span>`
    + `<span class="daw-transport-state daw-transport-state-${transportChip.toLowerCase()}">${transportChip}</span>`
    + `<span class="daw-transport-time">${seededElapsed}</span>`
    + `<span class="daw-transport-hint">Start and stop recording from the top-bar Record button</span>`
    + `</div>`
    + `<div class="daw-playhead"></div>`
    + `<div class="daw-ruler"></div>`
    + `<div class="daw-lane daw-mix-lane" data-capture-mode="${captureMode}">`
    + `<span class="daw-lane-name">Overall mix</span>`
    + `<span class="daw-lane-body"><canvas class="daw-mix-waveform"></canvas></span>`
    + `</div>`
    + laneHTML
    + `</div>`;
}

// Live stats-row view — port of inline-app.js's updateLiveStatsRow() (1008).
export function liveStatsRowView(ch: LiveMeterChannel): LiveStatsRowView {
  return {
    rms: { text: fmt(ch.rms), tone: ch.rms > -6 ? 'check' : '' },
    peak: { text: fmt(ch.peak), tone: ch.peak > -1 ? 'issue' : '' },
    dr: { text: '—', tone: '' },
    clip: { text: ch.clipping ? 'CLIP' : 'No', tone: ch.clipping ? 'issue' : '' },
    centroid: ch.centroid ? Math.round(ch.centroid).toLocaleString() : '—',
  };
}

// File stats-row view — port of inline-app.js's updateStatsRow() (996).
export function fileStatsRowView(
  sox: Record<string, unknown> | null | undefined,
  spectrum: Record<string, unknown> | null | undefined,
): LiveStatsRowView {
  const rmsDbfs = typeof sox?.rmsDbfs === 'number' ? sox.rmsDbfs : NaN;
  const peakDbfs = typeof sox?.peakDbfs === 'number' ? sox.peakDbfs : NaN;
  const drDb = typeof sox?.dynamicRangeDb === 'number' ? sox.dynamicRangeDb : NaN;
  const clipping = !!(sox && sox.clipping);
  const centroid = spectrum && typeof spectrum.spectralCentroid === 'number'
    ? Math.round(spectrum.spectralCentroid).toLocaleString()
    : '—';
  return {
    rms: { text: fmt(rmsDbfs), tone: rmsDbfs > -6 ? 'check' : '' },
    peak: { text: fmt(peakDbfs), tone: peakDbfs > -1 ? 'issue' : '' },
    dr: { text: fmt(drDb), tone: drDb < 6 ? 'check' : '' },
    clip: { text: clipping ? 'YES' : 'No', tone: clipping ? 'issue' : '' },
    centroid,
  };
}

// Builds the LiveBoardState from the stores + classic-script accessors —
// mirrors what inline-app.js's old module-level vars held.
export function liveBoardState(): LiveBoardState {
  return boardStateFrom(useLiveCaptureStore.getState());
}

// The LiveStatsRow display rule: the meter board is "showing" (so the header
// stats-row/ideal-profile-wrap are visible) only while the live tab is active,
// the DAW shell isn't on, and a live tick with channels is flowing — mirrors
// renderLiveMeters (flex) vs renderLiveWorkspace/renderDawShell (none).
export function liveBoardShowing(state: LiveBoardState): boolean {
  return state.appMode === 'live'
    && !getDawWorkspaceState().showShell(state.settings, state.appMode)
    && state.isCapturing
    && !!state.lastTick?.channels?.length;
}

// Resolves the EQ pane's channel set the same way the board resolves its own
// (tick channels while capturing, idle placeholders otherwise) so React's
// LiveEqPane render and the patchEqPane applier always converge.
export function eqPaneChannelsFor(state: LiveCaptureState): LiveMeterChannel[] {
  if (!state.isCapturing) return idleChannelsFor(state.channelConfig);
  return currentPaneChannels(state.lastTick?.channels ?? state.lastLiveChannels, state.channelConfig);
}

// The full EqPaneView the controller's patchEqPane writes and LiveEqPane
// renders — port of inline-app.js's renderEqPane() view resolution (channels,
// measurement source, selected channel, and the #460 secondary Room override).
export function eqPaneViewFor(state: LiveCaptureState): EqPaneView {
  const channels = eqPaneChannelsFor(state);
  const secondaryActive = state.secondaryMeasurement.status === 'active' && state.secondaryWindows.length > 0;
  const roomOverride = secondaryActive
    ? getMeasurementDeviceState().roomPaneOverride(
      secondaryActive,
      state.secondaryWindows,
      state.lastMeasurementChannels,
      state.secondaryMeasurement.deviceName,
    )
    : null;
  return eqPaneView(channels, state.channelConfig, state.measurementSource, state.selectedChannel, roomOverride);
}

function boardStateFrom(state: LiveCaptureState): LiveBoardState {
  return {
    appMode: state.appMode,
    isCapturing: state.isCapturing,
    liveMode: state.liveMode,
    channelConfig: state.channelConfig,
    channelGroups: state.channelGroups,
    selectedChannel: state.selectedChannel,
    measurementSource: state.measurementSource,
    selectedDevice: state.selectedDevice,
    devices: state.devices,
    settings: useSettingsStore.getState().settings,
    lastTick: state.lastTick,
    lastLiveChannels: state.lastLiveChannels,
    liveWindows: state.liveWindows,
    lapCoaching: state.lapCoaching,
    focusedInputIndex: state.focusedInputIndex,
    secondaryActive: state.secondaryMeasurement.status === 'active' && state.secondaryWindows.length > 0,
    secondaryWindows: state.secondaryWindows,
    lastMeasurementChannels: state.lastMeasurementChannels,
    secondaryDeviceName: state.secondaryMeasurement.deviceName,
  };
}

// The live adjustments panel HTML the components append after the board/shell
// — port of inline-app.js's syncLiveAdjustmentsPanel()'s panelHTML call, with
// the coaching/focused-input views resolved from store state.
export function liveAdjustmentsPanelHTML(state: LiveBoardState): string {
  const savedProfiles = savedInstrumentProfilesForDevice(state);
  return getLiveAdjustmentsState().panelHTML(
    state.settings,
    state.appMode,
    state.liveWindows,
    state.measurementSource,
    lapFocusView({
      focusedIndex: state.focusedInputIndex,
      channelConfig: state.channelConfig,
      channels: state.lastLiveChannels,
      savedInstrumentProfiles: savedProfiles,
    }),
    state.lapCoaching,
    Date.now(),
  );
}

/* ══ Per-tick DOM appliers (ADR-0005) ══
 * Driven by LiveWorkspace's createLiveMeterController patch() — one coalesced
 * store snapshot per animation frame writes every per-tick value straight to
 * the React-rendered DOM, never through React state. Same precedent as
 * live-capture-panel.ts's patchLiveChannel: no jsdom in this harness
 * (renderToString only), so each applier is c8-ignored with its e2e gate
 * named. */

/* c8 ignore start -- DOM-patching applier, no jsdom in this harness (same
   precedent as live-capture-panel.ts's patchLiveChannel); exercised by
   tests/e2e/live-capture.spec.ts + named-channel-groups.spec.ts. */
function patchEqPaneSection(sectionEl: Element | null, patch: EqPanePatchPlan['primary']): void {
  if (!sectionEl || !patch) return;
  const chart = sectionEl.querySelector('.veq-chart');
  if (chart) {
    const lineEl = chart.querySelector('.sb-curve-line');
    if (patch.arc && lineEl) {
      const paths = patch.arc as SpectrumCurvePaths;
      lineEl.setAttribute('d', paths.line);
      const fill = chart.querySelector('.sb-curve-fill');
      if (fill) fill.setAttribute('d', paths.area);
      const centroid = chart.querySelector('.sb-centroid');
      if (centroid) centroid.innerHTML = paths.centroidMark;
    } else {
      chart.innerHTML = typeof patch.arc === 'string' ? patch.arc : '';
    }
  }
  if (patch.gridDb) patchGridBarsAndBandLabels(sectionEl, patch.gridDb, patch.loudestIdx);
  else patchBarsAndLabels(sectionEl, patch.curve.db);
}

function setStat(root: Element, id: string, value: string, tone: string): void {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = value;
  el.className = 'stat-num' + (tone ? ' ' + tone : '');
}
/* c8 ignore stop */

// The pure "what changed" plan for one coalesced tick on the board (slice 6g
// #710) — the per-strip view + group-summary deltas, computed once per tick and
// consumed by patchLiveBoard. Fully unit-tested; the applier is c8-ignored.
export interface LiveBoardPatchPlan {
  stripViews: StripView[];
  summaries: Array<{ group: number; text: string; clipping: boolean }>;
}

export function liveBoardPatchPlan(tick: LiveEvent, deps: LiveBoardDeps): LiveBoardPatchPlan {
  const channels = (tick.channels ?? []) as LiveMeterChannel[];
  const stripViews = channels.map((ch, i) => stripViewAt({
    index: i,
    ch,
    channelConfig: deps.channelConfig,
    channelGroups: deps.channelGroups,
    selectedChannel: deps.selectedChannel,
    savedInstrumentProfiles: deps.savedInstrumentProfiles,
  }));
  const summaries = deps.channelGroups.map((grp, g) => {
    const summary = groupSummary(channels, grp.members);
    return { group: g, text: groupSummaryText(summary), clipping: summary.clipping };
  });
  return { stripViews, summaries };
}

/* c8 ignore start -- DOM-patching applier, no jsdom in this harness; exercised
   by tests/e2e/live-capture.spec.ts (board strips patch in place between
   ticks, group summaries refresh) + named-channel-groups.spec.ts. */
export function patchLiveBoard(root: Element, tick: LiveEvent, deps: LiveBoardDeps): void {
  const channels = tick.channels;
  if (!channels || channels.length === 0) return;
  const stripEls = root.querySelectorAll('.sb-live-meters .live-ch');
  if (stripEls.length !== channels.length) return;
  const plan = liveBoardPatchPlan(tick, deps);
  channels.forEach((ch, i) => {
    const el = root.querySelector(`.sb-live-meters .live-ch[data-ch="${i}"]`);
    if (el) patchLiveChannel(el, ch, i, plan.stripViews[i], deps.isCapturing);
  });
  plan.summaries.forEach((s) => {
    const summaryEl = root.querySelector(`.sb-live-meters .live-group-head[data-group="${s.group}"] .live-group-summary`);
    if (!summaryEl) return;
    summaryEl.textContent = s.text;
    if (s.clipping) summaryEl.insertAdjacentHTML('beforeend', '<span class="live-ch-clip">CLIP</span>');
  });
}
/* c8 ignore stop */

/* c8 ignore start -- DOM-patching applier, no jsdom in this harness; exercised
   by tests/e2e/live-capture.spec.ts (the "a new tick updates bars and arc in
   place" case asserts the .sb-spectrum-curve node is patched, never rebuilt). */
export function patchEqPane(root: Element, view: EqPaneView): void {
  const signature = eqPaneSignature(view);
  if (root.dataset.signature !== signature) {
    root.innerHTML = eqPaneHTML(view);
    root.dataset.signature = signature;
    return;
  }
  const plan = eqPanePatchPlan(view);
  patchEqPaneSection(root.querySelector('.eq-pane-primary'), plan.primary);
  patchEqPaneSection(root.querySelector('.eq-pane-secondary'), plan.secondary);
}
/* c8 ignore stop */

/* c8 ignore start -- DOM-patching applier, no jsdom in this harness; exercised
   by tests/e2e/live-capture.spec.ts (live stats cells update at meter cadence,
   row visibility follows the board). */
export function patchStatsRow(root: Element, view: LiveStatsRowView): void {
  setStat(root, 'stat-rms', view.rms.text, view.rms.tone);
  setStat(root, 'stat-peak', view.peak.text, view.peak.tone);
  setStat(root, 'stat-dr', view.dr.text, view.dr.tone);
  setStat(root, 'stat-clip', view.clip.text, view.clip.tone);
  const centroidEl = root.querySelector('#stat-centroid');
  if (centroidEl) centroidEl.textContent = view.centroid;
}
/* c8 ignore stop */
1786763791
