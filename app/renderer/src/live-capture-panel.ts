// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure live-capture-panel rendering module (#307, epic #302): device-list
// formatting, channel-selection helpers, and the per-channel vertical-EQ
// meter markup, extracted verbatim (behavior-identical) from inline-app.js's
// closure so the logic is a single, unit-tested source of truth reusable by
// both the runtime (via the `window.liveCapturePanel` bridge — see App.tsx)
// and <LiveCapturePanel>. Follows the same slice pattern as spectrum-display.ts
// (#305) and report-card.ts (#306). The DOM/state-reading closures that used
// to read channelConfig/liveRunning/channelGroups/etc. directly now take that
// state as StripView/PanelView parameters instead (constitution: side effects
// injected, not imported globally).

import {
  BAND_META,
  CURVE_VB,
  CURVE_FMIN,
  CURVE_FMAX,
  DB_MIN,
  DB_MAX,
  escapeHtml,
  spectrumCurveSVG,
  veqBandView,
  veqBarsAndLabelsHTML,
  veqLoudestIdx,
  toPct,
  type BarColumn,
  type SpectrumCurve,
  type SpectrumCurvePaths,
} from './spectrum-display';
import { fmt, type ReportCardSource } from './report-card';
import type {
  LiveEvent,
  MeterData,
  WindowData,
  ChannelWindowData,
  ChannelKind,
} from '@sound-buddy/audio-engine/dist/stream/types';

export type { LiveEvent, MeterData, WindowData, ChannelWindowData, ChannelKind };

export interface LiveDevice { index: number; name: string; channels: number; default_sr: number }
export type MicAccess = 'granted' | 'denied' | 'restricted' | 'not-determined';
export interface ListDevicesResult { success: boolean; error?: string; micAccess?: MicAccess; devices?: LiveDevice[] }
export interface StripConfig { kind: ChannelKind; a: number; b: number; armed?: boolean; label?: string }
export interface ChannelGroup { name: string; members: number[]; collapsed?: boolean }

// A live tick channel as the renderer actually receives it: stream.py sends
// snake_case band keys; the idle workspace synthesizes placeholder channels
// (window.trackWorkspace.idleChannel) that carry only bands/rms/peak + idle.
export type LiveMeterChannel = Pick<ChannelWindowData, 'bands' | 'rms' | 'peak'> &
  Partial<Omit<ChannelWindowData, 'bands' | 'rms' | 'peak'>> & { idle?: boolean };

export interface StripView {   // per-strip state the caller resolves from its stores
  strip: StripConfig | null;   // channelConfig[idx] ?? null
  displayName: string;         // stripLabel(strip, ch, idx) at runtime
  selected: boolean;           // idx === selectedChannel (#668) — drives the strip's secondary EQ pane
  armed: boolean;              // window.armState.isArmed(strip)
  groupIndex: number;          // window.groupState.groupOf(channelGroups, idx); -1 = ungrouped
  groupCollapsed: boolean;     // window.groupState.isGroupCollapsed(channelGroups, groupIndex)
  instrumentProfileId: string; // window.instrumentProfiles.effectiveProfileId(...) (#524)
  instrumentAuto: boolean;     // true when no persisted override applies to this strip (#524)
}

export interface PanelView {
  deviceChannels: number;      // selectedDeviceChannels()
  liveRunning: boolean;
  liveMode: 'monitor' | 'record';
  groups: ChannelGroup[];      // channelGroups
  instrumentProfiles?: { id: string; label: string }[]; // window.instrumentProfiles.PROFILES (#524)
}

export interface DeviceOption { value: string; label: string }
export interface DeviceHint { text: string; isError: boolean }
export interface DeviceListView {
  devices: LiveDevice[];
  options: DeviceOption[];
  hint: DeviceHint | null;
}

/* ── Live vertical-bar EQ ──
 * Each channel renders as a compact analyzer arc — the same spectrumCurveSVG
 * component used for whole-file quality, fed a 7-point curve built from the
 * live band levels — with a vertical bar per band overlaid on the SVG's plot
 * area. Bars span their band's log-frequency range, so they sit exactly under
 * the arc's band tints: low→high runs left→right, level grows bottom→top. */
