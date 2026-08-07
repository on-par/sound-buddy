// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free Virtual Soundcheck view-model helpers (TD-001 slice
// 6d, #702) — extracted verbatim (behavior-identical) from inline-app.js's
// sc* closure (scLoadDevices/scRenderTracks/scChannelOptions/
// scUpdateMixdownNotice/scUpdateGuard), the Soundcheck-tab twin of
// live-capture-panel.ts. `window.playbackRouting` (a pure classic script) is
// called through, not reimplemented — see its own test suite for the routing
// math itself.

export interface SessionManifestTrack {
  label?: string;
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
  disabled: boolean;
}

// The shape `scRenderMeters` consumed per track (stream.py's 'level' event).
export interface SoundcheckMeterTrack {
  label?: string;
  rms: number;
  peak: number;
  clipping: boolean;
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
// enumeration) — port of scChannelOptions.
function soundcheckChannelOptions(selectedBase: number, stereo: boolean, deviceChannels: number): SoundcheckChannelOption[] {
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
export function soundcheckTrackListView(
  manifest: SessionManifest | null,
  routes: number[][],
  deviceChannels: number,
  playing: boolean,
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
      disabled: playing,
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
