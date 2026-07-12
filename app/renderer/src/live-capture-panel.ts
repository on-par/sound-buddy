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
  veqBarsAndLabelsHTML,
  veqLoudestIdx,
  type SpectrumCurve,
  type SpectrumCurvePaths,
} from './spectrum-display';
import { fmt } from './report-card';
import type {
  LiveEvent,
  MeterData,
  WindowData,
  ChannelWindowData,
  ChannelKind,
} from '../../../packages/audio-engine/src/stream/types';

export type { LiveEvent, MeterData, WindowData, ChannelWindowData, ChannelKind };

export interface LiveDevice { index: number; name: string; channels: number; default_sr: number }
export type MicAccess = 'granted' | 'denied' | 'restricted' | 'not-determined';
export interface ListDevicesResult { success: boolean; error?: string; micAccess?: MicAccess; devices?: LiveDevice[] }
export interface StripConfig { kind: ChannelKind; a: number; b: number; armed?: boolean }
export interface ChannelGroup { name: string; members: number[] }

// A live tick channel as the renderer actually receives it: stream.py sends
// snake_case band keys; the idle workspace synthesizes placeholder channels
// (window.trackWorkspace.idleChannel) that carry only bands/rms/peak + idle.
export type LiveMeterChannel = Pick<ChannelWindowData, 'bands' | 'rms' | 'peak'> &
  Partial<Omit<ChannelWindowData, 'bands' | 'rms' | 'peak'>> & { idle?: boolean };

export interface StripView {   // per-strip state the caller resolves from its stores
  strip: StripConfig | null;   // channelConfig[idx] ?? null
  displayName: string;         // stripLabel(strip, ch, idx) at runtime
  collapsed: boolean;          // isStripCollapsed(idx)
  armed: boolean;              // window.armState.isArmed(strip)
  groupIndex: number;          // window.groupState.groupOf(channelGroups, idx); -1 = ungrouped
}

export interface PanelView {
  deviceChannels: number;      // selectedDeviceChannels()
  liveRunning: boolean;
  liveMode: 'monitor' | 'record';
  groups: ChannelGroup[];      // channelGroups
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
  return { key: b.key, label: b.label, color: b.color, left: bx0.toFixed(2), width: (bx1 - bx0).toFixed(2), center: veqLogPos(VEQ_FREQS[i]).toFixed(2) };
});

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
export function veqArcSVG(curve: SpectrumCurve, centroid: number | undefined, idx: number, wantPaths?: boolean): string | SpectrumCurvePaths {
  return spectrumCurveSVG(curve, centroid, null, { uid: `live${idx}`, vbH: VEQ_VB_H, yMin: DB_MIN, yMax: DB_MAX, wantPaths });
}

export function veqChannelHTML(ch: LiveMeterChannel, idx: number, stripView: StripView, panel: PanelView): string {
  const curve = liveBandCurve(ch.bands);
  const loudestIdx = veqLoudestIdx(curve.db);
  const { bars, labels } = veqBarsAndLabelsHTML(VEQ_BANDS, curve.db, loudestIdx);
  const strip = stripView.strip;
  const displayName = stripView.displayName;
  const collapsed = stripView.collapsed;
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
  // The workspace remove control (#188) rides every strip — idle or live — so
  // it stays present-but-disabled through a capture (read-only while running)
  // rather than disappearing, and is allowed down to zero strips so the empty
  // state stays reachable.
  return `<div class="live-ch${collapsed ? ' collapsed' : ''}${ch.idle ? ' idle' : ''}" data-ch="${idx}">
    <div class="live-ch-head">
      <button type="button" class="live-ch-fold" aria-label="Collapse or expand strip" aria-expanded="${collapsed ? 'false' : 'true'}" title="Collapse / expand strip">▾</button>
      ${panel.liveMode === 'record'
        ? `<button type="button" class="live-ch-arm" data-idx="${idx}" aria-pressed="${armed}" aria-label="${armed ? 'Disarm' : 'Arm'} track for recording" title="${armed ? 'Armed for recording — click to disarm' : 'Disarmed — click to arm'}"${panel.liveRunning ? ' disabled' : ''}></button>`
        : ''}
      <span class="live-ch-name${ch.clipping ? ' clip' : ''}" contenteditable="true" spellcheck="false" role="textbox" aria-label="Channel name — click to rename" title="Click to rename">${escapeHtml(displayName)}</span>
      ${defHTML}
      ${groupHTML}
      <span class="live-ch-meta">${ch.idle ? 'Idle' : `RMS ${fmt(ch.rms)} · Peak ${fmt(ch.peak)} dBFS`}</span>
      ${ch.clipping ? '<span class="live-ch-clip">CLIP</span>' : ''}
      <button type="button" class="live-ch-x" title="Remove track" aria-label="Remove track"${panel.liveRunning ? ' disabled' : ''}>×</button>
    </div>
    <div class="veq">
      <div class="veq-chart">${veqArcSVG(curve, ch.centroid, idx)}</div>
      <div class="veq-bars" style="${VEQ_INSET}">${bars}</div>
    </div>
    <div class="veq-labels" style="${VEQ_LABEL_MARGIN}">${labels}</div>
  </div>`;
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
    html += `<div class="live-group-head" data-group="${g}">`
      + `<button type="button" class="live-group-fold" aria-label="Collapse or expand group" title="Collapse / expand group">▾</button>`
      + `<span class="live-group-name">${escapeHtml(grp.name)}</span>`
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
