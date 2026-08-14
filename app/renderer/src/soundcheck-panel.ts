// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free Virtual Soundcheck view-model helpers (TD-001 slice
// 6d, #702) — extracted verbatim (behavior-identical) from inline-app.js's
// sc* closure (scLoadDevices/scRenderTracks/scChannelOptions/
// scUpdateMixdownNotice/scUpdateGuard), the Soundcheck-tab twin of
// live-capture-panel.ts. `window.playbackRouting` (a pure classic script) is
// called through, not reimplemented — see its own test suite for the routing
// math itself. The saved-bus matching (#756) is a pure addition layered over
// that math.

import type { SoundcheckBus } from '../../electron/ipc/api';

export interface SessionManifestTrack {
  label?: string;
  /** Stem file path within the session (session.json's per-track `file`), so
   *  a saved bus can match on the stem basename when the label is blank (#756). */
  file?: string;
  kind: 'mono' | 'stereo';
}

export interface SessionManifest {
  tracks: SessionManifestTrack[];
}

export interface SoundcheckOutputDevice {
  index: number;
  name: string;
  channels: number;
}

export interface SoundcheckChannelOption {
  value: number;
  label: string;
  selected: boolean;
}

export interface SoundcheckTrackView {
  index: number;
  label: string;
  stereo: boolean;
  routeBase: number;
  options: SoundcheckChannelOption[];
}

interface PlaybackRoutingApi {
  defaultRoutes(tracks: SessionManifestTrack[]): number[][];
  routeSpec(routes: number[][]): string;
  requiredChannels(routes: number[][]): number;
  needsMixdown(routes: number[][], deviceChannels: number, master: boolean): boolean;
}

// Typed `window.*` accessor for the pure playback-routing.js classic-script,
// mirroring liveCaptureStore.ts's getArmState()/getGroupState() convention —
// boot-injected once by App.tsx, read off `window` rather than imported.
export function getPlaybackRouting(): PlaybackRoutingApi {
  return (window as unknown as { playbackRouting: PlaybackRoutingApi }).playbackRouting;
}

// Shapes sb.listOutputDevices()'s raw result — port of scLoadDevices's
// `(result && result.devices) || []`.
export function outputDeviceListView(result: unknown): { devices: SoundcheckOutputDevice[] } {
  const r = result as { devices?: SoundcheckOutputDevice[] } | null | undefined;
  return { devices: (r && r.devices) || [] };
}

// Output-channel options up to the device's channel count (min 2 so a
// default-output session can still address a stereo pair before
// enumeration) — port of scChannelOptions. Exported for the saved-buses UI
// (#756), which builds the bus output-channel <select> from the same mono
// options the per-track route selects use.
export function soundcheckChannelOptions(selectedBase: number, stereo: boolean, deviceChannels: number): SoundcheckChannelOption[] {
  const max = Math.max(deviceChannels || 2, stereo ? 2 : 1);
  const options: SoundcheckChannelOption[] = [];
  if (stereo) {
    for (let c = 0; c + 1 < max; c++) options.push({ value: c, label: `Ch ${c + 1}-${c + 2}`, selected: c === selectedBase });
  } else {
    for (let c = 0; c < max; c++) options.push({ value: c, label: `Ch ${c + 1}`, selected: c === selectedBase });
  }
  return options;
}

// One view-model row per session track — port of scRenderTracks; returns []
// when there's no manifest/tracks (the component renders the `.sc-empty`
// message itself, replacing scRenderTracks's early-return HTML string).
// Routing stays editable while playback runs (#759): the view model carries no
// `disabled` field, and the component's setRoute handler hot-swaps the live
// engine via setPlaybackRoutes rather than requiring Stop first.
export function soundcheckTrackListView(
  manifest: SessionManifest | null,
  routes: number[][],
  deviceChannels: number,
): SoundcheckTrackView[] {
  if (!manifest || !manifest.tracks || !manifest.tracks.length) return [];
  return manifest.tracks.map((t, i) => {
    const stereo = t.kind === 'stereo';
    const r = routes[i] || [0];
    const routeBase = r[0];
    const label = t.label || `Track ${i + 1}`;
    return {
      index: i,
      label,
      stereo,
      routeBase,
      options: soundcheckChannelOptions(routeBase, stereo, deviceChannels),
    };
  });
}

