// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure board-level view adapters + HTML builders + stats-row views for the
// live-capture workspace (TD-001 slice 6g, #710). Ports the functions
// inline-app.js used to own (renderLiveWorkspace/renderLiveMeters/
// renderDawShell/syncLiveAdjustmentsPanel/stripViewAt/livePanelView/
// lapFocusView/lapObservationContext/liveWorkspaceToolbarHTML/
// liveSetupStepsHTML/liveSetupStepsView/addTrackDisabled/setStat/
// updateStatsRow/updateLiveStatsRow) as pure derivations taking one
// LiveWorkspaceViewState snapshot parameter (constitution: pure functions
// preferred, side effects injected) so they're unit-testable and reusable by
// both the React LiveCapturePanel island and the still-inline meter
// controller. Per-tick meter values never pass through here at animation rate
// — the createLiveMeterController patch callback applies them straight to the
// DOM (ADR-0005). The classic-script helpers (trackWorkspace/groupState/
// armState/rigReconcile/instrumentProfiles/liveSetupState/
// liveAdjustmentsState/dawWorkspaceState/dawPlayheadState/dawWaveformState)
// are read off `window` via typed accessors, mirroring
// liveCaptureStore.ts's getArmState() pattern — never bare `any`.

import {
  LIVE_BAND_KEYS,
  deviceChannelCount,
  usedChannelCount,
  groupSummary,
  groupSummaryText,
  levelPercent,
  measurementSourceOptionLabel,
  type LiveDevice,
  type StripConfig,
  type ChannelGroup,
  type LiveEvent,
  type LiveMeterChannel,
  type StripView,
  type PanelView,
  type EqPaneLevelTilesView,
  type ChannelFlagMap,
} from './live-capture-panel';
import { escapeHtml } from './spectrum-display';
import { fmt, iconSvg } from './report-card';
import type { AppSettings } from '../../electron/ipc/api';
import { dawRulerTicks, dawLaneGridlines, DAW_TIMELINE_SPAN_SECS, DAW_TIMELINE_ORIGIN_PX, type DawShellRuntime } from './daw-shell-runtime';
import { sessionTabSessionPickerHTML, type SessionTabSessionPickerView } from './session-tab-session-picker';
import type { SessionTabWaveformClip, SessionTabWaveformView } from './session-tab-waveforms';
import { sessionTabPlaybackHTML, type SessionTabPlaybackView } from './session-tab-playback';
import { sessionTabCaptureHTML, recordButtonView } from './record-transport';
import type { CapturePhase } from './LiveControls';

export type { DawShellRuntime } from './daw-shell-runtime';

// One immutable snapshot of everything a board-level view derivation reads.
// Discrete board shape comes from liveCaptureStore; lastTick/lastLiveChannels
// are the animation-rate values a React render reads imperatively (never via
// subscription); liveWindows/settings/lapCoaching feed the adjustments panel.
export interface LiveWorkspaceViewState {
  channelConfig: StripConfig[];
  channelGroups: ChannelGroup[];
  devices: LiveDevice[];
  selectedDevice: string;
  /** True when the board should render as live — capturing, or holding the
   *  running shape across a record→monitor demote (#847). See boardRunning(). */
  isCapturing: boolean;
  liveMode: 'monitor' | 'record';
  appMode: string;
  selectedChannel: number | null;
  measurementSource: number | null;
  focusedInputIndex: number | null;
  mutedChannels: ChannelFlagMap;
  soloedChannels: ChannelFlagMap;
  lastTick: LiveEvent | null;
  lastLiveChannels: LiveMeterChannel[] | null;
  liveWindows: LiveEvent[];
  settings: AppSettings | null;
  lapCoaching: unknown;
  /** Seeded elapsed time (ms) for the DAW shell's transport readout — read
   *  imperatively from the 6j playhead bridge at render time so a mid-capture
   *  rebuild never flashes 0:00 (#518). */
  playheadElapsedMs: number;
  sessionPicker: SessionTabSessionPickerView | null;
  sessionWaveforms: SessionTabWaveformView | null;
  sessionPlayback: SessionTabPlaybackView | null;
  /** Discrete shared capture phase for the Session Record control. */
  capturePhase: CapturePhase;
  /** Transient mounted-Session state for the routing drawer shell. */
  sessionRoutingDrawerOpen: boolean;
}

// The slice of liveCaptureStore's state that liveWorkspaceViewState() reads —
// named here instead of importing LiveCaptureState so this pure module stays
// free of a dependency on the store that consumes it (mirrors
// deviceNameFor/savedInstrumentProfilesForDevice's existing pattern below).
export interface LiveWorkspaceStoreSlice {
  channelConfig: StripConfig[];
  channelGroups: ChannelGroup[];
  devices: LiveDevice[];
  selectedDevice: string;
  isCapturing: boolean;
  // Transient: true for the whole record→monitor demote (#847) — see
  // liveCaptureStore.ts and boardRunning() below.
  demoting: boolean;
  liveMode: 'monitor' | 'record';
  appMode: string;
  selectedChannel: number | null;
  measurementSource: number | null;
  focusedInputIndex: number | null;
  mutedChannels: ChannelFlagMap;
  soloedChannels: ChannelFlagMap;
  lastTick: LiveEvent | null;
  lastLiveChannels: LiveMeterChannel[] | null;
  liveWindows: LiveEvent[];
  lapCoaching: unknown;
}