export const LIVE_BAND_KEYS = ['sub_bass', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance'];
export const VEQ_VB_H = 280; // compact viewBox height for the per-channel arcs
export const VEQ_GAP = 0.5;  // bar inset per side, % of plot width
export function veqLogPos(f: number): number {
  return (Math.log10(f) - Math.log10(CURVE_FMIN)) / (Math.log10(CURVE_FMAX) - Math.log10(CURVE_FMIN)) * 100;
}
// Geometry constants — all derived from CURVE_VB/BAND_META, so identical for
// every tick and channel; computed once at module scope to keep the live
// repaint path allocation-free.
export const VEQ_FREQS = BAND_META.map((b) => Math.sqrt(b.lo * b.hi)); // band-center freqs (geometric mean)
export const VEQ_INSET = (() => {
  const { w, ml, mr, mt, mb } = CURVE_VB;
  return `left:${(ml / w * 100).toFixed(2)}%;right:${(mr / w * 100).toFixed(2)}%;top:${(mt / VEQ_VB_H * 100).toFixed(2)}%;bottom:${(mb / VEQ_VB_H * 100).toFixed(2)}%`;
})();
export const VEQ_LABEL_MARGIN = `margin-left:${(CURVE_VB.ml / CURVE_VB.w * 100).toFixed(2)}%;margin-right:${(CURVE_VB.mr / CURVE_VB.w * 100).toFixed(2)}%`;
export const VEQ_BANDS = BAND_META.map((b, i) => {
  const bx0 = veqLogPos(b.lo) + VEQ_GAP, bx1 = veqLogPos(b.hi) - VEQ_GAP;
  return { key: b.key, label: b.label, short: b.short, color: b.color, left: bx0.toFixed(2), width: (bx1 - bx0).toFixed(2), center: veqLogPos(VEQ_FREQS[i]).toFixed(2) };
});

/* ── Granular analyzer grid (#667) ──
 * Replaces the 7 wildly-unequal-span bars with one equal-width bar per point
 * of the same 48-point log-frequency grid spectrum.py's offline analyzer
 * uses, fed by the full STFT stream.py now emits (curve_from_power) instead
 * of throwing it away. Mirrors spectrum.py's GRID_* constants — parity is
 * pinned by tests on both sides. */
export const ANALYZER_GRID_LOW_HZ = 20;
export const ANALYZER_GRID_HIGH_HZ = 20000;
export const ANALYZER_GRID_POINTS = 48;
// geomspace(20, 20000, 48) — parity with spectrum.py._grid_freqs() is pinned by tests on both sides.
export const ANALYZER_GRID_FREQS = Array.from({ length: ANALYZER_GRID_POINTS }, (_, i) =>
  ANALYZER_GRID_LOW_HZ * Math.pow(ANALYZER_GRID_HIGH_HZ / ANALYZER_GRID_LOW_HZ, i / (ANALYZER_GRID_POINTS - 1)));
export const VEQ_GRID_GAP = 0.25; // bar inset per side, % of plot width
// The grid is log-uniform, so each bar's log-position lands exactly on
// i * VEQ_GRID_STEP — equal-width bars at true log frequency placement.
const VEQ_GRID_STEP = 100 / (ANALYZER_GRID_POINTS - 1);

// BAND_META entry whose [lo, hi) covers f, clamped to the outer bands beyond
// [20, 20000) so every grid point (including the edge points sitting exactly
// on 20 Hz / 20 kHz) resolves to a tint.
export function bandColorForFreq(f: number): string {
  if (f < BAND_META[0].lo) return BAND_META[0].color;
  const last = BAND_META[BAND_META.length - 1];
  if (f >= last.hi) return last.color;
  const band = BAND_META.find((b) => f >= b.lo && f < b.hi);
  return (band ?? last).color;
}

export const VEQ_GRID_BARS: BarColumn[] = ANALYZER_GRID_FREQS.map((freq, i) => {
  const center = veqLogPos(freq);
  const width = VEQ_GRID_STEP - 2 * VEQ_GRID_GAP;
  const left = center - width / 2;
  return { key: `g${i}`, label: '', color: bandColorForFreq(freq), left: left.toFixed(2), width: width.toFixed(2), center: center.toFixed(2) };
});

// { freqs, db } curve from a channel's 48-point grid, when present — the
// idle placeholder set and stale/older engines omit `curve` entirely, in
// which case the caller falls back to liveBandCurve's 7-band curve. A
// present-but-malformed length (not exactly ANALYZER_GRID_POINTS) is also
// treated as absent rather than partially rendered.
export function liveAnalyzerCurve(ch: LiveMeterChannel): SpectrumCurve | null {
  const curve = ch.curve;
  if (!Array.isArray(curve) || curve.length !== ANALYZER_GRID_POINTS) return null;
  return { freqs: ANALYZER_GRID_FREQS, db: curve.map((v) => (Number.isFinite(v) ? v : -120)) };
}

// 48 grid bars, one per ANALYZER_GRID_FREQS point — no per-bar numeric
// readouts (48 of them are unreadable) and no `loud` highlight (band-level
// "loudest" is noise at this resolution; the 7 band labels keep that
// emphasis instead, driven by the band-level curve — see eqPaneSectionParts).
export function veqGridBarsHTML(gridDb: number[]): string {
  return VEQ_GRID_BARS.map((b, i) => {
    const v = veqBandView(gridDb[i]);
    const cls = 'veq-bar' + (v.dim ? ' dim' : '');
    return `<div class="${cls}" data-band="${b.key}" style="left:${b.left}%;width:${b.width}%;height:${v.pct.toFixed(2)}%;background:${b.color}"></div>`;
  }).join('');
}

// { freqs, db } curve for one channel. Non-finite band values (a malformed
// tick) floor to -120 so the arc always has 7 usable points and the channel
// never collapses.
export function liveBandCurve(bands: Record<string, number>): SpectrumCurve {
  return {
    freqs: VEQ_FREQS,
    db: LIVE_BAND_KEYS.map((k) => { const v = bands[k]; return Number.isFinite(v) ? v : -120; }),
  };
}

// Fixed dB scale so the arc's geometry matches the bars and stays put across ticks.
// `idx` is either a strip's numeric channel index (per-strip callers, historical)
// or a stable string uid (the EQ pane's 'pane-a'/'pane-b' slots, #668) — either
// way it only ever interpolates into the `live${idx}` SVG uid string, so widening
// this from `number` to `number | string` is a pure signature change.
export function veqArcSVG(curve: SpectrumCurve, centroid: number | undefined, idx: number | string, wantPaths?: boolean): string | SpectrumCurvePaths {
  return spectrumCurveSVG(curve, centroid, null, { uid: `live${idx}`, vbH: VEQ_VB_H, yMin: DB_MIN, yMax: DB_MAX, wantPaths });
}

export function veqChannelHTML(ch: LiveMeterChannel, idx: number, stripView: StripView, panel: PanelView): string {
  const strip = stripView.strip;
  const displayName = stripView.displayName;
  const selected = stripView.selected;
  const armed = stripView.armed;
  // Inline track definition (#189): the { kind, a, b } strip, rendered right in
  // the header so an engineer never has to leave the workspace to define a
  // track. Disabled mid-capture like every other config control (#38).
  const stereo = !!(strip && strip.kind === 'stereo');
  const n = panel.deviceChannels;
  const defDisabled = panel.liveRunning ? ' disabled' : '';
  const defHTML = `<span class="live-ch-def">
      <select class="live-ch-kind" data-idx="${idx}" aria-label="Mono or stereo"${defDisabled}>
        <option value="mono"${!stereo ? ' selected' : ''}>Mono</option>
        <option value="stereo"${stereo ? ' selected' : ''}>Stereo</option>
      </select>
      <select class="live-ch-src${stereo ? ' leg' : ''}" data-idx="${idx}" data-field="a" aria-label="${stereo ? 'Left source channel' : 'Source channel'}" title="${stereo ? 'Left source channel' : 'Source channel'}"${defDisabled}>${channelOptions(strip ? strip.a : 0, n, stereo)}</select>
      ${stereo ? `<select class="live-ch-src leg" data-idx="${idx}" data-field="b" aria-label="Right source channel" title="Right source channel"${defDisabled}>${channelOptions((strip as StripConfig).b, n, true)}</select>` : ''}
    </span>`;
  // Per-track group assignment (#190): only meaningful once a group exists —
  // Ungrouped plus every group, writing through window.groupState with its
  // exclusive-membership rules. Disabled mid-capture like the rest of the
  // config (#38).
  const grpOf = stripView.groupIndex;
  const groupHTML = panel.groups.length
    ? `<select class="live-ch-group" data-idx="${idx}" aria-label="Assign track to group" title="Assign to group"${defDisabled}>`
      + `<option value="-1"${grpOf === -1 ? ' selected' : ''}>Ungrouped</option>`
      + panel.groups.map((grp, gi) => `<option value="${gi}"${grpOf === gi ? ' selected' : ''}>${escapeHtml(grp.name)}</option>`).join('')
      + `</select>`
    : '';
  // Per-input instrument profile assignment (#524): defaults from the label
  // (Auto) or an explicit override, feeding a later per-input analysis pass
  // an appropriate EQ target instead of one generic curve. Graceful degrade
  // when the caller has no profile catalog to offer (same spirit as groups).
  const profiles = panel.instrumentProfiles;
  const profileAuto = stripView.instrumentAuto;
  const profileHTML = profiles && profiles.length
    ? `<select class="live-ch-profile" data-idx="${idx}" aria-label="Instrument profile" title="Instrument profile"${defDisabled}>`
      + `<option value="auto"${profileAuto ? ' selected' : ''}>Auto — ${(profiles.find((p) => p.id === stripView.instrumentProfileId) || profiles[0]).label}</option>`
      + profiles.map((p) => `<option value="${p.id}"${!profileAuto && p.id === stripView.instrumentProfileId ? ' selected' : ''}>${p.label}</option>`).join('')
      + `</select>`
    : '';
  // The workspace remove control (#188) rides every strip — idle or live — so
  // it stays present-but-disabled through a capture (read-only while running)
  // rather than disappearing, and is allowed down to zero strips so the empty
  // state stays reachable.
  // Per-strip drag handle (#483) only applies within a group — cross-group
  // moves stay on the .live-ch-group dropdown (#33 follow-up).
  const dragHTML = grpOf !== -1
    ? `<button type="button" class="live-ch-drag" draggable="true" aria-label="Reorder track within group — drag, or press Arrow Up/Down" title="Drag to reorder track"${panel.liveRunning ? ' disabled' : ''}>⋮⋮</button>`
    : '';
  return `<div class="live-ch${selected ? ' selected' : ''}${ch.idle ? ' idle' : ''}${stripView.groupCollapsed ? ' group-collapsed' : ''}" data-ch="${idx}"${selected ? ' aria-current="true"' : ''} tabindex="0" role="button" aria-label="Select ${escapeHtml(displayName)} to inspect in the EQ pane">
    <div class="live-ch-head">
      ${dragHTML}
      ${panel.liveMode === 'record'
        ? `<button type="button" class="live-ch-arm" data-idx="${idx}" aria-pressed="${armed}" aria-label="${armed ? 'Disarm' : 'Arm'} track for recording" title="${armed ? 'Armed for recording — click to disarm' : 'Disarmed — click to arm'}"${panel.liveRunning ? ' disabled' : ''}></button>`
        : ''}
      <span class="live-ch-name${ch.clipping ? ' clip' : ''}" contenteditable="true" spellcheck="false" role="textbox" aria-label="Channel name — click to rename" title="Click to rename">${escapeHtml(displayName)}</span>
      ${defHTML}
      ${groupHTML}
      ${profileHTML}
      <span class="live-ch-level" aria-hidden="true"><span class="live-ch-level-fill" style="width:${levelPercent(ch.rms, !!ch.idle)}%"></span></span>
      <span class="live-ch-meta">${ch.idle ? 'Idle' : `RMS ${fmt(ch.rms)} · Peak ${fmt(ch.peak)} dBFS`}</span>
      ${ch.clipping ? '<span class="live-ch-clip">CLIP</span>' : ''}
      <button type="button" class="live-ch-x" title="Remove track" aria-label="Remove track"${panel.liveRunning ? ' disabled' : ''}>×</button>
    </div>
  </div>`;
}

/* ── Live EQ pane (#668) ──
 * The per-strip chart moved off the compact channel strip and into a single
 * shared pane: a "Room" section (the measurement-source channel, same
 * resolution as measurementChannel()/the header badge) and a "Selected"
 * section (whichever strip an engineer last clicked). levelPercent drives the
 * inline level-bar left behind on the now-chartless strip (veqChannelHTML). */
export const EQ_PANE_MIN_W = 260;
export const EQ_PANE_MAX_W = 640;
export const EQ_PANE_DEFAULT_W = 360;
export const EQ_PANE_RESIZE_STEP = 16; // px per keyboard resize step (stage 2)

// Clamps a persisted/dragged pane width into [EQ_PANE_MIN_W, EQ_PANE_MAX_W];
// any non-finite/non-number input (corrupted settings.json, a stray NaN mid-
// drag) falls back to EQ_PANE_DEFAULT_W rather than propagating garbage.
export function clampEqPaneWidth(w: unknown): number {
  if (typeof w !== 'number' || !Number.isFinite(w)) return EQ_PANE_DEFAULT_W;
  return Math.min(EQ_PANE_MAX_W, Math.max(EQ_PANE_MIN_W, w));
}

// Maps an RMS dBFS reading onto the same [DB_MIN, DB_MAX] window the arc/bars
// use, as a 0-100 percentage for the compact strip's inline level-fill bar.
// Idle strips (no signal yet) and a non-finite reading both read as empty
// rather than pinning to either end of the scale.
export function levelPercent(rms: number, idle: boolean): number {
  if (idle || !Number.isFinite(rms)) return 0;
  return toPct(rms);
}

export interface EqPaneSection { idx: number; label: string; ch: LiveMeterChannel }

export interface EqPaneView {
  primary: EqPaneSection | null;
  secondary: EqPaneSection | null;
  secondaryIsPrimary: boolean;
}

// Resolves the pane's two slots from the same inputs the runtime already
// tracks: measurementSource (the "Room" reading — see measurementChannel's
// fallback-to-channel-0 contract, mirrored here so the two never disagree)
// and selectedChannel (the "Selected" reading, #668's new per-strip click
// target). `primary` is null only when there are no channels at all;
// `secondary` is null whenever selectedChannel isn't a live channel index.
export function eqPaneView(
  channels: LiveMeterChannel[],
  config: StripConfig[],
  measurementSource: number | null,
  selectedChannel: number | null,
): EqPaneView {
  let primary: EqPaneSection | null = null;
  if (channels.length > 0) {
    const idx = measurementSource != null && channels[measurementSource] ? measurementSource : 0;
    primary = { idx, label: measurementSourceOptionLabel(config[idx], idx), ch: channels[idx] };
  }
  let secondary: EqPaneSection | null = null;
  if (selectedChannel != null && selectedChannel >= 0 && selectedChannel < channels.length) {
    secondary = { idx: selectedChannel, label: measurementSourceOptionLabel(config[selectedChannel], selectedChannel), ch: channels[selectedChannel] };
  }
  const secondaryIsPrimary = !!(primary && secondary && primary.idx === secondary.idx);
  return { primary, secondary, secondaryIsPrimary };
}

// Shared, uid-independent per-section work (curve, loudest band, bars/labels
// markup — none of it references a section's SVG uid) — computed once per
// distinct channel and reused for both pane slots when the selected channel
// is also the measurement source (secondaryIsPrimary), instead of redoing
// the same curve/loudest-band/bars/labels work twice for identical input.
interface EqPaneSectionParts { curve: SpectrumCurve; loudestIdx: number; bars: string; labels: string }
function eqPaneSectionParts(section: EqPaneSection): EqPaneSectionParts {
  const bandCurve = liveBandCurve(section.ch.bands);
  const gridCurve = liveAnalyzerCurve(section.ch);
  const loudestIdx = veqLoudestIdx(bandCurve.db); // band-level, drives the 7 band labels only
  const { bars: bandBars, labels } = veqBarsAndLabelsHTML(VEQ_BANDS, bandCurve.db, loudestIdx);
  return {
    curve: gridCurve ?? bandCurve, // the arc gets the full 48-point resolution for free
    loudestIdx,
    bars: gridCurve ? veqGridBarsHTML(gridCurve.db) : bandBars,
    labels,
  };
}

// Shared by eqPaneHTML's two sections — same .veq/.veq-bars/.veq-labels shape
// veqChannelHTML used to render per-strip, now rendered once per pane slot.
// Only the arc SVG is regenerated per call: its uid ('pane-a'/'pane-b') has
// to differ between the two slots so their element ids don't collide, even
// when both slots show the same channel.
function eqPaneSectionHTML(section: EqPaneSection, headerHTML: string, uid: string, parts: EqPaneSectionParts): string {
  return `<div class="eq-pane-header">${headerHTML}</div>
    <div class="veq">
      <div class="veq-chart">${veqArcSVG(parts.curve, section.ch.centroid, uid)}</div>
      <div class="veq-bars" style="${VEQ_INSET}">${parts.bars}</div>
    </div>
    <div class="veq-labels" style="${VEQ_LABEL_MARGIN}">${parts.labels}</div>`;
}

// The pane body: "Room — <label>" always (defensive-only null check — the
// runtime never calls this with an empty channels list) plus "Selected —
// <label>" once a strip has been clicked, or an empty-state hint until then.
export function eqPaneHTML(view: EqPaneView): string {
  let html = '';
  const primaryParts = view.primary ? eqPaneSectionParts(view.primary) : null;
  if (view.primary && primaryParts) {
    const header = `Room — ${escapeHtml(view.primary.label)}`;
    html += `<div class="eq-pane-section eq-pane-primary">${eqPaneSectionHTML(view.primary, header, 'pane-a', primaryParts)}</div>`;
  }
  if (view.secondary) {
    const suffix = view.secondaryIsPrimary ? ' · Measurement source' : '';
    const header = `Selected — ${escapeHtml(view.secondary.label)}${suffix}`;
    const secondaryParts = view.secondaryIsPrimary && primaryParts ? primaryParts : eqPaneSectionParts(view.secondary);
    html += `<div class="eq-pane-section eq-pane-secondary">${eqPaneSectionHTML(view.secondary, header, 'pane-b', secondaryParts)}</div>`;
  } else {
    html += `<div class="eq-pane-section eq-pane-secondary eq-pane-empty">`
      + `<div class="eq-pane-header">Selected</div>`
      + `<div class="eq-pane-empty-hint">Click a channel to inspect it here</div></div>`;
  }
  return html;
}

// Cheap identity string the runtime diffs to decide "rebuild the pane's DOM
// from scratch vs patch the existing arcs in place" — changes exactly when
// eqPaneHTML's visible content (which channel, which label, the "Measurement
// source" suffix) would change, and stays stable across ticks that only move
// the needle (those are patched via eqPanePatchPlan instead).
// 'g' once a channel carries a 48-point grid curve, 'b' for the 7-band
// fallback — so a channel gaining/losing `curve` (idle → first live tick, or
// a stale engine) rebuilds the pane's DOM instead of patching a 48-entry
// grid onto 7-bar markup (or vice versa).
function sectionRenderMode(section: EqPaneSection | null): string {
  if (!section) return '';
  return liveAnalyzerCurve(section.ch) ? 'g' : 'b';
}

export function eqPaneSignature(view: EqPaneView): string {
  const { primary, secondary, secondaryIsPrimary } = view;
  return `${primary?.idx ?? ''}:${primary?.label ?? ''}:${sectionRenderMode(primary)} ${secondary?.idx ?? ''}:${secondary?.label ?? ''}:${secondaryIsPrimary}:${sectionRenderMode(secondary)}`;
}

export interface EqPaneSectionPatch {
  curve: SpectrumCurve;
  loudestIdx: number;
  gridDb: number[] | null;
  arc: string | SpectrumCurvePaths;
}

export interface EqPanePatchPlan {
  primary: EqPaneSectionPatch | null;
  secondary: EqPaneSectionPatch | null;
}

// Per-tick "what changed" for the pane's two arcs — mirrors
// patchLiveChannelPlan's curve/loudestIdx/arc shape (below), just computed
// for the pane's up-to-two sections instead of once per strip. curve/
// loudestIdx are reused between slots when secondaryIsPrimary (same channel)
// — only the uid-scoped arc SVG has to be regenerated per slot.
export function eqPanePatchPlan(view: EqPaneView): EqPanePatchPlan {
  function curveFor(section: EqPaneSection): { curve: SpectrumCurve; loudestIdx: number; gridDb: number[] | null } {
    const bandCurve = liveBandCurve(section.ch.bands);
    const gridCurve = liveAnalyzerCurve(section.ch);
    return {
      curve: gridCurve ?? bandCurve,
      loudestIdx: veqLoudestIdx(bandCurve.db), // band-level, drives the 7 band labels only
      gridDb: gridCurve ? gridCurve.db : null,
    };
  }
  function planFor(section: EqPaneSection, uid: string, parts: { curve: SpectrumCurve; loudestIdx: number; gridDb: number[] | null }): EqPaneSectionPatch {
    return {
      curve: parts.curve,
      loudestIdx: parts.loudestIdx,
      gridDb: parts.gridDb,
      arc: veqArcSVG(parts.curve, section.ch.centroid, uid, true),
    };
  }
  const primaryParts = view.primary ? curveFor(view.primary) : null;
  const secondaryParts = view.secondary
    ? (view.secondaryIsPrimary && primaryParts ? primaryParts : curveFor(view.secondary))
    : null;
  return {
    primary: view.primary && primaryParts ? planFor(view.primary, 'pane-a', primaryParts) : null,
    secondary: view.secondary && secondaryParts ? planFor(view.secondary, 'pane-b', secondaryParts) : null,
  };
}

// Group-level summary (#483): a compact "N tracks · Peak X dBFS" readout shown
// on a collapsed group's header so an engineer can still see the group is
// live without expanding it. Out-of-range members (a group referencing a
// since-removed strip) are excluded, mirroring liveMetersHTML's own filter.
export interface GroupSummary { count: number; peak: number | null; clipping: boolean; idle: boolean }
export function groupSummary(channels: LiveMeterChannel[], members: number[]): GroupSummary {
  const present = members.filter((m) => m < channels.length).map((m) => channels[m]);
  let peak: number | null = null;
  let clipping = false;
  let idle = true;
  present.forEach((ch) => {
    if (!ch.idle) idle = false;
    if (ch.clipping) clipping = true;
    if (Number.isFinite(ch.peak) && (peak === null || ch.peak > peak)) peak = ch.peak;
  });
  return { count: present.length, peak, clipping, idle };
}

export function groupSummaryText(s: GroupSummary): string {
  const label = `${s.count} ${s.count === 1 ? 'track' : 'tracks'}`;
  return s.idle || s.peak === null ? label : `${label} · Peak ${fmt(s.peak)} dBFS`;
}

// #488: after a capture stops, offer "View report card" only when the session
// actually built one — monitor mode with at least one accumulated window tick.
// (Record mode keeps its own "Session saved" offer; a capture stopped before
// the first window has nothing to show.)
export function shouldOfferReportCard(mode: string, windowCount: number): boolean {
  return mode === 'monitor' && windowCount > 0;
}

// Live board strip HTML grouped under named-group headers (#41); ungrouped strips
// fall into a trailing default section. Strips keep their original channel index
// as data-ch so patching/labels/arming stay index-addressed. With no groups this
// is just the flat strip list (backward-compatible with #40).
export function liveMetersHTML(channels: LiveMeterChannel[], stripViews: StripView[], panel: PanelView): string {
  const n = channels.length;
  let html = '';
  const rendered = new Set<number>();
  panel.groups.forEach((grp, g) => {
    const collapsed = !!grp.collapsed;
    const summary = groupSummary(channels, grp.members);
    html += `<div class="live-group-head${collapsed ? ' collapsed' : ''}" data-group="${g}">`
      + `<button type="button" class="live-group-drag" draggable="true" aria-label="Reorder group — drag, or press Arrow Up/Down" title="Drag to reorder group"${panel.liveRunning ? ' disabled' : ''}>⋮⋮</button>`
      + `<button type="button" class="live-group-fold" aria-label="Collapse or expand group" aria-expanded="${collapsed ? 'false' : 'true'}" title="Collapse / expand group">▾</button>`
      + `<span class="live-group-name">${escapeHtml(grp.name)}</span>`
      + `<span class="live-group-summary">${escapeHtml(groupSummaryText(summary))}${summary.clipping ? '<span class="live-ch-clip">CLIP</span>' : ''}</span>`
      + `<button type="button" class="live-group-rename" aria-label="Rename group" title="Rename group"${panel.liveRunning ? ' disabled' : ''}>Rename</button>`
      + `<button type="button" class="live-group-del" aria-label="Delete group" title="Delete group"${panel.liveRunning ? ' disabled' : ''}>Delete</button></div>`;
    const members = grp.members.filter((m) => m < n);
    if (!members.length) html += `<div class="live-group-empty">No strips assigned</div>`;
    members.forEach((m) => { html += veqChannelHTML(channels[m], m, stripViews[m], panel); rendered.add(m); });
  });
  const ung: number[] = [];
  for (let i = 0; i < n; i++) if (!rendered.has(i)) ung.push(i);
  if (panel.groups.length && ung.length) {
    html += `<div class="live-group-head ungrouped" data-group="-1"><span class="live-group-name">Ungrouped</span></div>`;
  }
  ung.forEach((i) => { html += veqChannelHTML(channels[i], i, stripViews[i], panel); });
  return html;
}

/* ── Channel configuration ── */
export function channelOptions(selected: number, max: number, compact = false): string {
  let html = '';
  // Compact (numeric-only) labels for the two stereo legs, which share the row
  // with the kind select; roomy "Ch N" for the single mono select.
  const label = (i: number) => (compact ? `${i + 1}` : `Ch ${i + 1}`);
  for (let i = 0; i < max; i++) html += `<option value="${i}"${i === selected ? ' selected' : ''}>${label(i)}</option>`;
  return html;
}

// Total device channels consumed by config (mono=1, stereo=2).
export function usedChannelCount(config: StripConfig[]): number {
  return config.reduce((n, s) => n + (s.kind === 'stereo' ? 2 : 1), 0);
}

/* ── Measurement source (#456) ──
 * `measurementSource` is a strip index into channelConfig — null means "first
 * track (default)", today's channels[0] behavior. Normalized at every
 * boundary (rig apply, select change, store) so a stale/out-of-range index
 * never lingers in state. */
export function normalizeMeasurementSource(source: number | null | undefined, stripCount: number): number | null {
  if (source == null) return null;
  if (!Number.isInteger(source)) return null;
  if (source < 0 || source >= stripCount) return null;
  return source;
}

// Mirrors groupState.pruneStrip's reindexing contract: the removed strip's
// own selection resets to default, strips above it shift down to stay
// pointed at the same physical strip, strips below are untouched.
export function measurementSourceAfterRemove(source: number | null, removedIdx: number): number | null {
  if (source === null) return null;
  if (source === removedIdx) return null;
  if (source > removedIdx) return source - 1;
  return source;
}

export function measurementSourceOptionLabel(strip: StripConfig | null | undefined, idx: number): string {
  const label = strip?.label?.trim();
  return label ? label : `Track ${idx + 1}`;
}

export function measurementSourceOptionsHTML(config: StripConfig[], selected: number | null): string {
  let html = `<option value=""${selected === null ? ' selected' : ''}>First track (default)</option>`;
  config.forEach((strip, i) => {
    html += `<option value="${i}"${i === selected ? ' selected' : ''}>${escapeHtml(measurementSourceOptionLabel(strip, i))}</option>`;
  });
  return html;
}

// Resolves which tick channel the analysis indicators read: the selected
// strip's channel, falling back to channel 0 when the selection is null or
// the tick doesn't carry that channel (so a stale index never sticks).
export function measurementChannel<T>(channels: T[] | undefined, source: number | null): T | null {
  if (!channels || channels.length === 0) return null;
  return channels[source ?? 0] ?? channels[0] ?? null;
}

// Badge text for the live header: "Measuring: <label>" for the strip the
// analysis is actually reading (post-fallback), so stale labels never show.
export function measurementSourceBadgeText(config: StripConfig[], source: number | null): string {
  if (config.length === 0) return 'Measuring: First track';
  const idx = source != null && config[source] ? source : 0;
  return `Measuring: ${measurementSourceOptionLabel(config[idx], idx)}`;
}

/* ── Device picker ── */
export function deviceOptionLabel(d: LiveDevice): string {
  return `${d.index}: ${d.name} (${d.channels}ch, ${d.default_sr}Hz)`;
}

// The selected device's max input channels (0 = default device / unknown).
// The `2` fallback is the same default channel count sox/stream.py assume
// when nothing better is known.
export const DEFAULT_DEVICE_CHANNELS = 2;
export function deviceChannelCount(selectedValue: string, devices: LiveDevice[]): number {
  if (selectedValue === '') {
    // Default device: fall back to the max across enumerated inputs so the
    // picker still offers something sensible.
    return devices.reduce((m, d) => Math.max(m, d.channels || 0), 0) || DEFAULT_DEVICE_CHANNELS;
  }
  const dev = devices.find((d) => String(d.index) === selectedValue);
  return dev ? dev.channels : DEFAULT_DEVICE_CHANNELS;
}

// Resolves loadDevices' branching (mic blocked / list error / empty / happy
// path) into data the caller can render without re-deriving the logic.
export function deviceListView(result: ListDevicesResult): DeviceListView {
  if (result.micAccess === 'denied' || result.micAccess === 'restricted') {
    return {
      devices: [],
      options: [{ value: '', label: 'Microphone access blocked' }],
      hint: { text: 'Sound Buddy is blocked from the microphone. Enable it in System Settings ▸ Privacy & Security ▸ Microphone, then click Refresh.', isError: true },
    };
  }
  if (!result.success) {
    return {
      devices: [],
      options: [{ value: '', label: 'Could not list devices' }],
      hint: { text: result.error || 'Failed to enumerate input devices.', isError: true },
    };
  }
  if (!result.devices || result.devices.length === 0) {
    return {
      devices: [],
      options: [{ value: '', label: 'No input devices found' }],
      hint: { text: 'No microphone or audio interface is connected. Plug one in and click Refresh. (Mac desktops have no built-in mic.)', isError: false },
    };
  }
  const options: DeviceOption[] = [{ value: '', label: 'Default Device' }];
  for (const d of result.devices) options.push({ value: String(d.index), label: deviceOptionLabel(d) });
  return {
    devices: result.devices,
    options,
    // Devices exist. If macOS hasn't been asked yet, it'll prompt on Start.
    hint: result.micAccess === 'not-determined'
      ? { text: 'macOS will ask for microphone permission the first time you start capture.', isError: false }
      : null,
  };
}

/* ── Live-capture report-card source (TD-001 slice 5, #423) ──
 * Builds the live-capture card's report-card source shape from the rolling
 * liveWindows buffer — mirrors the old getReportCardSource() live fallback.
 * Verbatim port of inline-app.js's liveReportCardSource(), now a pure
 * function taking the buffer as a parameter instead of reading the module-
 * level liveWindows var; liveCaptureStore writes analysisStore.liveSource
 * from this wherever liveWindows changes (bridge.ts's cross-store
 * subscription). */
// Maps stream.py's snake_case band keys to grading.js's camelCase shape.
// Shared by liveReportCardSource's own `bands:` field and
// liveChannelContributors below so the seven-key mapping lives in one place.
function liveBandsToCamel(bands: Record<string, number>): Record<string, number> {
  return {
    subBass: bands.sub_bass,
    bass: bands.bass,
    lowMid: bands.low_mid,
    mid: bands.mid,
    highMid: bands.high_mid,
    presence: bands.presence,
    brilliance: bands.brilliance,
  };
}

/* Maps the live tick's per-channel data into grading.js's camelCase band shape,
 * overlaying each strip's saved label so band-balance recommendations can name
 * the loudest contributing channel (#262). */
export function liveChannelContributors(
  channels: ChannelWindowData[] | undefined,
  config: StripConfig[] = [],
): Array<{ label?: string; name?: string; bands: Record<string, number> }> {
  if (!channels || channels.length === 0) return [];
  return channels.map((ch, i) => ({
    label: config[i]?.label?.trim() || undefined,
    name: ch.name,
    bands: liveBandsToCamel(ch.bands),
  }));
}

export function liveReportCardSource(
  liveWindows: LiveEvent[],
  measurementSource: number | null = null,
  config: StripConfig[] = [],
): ReportCardSource | null {
  if (liveWindows.length === 0) return null;
  const win = liveWindows[liveWindows.length - 1];
  let idx = measurementSource ?? 0;
  if (!win.channels || !win.channels[idx]) idx = 0;
  const ch = win.channels && win.channels[idx];
  if (!ch) return null;
  const label = config[idx]?.label?.trim() || ch.name || 'Main';
  return {
    filename: `Live capture — ${label} (window #${(win as WindowData).window})`,
    rms: ch.rms,
    peak: ch.peak,
    dynamicRange: null,
    clipping: ch.clipping,
    centroid: ch.centroid,
    bands: liveBandsToCamel(ch.bands),
    channels: liveChannelContributors(win.channels, config),
  };
}

/* ── Live-capture SESSION report-card source (#261) ──
 * A one-shot card synthesized at Stop Capture from the entire accumulated
 * liveWindows buffer — distinct from liveReportCardSource above, which stays
 * the rolling last-window-only preview bridge.ts feeds the tab while a
 * capture runs. Never modifies or replaces liveReportCardSource. */

// Fewer accumulated window ticks than this is a capture stopped almost
// immediately — mirrors live-adjustments-state.js's MIN_WINDOWS=3 precedent:
// grading it would produce a confident-looking letter from a second of audio.
export const MIN_SESSION_WINDOWS = 3;

export function hasEnoughSessionData(liveWindows: LiveEvent[]): boolean {
  return liveWindows.length >= MIN_SESSION_WINDOWS;
}

// The seven camelCase band keys liveBandsToCamel always produces, shared here
// so the per-band session mean iterates the same fixed key set.
const CAMEL_BAND_KEYS = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance'] as const;

function meanBands(campedBandsList: Record<string, number>[]): Record<string, number> {
  const bands: Record<string, number> = {};
  CAMEL_BAND_KEYS.forEach((key) => {
    const values = campedBandsList
      .map((b) => b[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length > 0) bands[key] = values.reduce((sum, v) => sum + v, 0) / values.length;
  });
  return bands;
}

interface UsableSessionWindow { idx: number; ch: ChannelWindowData; win: WindowData }

export function liveSessionReportCardSource(
  liveWindows: LiveEvent[],
  measurementSource: number | null = null,
  config: StripConfig[] = [],
): ReportCardSource | null {
  if (!hasEnoughSessionData(liveWindows)) return null;

  const usable: UsableSessionWindow[] = [];
  for (const w of liveWindows) {
    const win = w as WindowData;
    let idx = measurementSource ?? 0;
    if (!win.channels || !win.channels[idx]) idx = 0;
    const ch = win.channels && win.channels[idx];
    if (!ch) continue;
    usable.push({ idx, ch, win });
  }
  if (usable.length < MIN_SESSION_WINDOWS) return null;

  const n = usable.length;
  const rms = usable.reduce((sum, u) => sum + u.ch.rms, 0) / n;
  const peak = Math.max(...usable.map((u) => u.ch.peak));
  const centroids = usable
    .map((u) => u.ch.centroid)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  const centroid = centroids.length > 0 ? centroids.reduce((sum, c) => sum + c, 0) / centroids.length : undefined;
  const clipping = usable.some((u) => !!u.ch.clipping);
  const bands = meanBands(usable.map((u) => liveBandsToCamel(u.ch.bands)));

  const last = usable[usable.length - 1];
  const label = config[last.idx]?.label?.trim() || last.ch.name || 'Main';

  return {
    filename: `Live capture — ${label} (${n} windows)`,
    rms,
    peak,
    dynamicRange: null,
    clipping,
    centroid,
    bands,
    channels: liveChannelContributors(last.win.channels, config),
  };
}

/* ── Live-tick DOM patching (TD-001 slice 5, #423) ──
 * patchLiveChannelPlan is the pure "what changed" computation (meta text,
 * selected/idle flags, the inline level-bar percentage) — fully unit-tested
 * below. Strips no longer carry their own chart (#668 moved that to the
 * shared EQ pane — see eqPanePatchPlan above), which is the performance win
 * the issue is about: a tick with N strips no longer recomputes N arcs.
 * patchLiveChannel is the thin DOM applier ported verbatim from
 * inline-app.js's patchLiveChannel; it stays c8-ignored for the same reason
 * as spectrum-display.ts's patchBarsAndLabels (no jsdom in this harness) and
 * is exercised by the live-capture-* e2e specs. */
export interface LiveChannelPatchPlan {
  selected: boolean;
  idle: boolean;
  displayName: string;
  clipping: boolean;
  meta: string;
  removeDisabled: boolean;
  levelPercent: number;
}

export function patchLiveChannelPlan(
  ch: LiveMeterChannel,
  idx: number,
  stripView: StripView,
  isCapturing: boolean
): LiveChannelPatchPlan {
  return {
    selected: stripView.selected,
    idle: !!ch.idle,
    displayName: stripView.displayName,
    clipping: !!ch.clipping,
    meta: ch.idle ? 'Idle' : `RMS ${fmt(ch.rms)} · Peak ${fmt(ch.peak)} dBFS`,
    removeDisabled: isCapturing,
    levelPercent: levelPercent(ch.rms, !!ch.idle),
  };
}

/* c8 ignore start -- DOM-patching applier, no jsdom in this harness
   (renderToString only) — same precedent as spectrum-display.ts's
   patchBarsAndLabels; exercised by the live-capture-* e2e specs. */
export function patchLiveChannel(
  el: Element,
  ch: LiveMeterChannel,
  idx: number,
  stripView: StripView,
  isCapturing: boolean
): void {
  const plan = patchLiveChannelPlan(ch, idx, stripView, isCapturing);
  el.classList.toggle('selected', plan.selected);
  if (plan.selected) el.setAttribute('aria-current', 'true');
  else el.removeAttribute('aria-current');
  el.classList.toggle('idle', plan.idle); // a real tick landing on a prior idle placeholder graduates it
  const name = el.querySelector('.live-ch-name');
  // Don't clobber the field while the engineer is renaming it in place (#39);
  // the live tick keeps flowing but their caret/text stays put until they commit.
  if (name && document.activeElement !== name) name.textContent = plan.displayName;
  if (name) name.classList.toggle('clip', plan.clipping);
  const meta = el.querySelector('.live-ch-meta');
  if (meta) meta.textContent = plan.meta;
  const removeBtn = el.querySelector('.live-ch-x') as HTMLButtonElement | null;
  if (removeBtn) removeBtn.disabled = plan.removeDisabled;
  const clipEl = el.querySelector('.live-ch-clip');
  // Insert just before the remove button (#188) so CLIP lands in the same spot
  // whether it was there on the first tick (static template order) or shows up
  // later — .live-ch-x carries the head's margin-left:auto right-alignment.
  if (plan.clipping && !clipEl && removeBtn) removeBtn.insertAdjacentHTML('beforebegin', '<span class="live-ch-clip">CLIP</span>');
  else if (!plan.clipping && clipEl) clipEl.remove();

  const levelFill = el.querySelector('.live-ch-level-fill') as HTMLElement | null;
  if (levelFill) levelFill.style.width = `${plan.levelPercent}%`;
}
/* c8 ignore stop */
