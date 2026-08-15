// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free rig + preflight view-model helpers (TD-001 slice 6d,
// #702) — extracted verbatim (behavior-identical) from inline-app.js's
// captureCurrentRig/applyRig/currentActiveRig/relativeTime/renderPreflight/
// populateRigSelect. `window.rigReconcile`/`window.preflight` (pure classic
// scripts) are called through, not reimplemented — see their own test
// suites for the reconciliation/checklist math itself.
//
// CaptureRig's declared TS shape (app/electron/ipc/api.ts) doesn't include
// `groups`/`measurementSource`, even though the runtime rig object has
// always carried both — a pre-6d gap: inline-app.js's untyped
// captureCurrentRig()/applyRig() read and wrote them directly on a plain JS
// object, so nothing ever type-checked the omission. This module carries
// them through via one local extension type rather than widening api.ts's
// CaptureRig (out of scope — the 6d spec's targetTypes marks CaptureRig
// "read", not "changed"), so a saved rig keeps round-tripping its groups and
// measurement source exactly as it always has.

import type { CaptureRig, CaptureRigChannel, PreflightBaseline } from '../../electron/ipc/api';
import {
  deviceChannelCount,
  normalizeMeasurementSource,
  type StripConfig,
  type ChannelGroup,
  type LiveDevice,
} from './live-capture-panel';
import { MAX_LABEL_LEN } from './stores/liveCaptureStore';
import type { LiveCaptureState } from './stores/liveCaptureStore';

type PersistedCaptureRig = CaptureRig & {
  groups?: Array<{ name: string; members: number[] }>;
  measurementSource?: number | null;
};

// Ambient globals this slice's React/store code calls into inline-app.js for:
// rigDialog() (the shared name-prompt modal, also used by channel-group
// naming — stays imperative infrastructure). renderChannelConfig() was removed
// with TD-001 slice 6h (#711): the board + measurement badge re-render
// reactively from liveCaptureStore, so nothing reaches it anymore. Declared
// once here rather than per-caller so rigStore.ts, RigControls.tsx, and
// PreflightPanel all see the same ambient shape.
declare global {
  interface Window {
    rigDialog?(opts: { title?: string; msg?: string; value?: string; confirmLabel?: string; withInput?: boolean }): Promise<string | boolean | null>;
  }
}

export interface CaptureRigSnapshotInput {
  channelConfig: StripConfig[];
  channelGroups: ChannelGroup[];
  measurementSource: number | null;
  liveMode: string;
  recordDir: string;
  selectedDeviceName: string;
  intervalMs: number;
  windowSecs: number;
}

export interface ExistingRig {
  id: string;
  name: string;
  baseline?: PreflightBaseline;
}

// Snapshot the current Live-tab setup into a CaptureRig — port of
// captureCurrentRig(name, id). Device is stored BY NAME (from the selected
// liveDevices entry) so it survives index reordering; an existing rig's
// baseline is carried forward (the plain rig Save button must never
// silently delete it), and a fresh (unsaved) snapshot gets `id: ''` — falsy,
// same as inline-app.js omitting the field entirely — so settings.ts's
// upsertRig() generates a real id server-side.
export function captureCurrentRigSnapshot(
  live: CaptureRigSnapshotInput,
  existing: ExistingRig | null,
  name: string,
): CaptureRig {
  const channelConfig: CaptureRigChannel[] = live.channelConfig.map((s) => {
    const strip: CaptureRigChannel = { kind: s.kind === 'stereo' ? 'stereo' : 'mono', a: s.a, b: s.b };
    // Normalize the label once, at the persistence boundary, so both entry
    // points (config row + inline header) round-trip an identical stored
    // value and an all-whitespace label is dropped rather than saved (#39).
    const label = typeof s.label === 'string' ? s.label.trim().slice(0, MAX_LABEL_LEN) : '';
    if (label) strip.label = label;
    return strip;
  });
  const rig = {
    id: existing ? existing.id : '',
    name,
    deviceName: live.selectedDeviceName,
    channelConfig,
    groups: live.channelGroups.map((g) => ({ name: g.name, members: g.members.slice() })),
    measurementSource: live.measurementSource,
    mode: (live.liveMode === 'record' ? 'record' : 'monitor') as 'monitor' | 'record',
    recordDir: live.recordDir,
    intervalMs: live.intervalMs,
    windowSecs: live.windowSecs,
    baseline: existing?.baseline,
  };
  return rig;
}

export interface RigReconcileApi {
  reconcileRigDevice(deviceName: string, devices: LiveDevice[]): { found: boolean; index: string; deviceName: string };
  clampChannelConfig(channelConfig: CaptureRigChannel[], maxChannels: number): { config: StripConfig[]; adjusted: boolean };
}

// Typed `window.*` accessor for the pure rig-reconcile.js classic-script,
// exported so PreflightPanel.tsx can resolve the same found/deviceName pair
// this module uses internally, rather than duplicating the accessor.
export function getRigReconcile(): RigReconcileApi {
  return (window as unknown as { rigReconcile: RigReconcileApi }).rigReconcile;
}