// #847: "should the Live surface render as live". True while a capture is
// running AND for the whole record→monitor demote, during which isCapturing
// is false only because stopCapture() flips it before awaiting the stopLive
// IPC. Every Live-surface render decision goes through this — reading
// liveCaptureStore.isCapturing directly is what made the board flash the
// idle card for the duration of that IPC.
export function boardRunning(lc: { isCapturing: boolean; demoting: boolean }): boolean {
  return lc.isCapturing || lc.demoting;
}

// The one builder for LiveWorkspaceViewState (#710 shotgun-surgery fix):
// LiveWorkspace.tsx's applyLiveTick, LiveCapturePanel.tsx, and LiveEqPane.tsx
// each read the same liveCaptureStore fields (a mix of subscribed-for-rerender
// and imperatively-read-at-render-time, per ADR-0005) plus settings and the
// seeded playhead elapsed time — assembling that snapshot here once means the
// 18-field shape only needs to grow in one place.
export function liveWorkspaceViewState(
  lc: LiveWorkspaceStoreSlice,
  settings: AppSettings | null,
  playheadElapsedMs = 0,
  sessionPicker: SessionTabSessionPickerView | null = null,
  sessionWaveforms: SessionTabWaveformView | null = null,
  sessionPlayback: SessionTabPlaybackView | null = null,
  capturePhase: CapturePhase = 'idle',
  sessionRoutingDrawerOpen = false,
): LiveWorkspaceViewState {
  return {
    channelConfig: lc.channelConfig,
    channelGroups: lc.channelGroups,
    devices: lc.devices,
    selectedDevice: lc.selectedDevice,
    isCapturing: boardRunning(lc),
    liveMode: lc.liveMode,
    appMode: lc.appMode,
    selectedChannel: lc.selectedChannel,
    measurementSource: lc.measurementSource,
    focusedInputIndex: lc.focusedInputIndex,
    mutedChannels: lc.mutedChannels,
    soloedChannels: lc.soloedChannels,
    lastTick: lc.lastTick,
    lastLiveChannels: lc.lastLiveChannels,
    liveWindows: lc.liveWindows,
    settings,
    lapCoaching: lc.lapCoaching,
    playheadElapsedMs,
    sessionPicker,
    sessionWaveforms,
    sessionPlayback,
    capturePhase,
    sessionRoutingDrawerOpen,
  };
}

export interface LapFocusView {
  focusedIndex: number | null;
  inputs: Array<{
    index: number;
    name: string;
    profile: { id: string; label: string; bands: Record<string, number> };
  }>;
}

export interface StatsRowView {
  rms: string;
  rmsTone: string;
  peak: string;
  peakTone: string;
  headroom: string;
  headroomTone: string;
  dr: string;
  drTone: string;
  clip: string;
  clipTone: string;
  centroid: string;
}

const DBFS_CEILING = 0;

/* ── Typed `window.*` accessors for the pure helper classic-scripts ──
 * Mirrors liveCaptureStore.ts's getArmState()-style pattern: these modules are
 * boot-injected once (App.tsx's BOOT_SCRIPTS) and read off `window` rather than
 * imported, so the view shares the exact same instances inline-app.js reads. */
export interface TrackWorkspaceApi {
  idleChannel(bandKeys: string[]): LiveMeterChannel;
  addEnabled(usedChannels: number, totalChannels: number, capturing: boolean): boolean;
  isEmpty(configuredCount: number): boolean;
}
export interface GroupStateApi {
  groupOf(groups: ChannelGroup[], idx: number): number;
  ungrouped(groups: ChannelGroup[], count: number): number[];
  isGroupCollapsed(groups: ChannelGroup[], g: number): boolean;
}
export interface ArmStateApi {
  stripToken(strip: StripConfig): string;
  isArmed(strip: StripConfig | null | undefined): boolean;
  armedCount(cfg: StripConfig[]): number;
}
export interface RigReconcileApi {
  resolveStripLabel(strip: StripConfig | null | undefined, ch: LiveMeterChannel | null | undefined, index: number): string;
}
export interface InstrumentProfilesApi {
  PROFILES: Array<{ id: string; label: string }>;
  effectiveProfileId(overridesForDevice: Record<string, string> | null | undefined, token: string, label: string | undefined): string;
  isKnownProfileId(id: string): boolean;
  profileById(id: string): { id: string; label: string; bands: Record<string, number> };
  // TD-001 slice 6h (#711): the per-strip profile override write, reached by
  // LiveCapturePanel's delegated track-profile branch (was inline-app.js).
  recordOverride(
    all: Record<string, Record<string, string>> | null | undefined,
    deviceName: string,
    token: string,
    profileId: string,
  ): Record<string, Record<string, string>>;
}
export interface LiveSetupStepsApi {
  setupSteps(view: { deviceReady: boolean; trackCount: number; liveMode: string }): LiveSetupStep[];
  shouldShowGuide(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null): boolean;
  markSetupComplete(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null): void;
  showAdvancedControls(trackCount: number): boolean;
}
export interface LiveAdjustmentsStateApi {
  panelHTML(
    settings: AppSettings | null,
    mode: string,
    windows: LiveEvent[],
    measurementSource: number | null,
    focusView: LapFocusView,
    coaching: unknown,
    now: number,
  ): string;
  observationContext(
    windows: LiveEvent[],
    measurementSource: number | null,
    focusView: LapFocusView,
    sourceName: string,
  ): unknown;
  createCoachingState(): unknown;
}
export interface DawWorkspaceStateApi {
  transportLabel(liveRunning: boolean, liveMode: string): string;
}
export interface DawPlayheadStateApi {
  elapsedMs(state: unknown, nowMs: number): number;
  formatElapsed(ms: number): string;
}
export interface DawWaveformStateApi {
  captureModeToken(liveRunning: boolean, liveMode: string): string;
}