// Port of scUpdateMixdownNotice's text-selection logic — null when hidden.
export function mixdownNoticeText(
  manifest: SessionManifest | null,
  routes: number[][],
  deviceChannels: number,
  master: boolean,
): string | null {
  if (!manifest) return null;
  // Default output (unknown channel count) → let the backend decide and
  // report a `mixdown` event; only pre-warn when a concrete device is too
  // small, or master.
  const tooSmall = deviceChannels > 0 && getPlaybackRouting().needsMixdown(routes, deviceChannels, false);
  if (master || tooSmall) {
    const req = getPlaybackRouting().requiredChannels(routes);
    return master
      ? 'Playing a stereo master mixdown.'
      : `The selected output has ${deviceChannels} channels but the routing needs ${req} — playback folds to a stereo master mixdown.`;
  }
  return null;
}

// Port of scUpdateGuard's `!(scManifest && scDevicesLoaded && !scPlaying)`,
// returning the positive `ok` boolean (Play's `disabled` prop is `!ok`).
export function playGuardOk(manifest: SessionManifest | null, devicesLoaded: boolean, playing: boolean): boolean {
  return !!(manifest && devicesLoaded && !playing);
}

// True when two manifests describe the same track layout — same track count and
// the same `kind` at every index. Used by chooseSession (#755) to decide
// whether a re-import of the same session can keep the user's existing routing
// instead of reseeding sequential defaults.
export function sameTrackShape(a: SessionManifest | null, b: SessionManifest | null): boolean {
  if (!a || !b) return false;
  if (a.tracks.length !== b.tracks.length) return false;
  return a.tracks.every((t, i) => t.kind === b.tracks[i].kind);
}

// Saved-bus matching (#756) — pure, exact + case-insensitive substring on a
// track's label or stem basename. A malformed persisted bus (empty pattern)
// can never match anything.

/** True when `pattern` matches `label` exactly or as a substring,
 *  both case-insensitively after trim. An empty label or empty pattern never
 *  matches. */
export function busPatternMatches(label: string, pattern: string): boolean {
  const a = label.trim().toLowerCase();
  const b = pattern.trim().toLowerCase();
  return a !== '' && b !== '' && (a === b || a.includes(b));
}

/** "ag-left.wav" → "ag-left" — strips the final extension from a stem path's
 *  basename so the matchable stem survives a file that carries an extension. */
function stemBasename(file: string | undefined): string {
  if (!file) return '';
  const base = file.split('/').pop() ?? '';
  return base.replace(/\.[^.]*$/, '');
}

/**
 * Layer saved-bus routes over a session's base routes: for each track, the
 * first bus (definition order) whose pattern matches the track's label OR
 * stem basename wins, overriding that track's route to the bus's saved
 * output — [c] for mono, the adjacent pair [c, c+1] for stereo (matching
 * setRoute's pair convention). Unmatched tracks keep their base route
 * untouched. Always returns one route per track.
 */
export function applyBusRoutes(
  tracks: SessionManifestTrack[],
  baseRoutes: number[][],
  buses: SoundcheckBus[],
): number[][] {
  return tracks.map((t, i) => {
    const bus = buses.find((b) =>
      busPatternMatches(t.label ?? '', b.pattern) || busPatternMatches(stemBasename(t.file), b.pattern),
    );
    if (!bus) return baseRoutes[i] || [0];
    return t.kind === 'stereo' ? [bus.outputChannel, bus.outputChannel + 1] : [bus.outputChannel];
  });
}