// Restore a rig into the Live tab — port of applyRig(rig), returning a
// LiveCaptureState patch instead of writing the store directly so the
// "device not found" / "channels clamped" notice text is unit-testable
// without a store. `deviceChannels` is the caller's pre-apply channel count;
// it's accepted for signature parity with the store-side call site but the
// clamp always bounds against the newly-RESOLVED device below, mirroring
// applyRig's own `lcStore.setState({selectedDevice: rec.index})` immediately
// followed by re-reading the resolved device's channel count off the
// just-updated store — a stale pre-apply value would clamp against the wrong
// device.
export function applyRigPatch(
  rig: CaptureRig,
  devices: LiveDevice[],
  deviceChannels: number,
): { patch: Partial<LiveCaptureState>; notice: string } {
  const persisted = rig as PersistedCaptureRig;
  const rec = getRigReconcile().reconcileRigDevice(rig.deviceName, devices);
  let notice = rec.found ? '' : `Rig device "${rig.deviceName}" not found — select a device.`;
  const resolvedChannels = devices.length ? deviceChannelCount(rec.index, devices) : deviceChannels;
  const clamp = getRigReconcile().clampChannelConfig(persisted.channelConfig || [], resolvedChannels);
  const nextConfig: StripConfig[] = clamp.config.length ? clamp.config : [{ kind: 'mono', a: 0, b: 0 }];
  // Hydrate named groups (#41), dropping any member index beyond the
  // (possibly clamped) strip count so no group references a strip that
  // isn't there.
  const nextGroups: ChannelGroup[] = (persisted.groups || []).map((g) => ({
    name: g.name, members: (g.members || []).filter((m) => m < nextConfig.length),
  }));
  if (clamp.adjusted) {
    notice = notice
      ? notice + ' Some channels were out of range and were clamped.'
      : 'Some rig channels were out of range for this device and were clamped.';
  }
  return {
    patch: {
      liveMode: rig.mode === 'record' ? 'record' : 'monitor',
      recordDir: rig.recordDir || '',
      selectedDevice: String(rec.index),
      channelConfig: nextConfig,
      channelGroups: nextGroups,
      // Old rigs without the field resolve to null (default) (#456).
      measurementSource: normalizeMeasurementSource(persisted.measurementSource ?? null, nextConfig.length),
    },
    notice,
  };
}

/* c8 ignore start -- small DOM helper, no jsdom in this harness; exercised
   by tests/rigs.spec.ts's #live-status assertions. */

// Show (or clear) the muted status line under the Start button — port of
// inline-app.js's setLiveStatus.
export function setLiveStatusText(text: string | null): void {
  const ls = document.getElementById('live-status');
  if (!ls) return;
  if (!text) { ls.style.display = 'none'; ls.textContent = ''; return; }
  ls.textContent = text;
  ls.style.display = 'block';
}
/* c8 ignore stop */

export interface RigOptionsView {
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}

// Port of populateRigSelect's option-list shape.
export function rigOptionsView(rigs: CaptureRig[]): RigOptionsView {
  return {
    placeholder: rigs.length ? 'Unsaved setup' : 'No saved rigs',
    options: rigs.map((r) => ({ value: r.id, label: r.name })),
  };
}

// Verbatim port of inline-app.js's relativeTime.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface PreflightChecklistItem {
  id: string;
  label: string;
  detail: string;
  status: 'ok' | 'warn' | 'fail';
}

export interface PreflightViewModel {
  savedText: string;
  bannerText: string;
  ready: boolean;
  items: PreflightChecklistItem[];
}

// The shape window.preflight.snapshotRig() returns — deviceName + strip
// routing, with no `armed` (arming is a capture choice, not routing, so it's
// never drift) and no `savedAt` (added by the caller when persisting a
// baseline; see rigStore.ts's saveBaseline()).
export interface PreflightSnapshot {
  deviceName: string;
  strips: Array<{ kind: 'mono' | 'stereo'; a: number; b: number; label: string }>;
}

interface PreflightApi {
  snapshotRig(channelConfig: StripConfig[], deviceName: string): PreflightSnapshot;
  buildChecklist(opts: {
    baseline: PreflightBaseline | null;
    current: PreflightSnapshot;
    device: { found: boolean; name: string; channels: number };
  }): PreflightChecklistItem[];
  checklistSummary(items: PreflightChecklistItem[]): { counts: { ok: number; warn: number; fail: number }; ready: boolean };
}

// Typed `window.*` accessor for the pure preflight.js classic-script,
// exported so rigStore.ts's saveBaseline() can reuse snapshotRig() directly
// rather than duplicating the accessor.
export function getPreflight(): PreflightApi {
  return (window as unknown as { preflight: PreflightApi }).preflight;
}

// Port of renderPreflight's computation half (not the DOM-writing half) —
// diffs the live channel routing against the active rig's saved baseline.
export function preflightViewModel(
  baseline: PreflightBaseline | null,
  channelConfig: StripConfig[],
  deviceName: string,
  deviceFound: boolean,
  deviceChannels: number,
): PreflightViewModel {
  const device = { found: deviceFound, name: deviceName || 'Default Device', channels: deviceChannels };
  const current = getPreflight().snapshotRig(channelConfig, deviceName);
  const items = getPreflight().buildChecklist({ baseline, current, device });
  const summary = getPreflight().checklistSummary(items);
  return {
    savedText: baseline ? `Baseline saved ${relativeTime(baseline.savedAt)}` : 'No baseline saved',
    bannerText: summary.ready ? 'Ready for service' : 'Not ready — resolve the items below',
    ready: summary.ready,
    items,
  };
}