// The 6j seam the React DAW-shell effect and the meter-controller patch path
// use to reach daw-shell-runtime.ts's waveform/playhead painters
// (App.tsx installs the runtime onto window.dawShellRuntime). Also carries
// the seeded elapsed-time readout the shell rebuilds from so a mid-capture
// rebuild never flashes 0:00.
export function getDawShellRuntime(): DawShellRuntime | undefined {
  return (window as unknown as { dawShellRuntime?: DawShellRuntime }).dawShellRuntime;
}

// The live-workspace accessors are exported so the React islands and the
// meter-controller patch path read the same classic-script instances without
// re-declaring the typed casts (never bare `any`).
export function getTrackWorkspace(): TrackWorkspaceApi {
  return (window as unknown as { trackWorkspace: TrackWorkspaceApi }).trackWorkspace;
}
export function getGroupState(): GroupStateApi {
  return (window as unknown as { groupState: GroupStateApi }).groupState;
}
export function getArmState(): ArmStateApi {
  return (window as unknown as { armState: ArmStateApi }).armState;
}
export function getRigReconcile(): RigReconcileApi {
  return (window as unknown as { rigReconcile: RigReconcileApi }).rigReconcile;
}
export function getInstrumentProfiles(): InstrumentProfilesApi {
  return (window as unknown as { instrumentProfiles: InstrumentProfilesApi }).instrumentProfiles;
}
export function getLiveSetupState(): LiveSetupStepsApi {
  return (window as unknown as { liveSetupState: LiveSetupStepsApi }).liveSetupState;
}
export function getLiveAdjustmentsState(): LiveAdjustmentsStateApi {
  return (window as unknown as { liveAdjustmentsState: LiveAdjustmentsStateApi }).liveAdjustmentsState;
}
export function getDawWorkspaceState(): DawWorkspaceStateApi {
  return (window as unknown as { dawWorkspaceState: DawWorkspaceStateApi }).dawWorkspaceState;
}
export function getDawPlayheadState(): DawPlayheadStateApi {
  return (window as unknown as { dawPlayheadState: DawPlayheadStateApi }).dawPlayheadState;
}
export function getDawWaveformState(): DawWaveformStateApi {
  return (window as unknown as { dawWaveformState: DawWaveformStateApi }).dawWaveformState;
}

// The selected device's name, resolved from the device list ('' = Default
// Device) — mirrors liveCaptureStore.ts's deviceNameFor (#482) locally so this
// pure module stays free of any dependency on the store that consumes it.
function deviceNameFor(state: LiveWorkspaceViewState): string {
  if (state.selectedDevice === '') return '';
  const dev = state.devices.find((d) => String(d.index) === state.selectedDevice);
  return dev ? dev.name : '';
}

// The persisted instrument-profile overrides (#524) saved for the currently
// selected device, mirroring inline-app.js's savedInstrumentProfilesForDevice.
function savedInstrumentProfilesForDevice(state: LiveWorkspaceViewState): Record<string, string> {
  return ((state.settings || {}).inputInstrumentProfiles || {})[deviceNameFor(state)] || {};
}

// The backend live channel for a strip index (or null before any tick), so the
// label fallback resolves the same way from every call site (#39).
function liveChannelAt(state: LiveWorkspaceViewState, idx: number): LiveMeterChannel | null {
  return state.lastLiveChannels ? state.lastLiveChannels[idx] : null;
}

// Port of inline-app.js's stripViewAt (#307 adapter). Resolves a strip's
// group and arm fields from the snapshot instead of the module vars
// inline-app.js used to read.
export function stripViewAt(state: LiveWorkspaceViewState, idx: number, ch: LiveMeterChannel): StripView {
  const strip = state.channelConfig[idx] || null;
  const groupIndex = getGroupState().groupOf(state.channelGroups, idx);
  return {
    strip,
    displayName: getRigReconcile().resolveStripLabel(strip, ch, idx),
    selected: state.selectedChannel === idx,
    armed: getArmState().isArmed(strip),
    groupIndex,
    groupCollapsed: getGroupState().isGroupCollapsed(state.channelGroups, groupIndex),
  };
}

// Port of inline-app.js's livePanelView.
export function livePanelView(state: LiveWorkspaceViewState): PanelView {
  return {
    deviceChannels: deviceChannelCount(state.selectedDevice, state.devices),
    liveRunning: state.isCapturing,
    // TD-001 slice 6h (#711): the per-strip arm button's disabled stamp derives
    // from `liveRunning && liveMode === 'record'` (arming stays live while
    // monitoring, #757) — see dawTrackHeaderHTML.
    liveMode: state.liveMode,
    groups: state.channelGroups,
  };
}

