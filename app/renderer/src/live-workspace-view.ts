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
  liveMetersHTML,
  measurementSourceOptionLabel,
  type LiveDevice,
  type StripConfig,
  type ChannelGroup,
  type LiveEvent,
  type LiveMeterChannel,
  type StripView,
  type PanelView,
  type ChannelWindowData,
} from './live-capture-panel';
import { escapeHtml } from './spectrum-display';
import { fmt, iconSvg } from './report-card';
import type { AppSettings } from '../../electron/ipc/api';

// One immutable snapshot of everything a board-level view derivation reads.
// Discrete board shape comes from liveCaptureStore; lastTick/lastLiveChannels
// are the animation-rate values a React render reads imperatively (never via
// subscription); liveWindows/settings/lapCoaching feed the adjustments panel.
export interface LiveWorkspaceViewState {
  channelConfig: StripConfig[];
  channelGroups: ChannelGroup[];
  devices: LiveDevice[];
  selectedDevice: string;
  isCapturing: boolean;
  liveMode: 'monitor' | 'record';
  appMode: string;
  selectedChannel: number | null;
  measurementSource: number | null;
  focusedInputIndex: number | null;
  lastTick: LiveEvent | null;
  lastLiveChannels: ChannelWindowData[] | null;
  liveWindows: LiveEvent[];
  settings: AppSettings | null;
  lapCoaching: unknown;
  /** Seeded elapsed time (ms) for the DAW shell's transport readout — read
   *  imperatively from the 6j playhead bridge at render time so a mid-capture
   *  rebuild never flashes 0:00 (#518). */
  playheadElapsedMs: number;
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
  liveMode: 'monitor' | 'record';
  appMode: string;
  selectedChannel: number | null;
  measurementSource: number | null;
  focusedInputIndex: number | null;
  lastTick: LiveEvent | null;
  lastLiveChannels: ChannelWindowData[] | null;
  liveWindows: LiveEvent[];
  lapCoaching: unknown;
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
): LiveWorkspaceViewState {
  return {
    channelConfig: lc.channelConfig,
    channelGroups: lc.channelGroups,
    devices: lc.devices,
    selectedDevice: lc.selectedDevice,
    isCapturing: lc.isCapturing,
    liveMode: lc.liveMode,
    appMode: lc.appMode,
    selectedChannel: lc.selectedChannel,
    measurementSource: lc.measurementSource,
    focusedInputIndex: lc.focusedInputIndex,
    lastTick: lc.lastTick,
    lastLiveChannels: lc.lastLiveChannels,
    liveWindows: lc.liveWindows,
    settings,
    lapCoaching: lc.lapCoaching,
    playheadElapsedMs,
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
  dr: string;
  drTone: string;
  clip: string;
  clipTone: string;
  centroid: string;
}

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
  // LiveCapturePanel's delegated .live-ch-profile branch (was inline-app.js).
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
  showShell(settings: AppSettings | null, mode: string): boolean;
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
// use to reach the still-inline waveform/playhead painters (inline-app.js
// installs window.dawShellRuntime). Also carries the seeded elapsed-time
// readout the shell rebuilds from so a mid-capture rebuild never flashes 0:00.
export interface DawShellRuntime {
  renderPlayhead(): void;
  renderWaveform(): void;
  playheadElapsedMs(): number;
}
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
// group/token/arm/instrument fields from the snapshot instead of the module
// vars inline-app.js used to read.
export function stripViewAt(state: LiveWorkspaceViewState, idx: number, ch: LiveMeterChannel): StripView {
  const strip = state.channelConfig[idx] || null;
  const groupIndex = getGroupState().groupOf(state.channelGroups, idx);
  const token = strip ? getArmState().stripToken(strip) : String(idx);
  const savedProfiles = savedInstrumentProfilesForDevice(state);
  return {
    strip,
    displayName: getRigReconcile().resolveStripLabel(strip, ch, idx),
    selected: state.selectedChannel === idx,
    armed: getArmState().isArmed(strip),
    groupIndex,
    groupCollapsed: getGroupState().isGroupCollapsed(state.channelGroups, groupIndex),
    instrumentProfileId: getInstrumentProfiles().effectiveProfileId(savedProfiles, token, strip && strip.label),
    instrumentAuto: !(savedProfiles[token] && getInstrumentProfiles().isKnownProfileId(savedProfiles[token])),
  };
}

// Port of inline-app.js's livePanelView.
export function livePanelView(state: LiveWorkspaceViewState): PanelView {
  return {
    deviceChannels: deviceChannelCount(state.selectedDevice, state.devices),
    liveRunning: state.isCapturing,
    // TD-001 slice 6h (#711): the per-strip arm button's disabled stamp derives
    // from `liveRunning && liveMode === 'record'` (arming stays live while
    // monitoring, #757) — see veqChannelHTML.
    liveMode: state.liveMode,
    groups: state.channelGroups,
    instrumentProfiles: getInstrumentProfiles().PROFILES.map((p) => ({ id: p.id, label: p.label })),
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

// Mirrors window.liveWorkspaceRuntime.renderWorkspace()'s branch (TD-001 slice
// 6c, #701): when capturing with a fresh tick, the running card from the
// tick's channels; else the idle card from synthetic placeholder channels.
export function meterCardHTML(state: LiveWorkspaceViewState): { html: string; idle: boolean } {
  const runningChannels = state.isCapturing && state.lastTick && state.lastTick.channels && state.lastTick.channels.length > 0
    ? state.lastTick.channels
    : null;
  if (runningChannels) {
    const stripViews = runningChannels.map((c, i) => stripViewAt(state, i, c));
    return {
      html: `<div class="meter-card sb-live-meters">${liveMetersHTML(runningChannels, stripViews, livePanelView(state))}</div>`,
      idle: false,
    };
  }
  const idleChannels = state.channelConfig.map(() => getTrackWorkspace().idleChannel(LIVE_BAND_KEYS));
  const stripViews = idleChannels.map((c, i) => stripViewAt(state, i, c));
  return {
    html: `<div class="meter-card sb-live-meters idle">${liveMetersHTML(idleChannels, stripViews, livePanelView(state))}</div>`,
    idle: true,
  };
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
  const laneNames = state.channelConfig.map((strip, idx) =>
    escapeHtml(getRigReconcile().resolveStripLabel(strip, liveChannelAt(state, idx), idx)));
  return {
    laneSignature: laneNames.join('\u0000'),
    transportChip: getDawWorkspaceState().transportLabel(state.isCapturing, state.liveMode),
    captureMode: getDawWaveformState().captureModeToken(state.isCapturing, state.liveMode),
  };
}

// Port of renderDawShell's markup builder (the rebuild path, #517/#518/#520):
// the timeline shell only — the waveform/playhead canvas PAINTING stays inline
// (slice 6j) and is reachable via the window.dawShellRuntime bridge.
export function dawShellHTML(state: LiveWorkspaceViewState): string {
  const laneNames = state.channelConfig.map((strip, idx) =>
    escapeHtml(getRigReconcile().resolveStripLabel(strip, liveChannelAt(state, idx), idx)));
  const { transportChip, captureMode } = dawShellPatchView(state);
  const seededElapsed = state.playheadElapsedMs;
  const laneHTML = state.channelConfig.length > 0
    ? `<div class="daw-channel-lanes">${state.channelConfig.map((strip, idx) =>
      `<div class="daw-lane daw-channel-lane" data-ch="${idx}">`
      + `<span class="daw-lane-name">${laneNames[idx]}</span>`
      + `<span class="daw-lane-body"><canvas class="daw-channel-waveform"></canvas></span>`
      + `</div>`).join('')}</div>`
    : `<div class="daw-lane daw-empty-state">Add tracks to see channel lanes</div>`;
  return `<div class="daw-shell">`
    + `<div class="daw-transport">`
    + `<span class="daw-transport-title">Live Workspace</span>`
    + `<span class="daw-transport-state daw-transport-state-${transportChip.toLowerCase()}">${transportChip}</span>`
    + `<span class="daw-transport-time">${getDawPlayheadState().formatElapsed(seededElapsed)}</span>`
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
  return {
    rms: fmt(ch.rms),
    rmsTone: ch.rms > -6 ? 'check' : '',
    peak: fmt(ch.peak),
    peakTone: ch.peak > -1 ? 'issue' : '',
    dr: '—',
    drTone: '',
    clip: ch.clipping ? 'CLIP' : 'No',
    clipTone: ch.clipping ? 'issue' : '',
    centroid: ch.centroid ? Math.round(ch.centroid).toLocaleString() : '—',
  };
}

/* c8 ignore start -- DOM applier, no jsdom in this harness (renderToString
   only) — same precedent as live-capture-panel.ts's patchLiveChannel;
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