// Port of inline-app.js's lapFocusView (#525): every input strip's display
// name + effective instrument profile, plus which one (if any) is focused.
export function lapFocusView(state: LiveWorkspaceViewState): LapFocusView {
  const savedProfiles = savedInstrumentProfilesForDevice(state);
  return {
    focusedIndex: state.focusedInputIndex,
    inputs: state.channelConfig.map((strip, idx) => ({
      index: idx,
      name: getRigReconcile().resolveStripLabel(strip, liveChannelAt(state, idx), idx),
      profile: getInstrumentProfiles().profileById(
        getInstrumentProfiles().effectiveProfileId(savedProfiles, getArmState().stripToken(strip), strip && strip.label)),
    })),
  };
}

// Port of inline-app.js's lapObservationContext (#614): which source/scope the
// coaching evaluation is measuring, and whether this window's reading is usable.
export function lapObservationContext(state: LiveWorkspaceViewState): unknown {
  const ms = state.measurementSource;
  const idx = ms == null ? 0 : ms;
  return getLiveAdjustmentsState().observationContext(
    state.liveWindows, ms, lapFocusView(state), measurementSourceOptionLabel(state.channelConfig[idx], idx));
}

// Port of inline-app.js's currentEqPaneChannels (#668): the channel array
// backing the EQ pane right now — a live tick's channels once any have arrived
// this session, else the idle placeholder set.
export function currentEqPaneChannels(state: LiveWorkspaceViewState): LiveMeterChannel[] {
  return state.lastLiveChannels || state.channelConfig.map(() => getTrackWorkspace().idleChannel(LIVE_BAND_KEYS));
}

// Port of inline-app.js's addTrackDisabled — device channel cap or a capture
// running (#38), used by both the toolbar's Add track and the guided hero's CTA.
export function addTrackDisabled(state: LiveWorkspaceViewState): boolean {
  const used = usedChannelCount(state.channelConfig);
  const total = deviceChannelCount(state.selectedDevice, state.devices);
  return !getTrackWorkspace().addEnabled(used, total, state.isCapturing);
}

// Port of inline-app.js's liveWorkspaceToolbarHTML (#188): Add track + a
// used/total count, plus Collapse/Expand all and the arm cluster (#191, #757).
export function liveWorkspaceToolbarHTML(state: LiveWorkspaceViewState): string {
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

export interface LiveSetupStep {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  active: boolean;
}

// Port of inline-app.js's liveSetupStepsView (#294): maps the snapshot onto
// the setupSteps() view shape so done/active never drifts from the toolbar.
export function liveSetupStepsView(state: LiveWorkspaceViewState): LiveSetupStep[] {
  return getLiveSetupState().setupSteps({
    deviceReady: state.devices.length > 0,
    trackCount: state.channelConfig.length,
    liveMode: state.liveMode,
  });
}

// Port of inline-app.js's liveSetupStepsHTML (#294).
export function liveSetupStepsHTML(steps: LiveSetupStep[]): string {
  return steps.map((s, i) =>
    `<li class="ls-step${s.done ? ' done' : ''}${s.active ? ' active' : ''}">`
    + `<span class="ls-num">${s.done ? iconSvg('check', 12) : i + 1}</span>`
    + `<span class="ls-body"><span class="ls-label">${s.label}</span>`
    + (s.active ? `<span class="ls-hint">${s.hint}</span>` : '')
    + `</span></li>`).join('');
}

// One arrangement track row (#1043). `name` is already HTML-escaped — strip
// labels are user-entered — so callers interpolate it raw and never re-escape.
export interface DawTrackRow {
  index: number;
  name: string;
  idle?: boolean;
  clipping?: boolean;
  selected?: boolean;
  groupIndex?: number;
  groupCollapsed?: boolean;
  armed: boolean;
  armDisabled: boolean;
  configDisabled?: boolean;
  removeDisabled?: boolean;
  muted: boolean;
  soloed: boolean;
  monitorActive: boolean;
  levelPercent: number;
  takeClip: SessionTabWaveformClip | null;
}

// The single ordered per-track list both arrangement columns render from
// (ADR-0087 made the frame column-major, so every row is emitted twice — a head
// row and a lane row — and nothing in the DOM enforces that the two lists agree).
// dawShellHTML maps this one array into both columns and dawShellPatchView
// fingerprints it, so the rows cannot reorder, diverge in count, or resolve
// their names differently. Unarmed configured tracks are included: arming
// governs what records, never what the arrangement shows.
export function dawTrackRows(state: LiveWorkspaceViewState): DawTrackRow[] {
  const hasSoloedChannel = Object.values(state.soloedChannels).some((soloed) => soloed === true);
  const armDisabled = state.isCapturing && state.liveMode === 'record';
  return state.channelConfig.map((strip, idx) => {
    const channel = liveChannelAt(state, idx);
    const muted = state.mutedChannels[idx] === true;
    const soloed = state.soloedChannels[idx] === true;
    const groupIndex = getGroupState().groupOf(state.channelGroups, idx);
    return {
      index: idx,
      name: escapeHtml(getRigReconcile().resolveStripLabel(strip, channel, idx)),
      idle: !channel || !!channel.idle,
      clipping: !!channel?.clipping,
      selected: state.selectedChannel === idx,
      groupIndex,
      groupCollapsed: getGroupState().isGroupCollapsed(state.channelGroups, groupIndex),
      armed: getArmState().isArmed(strip),
      armDisabled,
      configDisabled: state.isCapturing,
      removeDisabled: state.isCapturing,
      muted,
      soloed,
      monitorActive: !muted && (!hasSoloedChannel || soloed),
      levelPercent: levelPercent(channel?.rms ?? Number.NaN, !!channel?.idle),
      takeClip: state.sessionWaveforms?.clips.find((clip) => clip.stripIndex === idx) ?? null,
    };
  });
}

export interface DawTrackGroupHeader {
  type: 'group';
  index: number;
  name: string;
  collapsed: boolean;
  summary: string;
  clipping: boolean;
  disabled: boolean;
}

export interface DawTrackUngroupedHeader {
  type: 'ungrouped';
}

export interface DawTrackEntry {
  type: 'track';
  row: DawTrackRow;
}

export type DawTrackListEntry = DawTrackGroupHeader | DawTrackUngroupedHeader | DawTrackEntry;

/** DAW arrangement track-list order mirrors the legacy live board: group order,
 * each group's manual member order, then any ungrouped strips. */
export function dawTrackListEntries(state: LiveWorkspaceViewState): DawTrackListEntry[] {
  const rowsByIndex = new Map(dawTrackRows(state).map((row) => [row.index, row]));
  if (state.channelGroups.length === 0) return Array.from(rowsByIndex.values()).map((row) => ({ type: 'track', row }));

  const entries: DawTrackListEntry[] = [];
  const channels = currentEqPaneChannels(state);
  state.channelGroups.forEach((grp, index) => {
    const summary = groupSummary(channels, grp.members);
    entries.push({
      type: 'group',
      index,
      name: escapeHtml(grp.name),
      collapsed: !!grp.collapsed,
      summary: escapeHtml(groupSummaryText(summary)),
      clipping: summary.clipping,
      disabled: state.isCapturing,
    });
    grp.members.forEach((member) => {
      const row = rowsByIndex.get(member);
      if (row) entries.push({ type: 'track', row });
    });
  });

  const ungrouped = getGroupState().ungrouped(state.channelGroups, state.channelConfig.length);
  if (ungrouped.length) {
    entries.push({ type: 'ungrouped' });
    ungrouped.forEach((idx) => {
      const row = rowsByIndex.get(idx);
      if (row) entries.push({ type: 'track', row });
    });
  }
  return entries;
}

/** Pure inside markup for one arrangement track header. The row is derived
 * once by dawTrackRows, preserving the header/lane ordering contract.
 * Overview-only: per-channel settings live in the selection pane (#849). */
export function dawTrackHeaderHTML(row: DawTrackRow): string {
  const dragHTML = (row.groupIndex ?? -1) >= 0
    ? `<button type="button" class="daw-track-head-drag" draggable="true" aria-label="Reorder track within group — drag, or press Arrow Up/Down" title="Drag to reorder track"${row.configDisabled ? ' disabled' : ''}>⋮⋮</button>`
    : '';
  return dragHTML
    + `<span class="daw-track-head-index">${row.index + 1}</span>`
    + `<span class="daw-track-head-name${row.clipping ? ' clip' : ''}" contenteditable="true" spellcheck="false" role="textbox" aria-label="Channel name — click to rename" title="Click to rename">${row.name}</span>`
    + `<span class="daw-track-head-controls">`
    + `<button type="button" class="daw-track-head-arm" data-idx="${row.index}" aria-label="${row.armed ? 'Disarm track' : 'Arm track for recording'}" title="${row.armed ? 'Disarm track' : 'Arm track for recording'}" aria-pressed="${row.armed}"${row.armDisabled ? ' disabled' : ''}></button>`
    + `<button type="button" class="daw-track-head-mute" aria-label="${row.muted ? 'Unmute track' : 'Mute track'}" aria-pressed="${row.muted}">M</button>`
    + `<button type="button" class="daw-track-head-solo" aria-label="${row.soloed ? 'Unsolo track' : 'Solo track'}" aria-pressed="${row.soloed}">S</button>`
    + `</span>`
    + `<span class="daw-track-head-level" aria-hidden="true"><span class="daw-track-head-level-fill" style="width:${row.levelPercent}%"></span></span>`
    + `<span class="daw-track-head-meta">${row.idle ? 'Idle' : 'Live'}</span>`
    + `<button type="button" class="daw-track-head-remove" title="Remove track" aria-label="Remove track"${row.removeDisabled ? ' disabled' : ''}>×</button>`;
}

function dawTrackHeadHTML(row: DawTrackRow): string {
  const stripClass = `daw-track-head${row.selected ? ' selected' : ''}${row.idle ? ' idle' : ''}${row.groupCollapsed ? ' group-collapsed' : ''}`;
  return `<div class="${stripClass}" data-ch="${row.index}"${row.selected ? ' aria-current="true"' : ''} tabindex="0" role="button" aria-label="Select ${row.name} to inspect in the EQ pane">${dawTrackHeaderHTML(row)}</div>`;
}

function dawTrackGroupHeaderHTML(header: DawTrackGroupHeader): string {
  return `<div class="live-group-head${header.collapsed ? ' collapsed' : ''}" data-group="${header.index}">`
    + `<button type="button" class="live-group-drag" draggable="true" aria-label="Reorder group — drag, or press Arrow Up/Down" title="Drag to reorder group"${header.disabled ? ' disabled' : ''}>⋮⋮</button>`
    + `<button type="button" class="live-group-fold" aria-label="Collapse or expand group" aria-expanded="${header.collapsed ? 'false' : 'true'}" title="Collapse / expand group">▾</button>`
    + `<span class="live-group-name">${header.name}</span>`
    + `<span class="live-group-summary">${header.summary}${header.clipping ? '<span class="live-group-clip">CLIP</span>' : ''}</span>`
    + `<button type="button" class="live-group-rename" aria-label="Rename group" title="Rename group"${header.disabled ? ' disabled' : ''}>Rename</button>`
    + `<button type="button" class="live-group-del" aria-label="Delete group" title="Delete group"${header.disabled ? ' disabled' : ''}>Delete</button>`
    + `</div>`;
}

// The shared DAW-shell patch view (#517): the lane fingerprint (for "did the
// lanes themselves change" — a same-count rig swap changes labels without
// length), the transport chip text, and the mix-lane capture-mode token. The
// per-tick chip/canvas patching itself stays a DOM applier in the meter
// controller (e2e-gated); this is the pure "what" it writes.
export interface DawShellPatchView {
  laneSignature: string;
  transportChip: string;
  captureMode: string;
}

export function dawShellPatchView(state: LiveWorkspaceViewState): DawShellPatchView {
  return {
    laneSignature: dawTrackRows(state).map((row) => `${row.name}\u0001${row.takeClip ? `${row.takeClip.trackIndex}\u0001${row.takeClip.leftPx}\u0001${row.takeClip.widthPx}` : ''}`).join('\u0000'),
    transportChip: getDawWorkspaceState().transportLabel(state.isCapturing, state.liveMode),
    captureMode: getDawWaveformState().captureModeToken(state.isCapturing, state.liveMode),
  };
}

// The overall-mix row's display name — one constant because the row is emitted
// twice, once per column (ADR-0087), and the two cells must read identically.
const DAW_MASTER_ROW_NAME = 'Overall mix';
// Status-line copy for the two "nothing selected/configured yet" cases.
const DAW_STATUS_NO_TRACKS = 'No tracks';
const DAW_STATUS_NO_DEVICE = 'No device selected';

/** The arrangement status line's three derived strings (#1044): the track-count
 *  summary and capture state on the left, the selected device on the right
 *  (docs/design/session-tab.md, "Vertical structure"). `device` is already
 *  HTML-escaped — a device name is an OS-supplied string. */
export interface DawStatusLineView {
  tracks: string;
  capture: string;
  device: string;
}

/** Pure status-line derivation: the track count comes from the one shared
 *  dawTrackRows list and the capture label from dawShellPatchView's transport
 *  chip (ADR-0088), so the status line can never disagree with the head column,
 *  the lane column, or the transport chip about the same state. No DOM read, no
 *  store access — everything comes off the supplied snapshot. */
export function dawStatusLineView(state: LiveWorkspaceViewState): DawStatusLineView {
  const count = dawTrackRows(state).length;
  const device = deviceNameFor(state);
  return {
    tracks: count === 0 ? DAW_STATUS_NO_TRACKS : `${count} ${count === 1 ? 'track' : 'tracks'}`,
    capture: dawShellPatchView(state).transportChip,
    device: device === '' ? DAW_STATUS_NO_DEVICE : escapeHtml(device),
  };
}

// Port of renderDawShell's markup builder (the rebuild path, #517/#518/#520):
// the timeline shell only — the waveform/playhead canvas PAINTING stays inline
// (slice 6j) and is reachable via the window.dawShellRuntime bridge.
export function dawShellHTML(state: LiveWorkspaceViewState, routingDrawerContent: string = ''): string {
  const rows = dawTrackRows(state);
  const entries = dawTrackListEntries(state);
  const { transportChip, captureMode } = dawShellPatchView(state);
  const seededElapsed = state.playheadElapsedMs;
  const recordingTimelineActive = state.isCapturing && state.liveMode === 'record';
  const playheadVisible = recordingTimelineActive || state.sessionPlayback !== null;
  const liveWaveformCanvasHTML = recordingTimelineActive ? `<canvas class="daw-channel-waveform"></canvas>` : '';
  const mixWaveformCanvasHTML = recordingTimelineActive ? `<canvas class="daw-mix-waveform"></canvas>` : '';
  const laneGrid = `<span class="daw-lane-grid">${dawLaneGridlines(DAW_TIMELINE_SPAN_SECS)
    .map((line) => `<span class="daw-gridline${line.isMajor ? ' major' : ''}" style="left:${line.xPx}px"></span>`)
    .join('')}</span>`;
  // The ruler row's head cell (#1048): the head column's first child, holding
  // the head column open for the ruler row so every head row lines up with its
  // lane row. Empty for now — zoom/follow controls are #995.
  const rulerGutterHTML = `<div class="daw-ruler-gutter"></div>`;
  // The playhead's two region segments (#1049, ADR: two region segments): one in
  // the ruler row, one over the lane column, so the arrangement shows a single
  // vertically aligned indicator across both. Both carry .daw-playhead, so
  // renderPlayhead writes the SAME shell-local x to both in one pass, and both
  // re-base into the timeline column through the one shared translate (ADR-0090).
  // Emitted last in each region so they paint above the ticks and the lanes.
  const rulerPlayheadHTML = playheadVisible ? `<span class="daw-playhead daw-playhead-ruler"></span>` : '';
  const lanePlayheadHTML = playheadVisible ? `<span class="daw-playhead daw-playhead-lanes"></span>` : '';
  const headHTML = entries.map((entry) => {
    if (entry.type === 'group') return dawTrackGroupHeaderHTML(entry);
    if (entry.type === 'ungrouped') return `<div class="live-group-head ungrouped" data-group="-1"><span class="live-group-name">Ungrouped</span></div>`;
    return dawTrackHeadHTML(entry.row);
  }).join('');
  const headRowsHTML = rows.length > 0
    ? headHTML
    : `<div class="daw-empty-head"></div>`;
  const laneHTML = rows.length > 0
    ? `<div class="daw-channel-lanes">${entries.map((entry) => {
      if (entry.type === 'group') return `<div class="daw-lane-group-spacer${entry.collapsed ? ' collapsed' : ''}" data-group="${entry.index}" aria-hidden="true"></div>`;
      if (entry.type === 'ungrouped') return `<div class="daw-lane-group-spacer ungrouped" data-group="-1" aria-hidden="true"></div>`;
      const { row } = entry;
      return `<div class="daw-lane daw-channel-lane${row.monitorActive ? '' : ' daw-channel-lane--dimmed'}${row.groupCollapsed ? ' group-collapsed' : ''}" data-ch="${row.index}">`
        + `<span class="daw-lane-name">${row.name}</span>`
        + `<span class="daw-lane-body">${liveWaveformCanvasHTML}</span>`
        + (row.takeClip
          ? `<span class="daw-take-clip" style="left:${row.takeClip.leftPx}px;width:${row.takeClip.widthPx}px"><canvas data-session-track-index="${row.takeClip.trackIndex}"></canvas></span>`
          : '')
        + laneGrid
        + `</div>`;
    }).join('')}</div>`
    : `<div class="daw-lane daw-empty-state">Add your first track</div>`;
  // The overall-mix row (#1044): emitted like every other row, twice, once per
  // column, and last in each — it is not a track head/lane, so it never comes
  // from dawTrackRows and always renders, even with zero configured tracks.
  const masterHeadHTML = `<div class="daw-master-head">`
    + `<span class="daw-master-head-name">${DAW_MASTER_ROW_NAME}</span>`
    + `</div>`;
  const mixLaneHTML = `<div class="daw-lane daw-mix-lane" data-capture-mode="${captureMode}">`
    + `<span class="daw-lane-name">${DAW_MASTER_ROW_NAME}</span>`
    + `<span class="daw-lane-body">${mixWaveformCanvasHTML}</span>`
    + laneGrid
    + `</div>`;
  const rulerTicks = dawRulerTicks(DAW_TIMELINE_SPAN_SECS)
    .map((tick) => `<span class="daw-ruler-tick" style="left:${tick.xPx}px"></span>`)
    .join('');
  const status = dawStatusLineView(state);
  return `<div class="daw-shell" style="--daw-head-w:${DAW_TIMELINE_ORIGIN_PX}px">`
    + `<div class="daw-transport">`
    + `<span class="daw-transport-title">Live Workspace</span>`
    + `<span class="daw-transport-state daw-transport-state-${transportChip.toLowerCase()}">${transportChip}</span>`
    + `<span class="daw-transport-time">${getDawPlayheadState().formatElapsed(seededElapsed)}</span>`
    + liveWorkspaceToolbarHTML(state)
    + (state.sessionPicker ? sessionTabSessionPickerHTML(state.sessionPicker) : '')
    + (state.sessionPlayback ? sessionTabPlaybackHTML(state.sessionPlayback) : '')
    + sessionTabCaptureHTML(recordButtonView(state.capturePhase))
    + `<button type="button" class="daw-session-routing-toggle" id="daw-session-routing-toggle" aria-expanded="${state.sessionRoutingDrawerOpen}" aria-controls="daw-session-routing-drawer">Routing</button>`
    + (state.sessionWaveforms?.generating ? `<span class="daw-session-waveform-hint">Generating waveforms…</span>` : '')
    + `</div>`
    // The semantic arrangement frame (#1042): the track-head column and the
    // timeline column that owns the ruler and every lane row. Per-track head
    // rows come from dawTrackRows (#1043); the overall-mix row is the last
    // paired row in each column (#1044, ADR-0087) and the status line below is
    // shell chrome outside the arrangement, not a third child of it. The two
    // columns now sit side by side (#1048): the timeline column's left edge is
    // the shared t=0 boundary the ruler origin and every lane row start from.
    // The ruler and lane children keep emitting shell-local x from
    // dawTimelineX (ADR-0086), re-based into the timeline column by the
    // shared CSS translate (ADR-0090). The playhead is two region segments,
    // not a shell child (#1049): one in the ruler, one over the lane column.
    + `<div class="daw-arrangement">`
    + `<div class="daw-track-heads">${rulerGutterHTML}${headRowsHTML}${masterHeadHTML}</div>`
    + `<div class="daw-timeline">`
    + `<div class="daw-ruler">${rulerTicks}${rulerPlayheadHTML}</div>`
    + `<div class="daw-lane-column">`
    + laneHTML
    + mixLaneHTML
    + lanePlayheadHTML
    + `</div>`
    + `</div>`
    + `</div>`
    + `<div class="daw-status-line">`
    + `<span class="daw-status-tracks">${status.tracks}</span>`
    + `<span class="daw-status-capture">${status.capture}</span>`
    + `<span class="daw-status-device">${status.device}</span>`
    + `</div>`
    + `<section class="daw-session-routing-drawer" id="daw-session-routing-drawer" aria-label="Routing"${state.sessionRoutingDrawerOpen ? '' : ' hidden'}>`
    + `<h2 class="daw-session-routing-title">Routing</h2>`
    + routingDrawerContent
    + `</section>`
    + `</div>`;
}

// Port of syncLiveAdjustmentsPanel's HTML computation (#522) — the panel
// element management (insert/remove/outerHTML diff) is gone: LiveCapturePanel
// renders the returned markup reactively from store state.
export function liveAdjustmentsPanelHTML(state: LiveWorkspaceViewState): string {
  return getLiveAdjustmentsState().panelHTML(
    state.settings, state.appMode, state.liveWindows, state.measurementSource, lapFocusView(state), state.lapCoaching, Date.now());
}

/* ── Stats row (port of inline-app.js's updateStatsRow/updateLiveStatsRow) ── */

interface FileAnalysisSox {
  rmsDbfs: number;
  peakDbfs: number;
  dynamicRangeDb: number;
  clipping: boolean;
}
interface FileAnalysisSpectrum {
  spectralCentroid?: number;
}

// The file-analysis variant (RMS/Peak/DR/Clip from sox, centroid from
// spectrum) — thresholds match inline-app.js's updateStatsRow exactly.
export function statsRowView(sox: unknown, spectrum: unknown): StatsRowView {
  const s = sox as FileAnalysisSox;
  const sp = spectrum as FileAnalysisSpectrum;
  return {
    rms: fmt(s.rmsDbfs),
    rmsTone: s.rmsDbfs > -6 ? 'check' : '',
    peak: fmt(s.peakDbfs),
    peakTone: s.peakDbfs > -1 ? 'issue' : '',
    headroom: Number.isFinite(s.peakDbfs) ? fmt(DBFS_CEILING - s.peakDbfs) : '—',
    headroomTone: Number.isFinite(s.peakDbfs) && s.peakDbfs > -1 ? 'issue' : '',
    dr: fmt(s.dynamicRangeDb),
    drTone: s.dynamicRangeDb < 6 ? 'check' : '',
    clip: s.clipping ? 'YES' : 'No',
    clipTone: s.clipping ? 'issue' : '',
    centroid: sp && sp.spectralCentroid ? Math.round(sp.spectralCentroid).toLocaleString() : '—',
  };
}

// The live variant (DR reads '—', clip reads 'CLIP') — matches
// inline-app.js's updateLiveStatsRow exactly.
export function liveStatsRowView(ch: LiveMeterChannel): StatsRowView {
  const peakIsFinite = Number.isFinite(ch.peak);
  return {
    rms: fmt(ch.rms),
    rmsTone: ch.rms > -6 ? 'check' : '',
    peak: fmt(ch.peak),
    peakTone: ch.peak > -1 ? 'issue' : '',
    headroom: peakIsFinite ? fmt(DBFS_CEILING - ch.peak) : '—',
    headroomTone: peakIsFinite && ch.peak > -1 ? 'issue' : '',
    dr: '—',
    drTone: '',
    clip: ch.clipping ? 'CLIP' : 'No',
    clipTone: ch.clipping ? 'issue' : '',
    centroid: ch.centroid ? Math.round(ch.centroid).toLocaleString() : '—',
  };
}

// Adapts the shared live-stat formatter for the selected inspector. Synthetic
// idle channels have no live statistics, so callers use its null result to
// render or patch the complete unavailable tile set.
export function eqPaneLevelTilesView(ch: LiveMeterChannel | null | undefined): EqPaneLevelTilesView | null {
  if (!ch || ch.idle) return null;
  const stats = liveStatsRowView(ch);
  return {
    rms: stats.rms, rmsTone: stats.rmsTone,
    peak: stats.peak, peakTone: stats.peakTone,
    headroom: stats.headroom, headroomTone: stats.headroomTone,
    clip: stats.clip, clipTone: stats.clipTone,
  };
}

// Resolves only a valid selected channel from a tick-shaped channel list so
// an out-of-range selection clears the inspector rather than retaining a
// previous strip's readings.
export function selectedEqPaneLevelTilesView(channels: LiveMeterChannel[], selectedIndex: number | null): EqPaneLevelTilesView | null {
  const selectedChannel = selectedIndex != null && Number.isInteger(selectedIndex) && selectedIndex >= 0
    ? channels[selectedIndex] ?? null
    : null;
  return eqPaneLevelTilesView(selectedChannel);
}

/* c8 ignore start -- DOM applier, no jsdom in this harness (renderToString
   only) — same precedent as live-capture-panel.ts's retired strip DOM applier;
   exercised by tests/e2e/live-capture.spec.ts (live ticks drive #stat-*) and
   tests/e2e/report-card-basics.spec.ts (file analysis done transition). */
function setStat(id: string, value: string, tone: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.className = 'stat-num' + (tone ? ' ' + tone : '');
}

// Port of inline-app.js's setStat-based stats-row write. Guarded null-safe so
// the file-analysis done transition can be unit-tested with a stubbed DOM.
export function patchStatsRow(view: StatsRowView): void {
  setStat('stat-rms', view.rms, view.rmsTone);
  setStat('stat-peak', view.peak, view.peakTone);
  setStat('stat-dr', view.dr, view.drTone);
  setStat('stat-clip', view.clip, view.clipTone);
  const centroid = document.getElementById('stat-centroid');
  if (centroid) centroid.textContent = view.centroid;
}
/* c8 ignore stop */
