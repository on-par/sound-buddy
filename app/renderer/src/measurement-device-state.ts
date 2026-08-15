// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure state + view helpers for the secondary measurement-device source
// (#460, ADR 0003). All decision logic lives here as side-effect-free
// functions (constitution: pure functions preferred, side effects injected) so
// the store and inline-app.js wiring stay thin: they map IPC results/events
// through these transitions and render the HTML these builders return.
//
// The secondary source is a metering-only room mic, entirely separate from the
// board's multitrack capture. Its states are surfaced honestly and never
// silently substituted: BLOCKED when mic permission is missing, DISCONNECTED
// (non-fatal, board keeps running) when the device disappears mid-session, with
// an auto-resume from the persisted device-name preference on reconnect.

import {
  measurementSourceBadgeText,
  type LiveDevice,
  type StripConfig,
  type LiveEvent,
  type ChannelWindowData,
  type EqPaneRoomOverride,
} from './live-capture-panel';
import { escapeHtml } from './spectrum-display';

// Board/secondary-stream start options — defined here (not stores/liveCaptureStore.ts)
// because captureOptsFromCadence below is the function that produces this exact
// shape; the store imports it from here to keep this module's pure helpers free of
// any dependency on the store that consumes them.
export interface StartCaptureOpts {
  windowSecs: number;
  intervalSecs: number;
}

// Defaults for the two capture-cadence sliders (#725) — match the static
// markup's original value="100"/value="3", now the seed for
// liveCaptureStore's meterIntervalMs/windowSecs fields.
export const DEFAULT_METER_INTERVAL_MS = 100;
export const DEFAULT_WINDOW_SECS = 3;

// Label text for the meter-rate slider — exact port of inline-app.js's
// deleted #meter-interval 'input' listener body (#725).
export function meterIntervalLabel(ms: number): string {
  return `${ms} ms · ${Math.round(1000 / ms)}/s`;
}

// Label text for the window slider — exact port of inline-app.js's deleted
// #window-secs 'input' listener body (#725).
export function windowSecsLabel(secs: number): string {
  return `${secs.toFixed(1)}s`;
}

// Numeric replacement for parseCaptureOpts (#725) — the store now holds real
// numbers, so this just converts units (ms -> secs) instead of also parsing
// strings with fallback defaults.
export function captureOptsFromCadence(windowSecs: number, meterIntervalMs: number): StartCaptureOpts {
  return { windowSecs, intervalSecs: meterIntervalMs / 1000 };
}

export type SecondaryMeasurementStatus =
  | 'off'
  | 'starting'
  | 'active'
  | 'blocked'
  | 'disconnected';

export interface SecondaryMeasurementState {
  status: SecondaryMeasurementStatus;
  /** Persisted preference; '' = none chosen. Matched by name, never index. */
  deviceName: string;
  /** Set when status === 'blocked' — the raw micAccess value main returned. */
  micAccess?: string;
  /** Set when status === 'disconnected' via a start error. */
  error?: string;
}

// The secondary stream reads the device's first input as one mono strip — a
// metering source only, never a multitrack rig (mirrors main's
// MEASUREMENT_CHANNEL_TOKEN). Channel 0 of the secondary tick is the Room feed
// when the source is active.
const SECONDARY_MONO_CONFIG: StripConfig[] = [{ kind: 'mono', a: 0, b: 0 }];

/**
 * Resolve a persisted device NAME to its current index-as-string, or null when
 * no enumerated device matches (no fallback — a missing device is surfaced as
 * disconnected upstream, never silently swapped for the board channel).
 */
export function deviceIndexForName(devices: LiveDevice[], name: string): string | null {
  if (name === '') return null;
  const dev = devices.find((d) => d.name === name);
  return dev ? String(dev.index) : null;
}

/**
 * Fold a start-measurement IPC result into the next state:
 *  - success            → 'active'
 *  - non-granted mic     → 'blocked' (carries the micAccess for the message)
 *  - any other failure   → 'disconnected' (carries the error text)
 * Never falls back to the board source — blocked/disconnected are terminal
 * surfaced states, per ADR 0003.
 */
export function applyStartResult(
  state: SecondaryMeasurementState,
  result: { success: boolean; micAccess?: string; error?: string },
): SecondaryMeasurementState {
  if (result.success) {
    return { status: 'active', deviceName: state.deviceName };
  }
  if (result.micAccess && result.micAccess !== 'granted') {
    return { status: 'blocked', deviceName: state.deviceName, micAccess: result.micAccess };
  }
  return { status: 'disconnected', deviceName: state.deviceName, error: result.error };
}

/**
 * Fold a stream-ended signal into the next state. An expected stop (the user
 * turned the source off) → 'off'. An UNEXPECTED end while active/starting (a
 * mid-session disconnect) → 'disconnected', the non-fatal state that leaves the
 * board capture untouched and drives auto-resume. Any other state is unchanged.
 */
export function applyStreamEnded(
  state: SecondaryMeasurementState,
  expectedStop: boolean,
): SecondaryMeasurementState {
  if (expectedStop) {
    return { status: 'off', deviceName: state.deviceName };
  }
  if (state.status === 'active' || state.status === 'starting') {
    return { status: 'disconnected', deviceName: state.deviceName };
  }
  return state;
}

/**
 * Decide whether a re-enumeration should auto-restart the secondary stream.
 * Only acts while 'disconnected' with a remembered device: when that device
 * name reappears in the fresh list, signal a restart (and move to 'starting');
 * otherwise leave the state untouched so the poll keeps waiting.
 */
export function reconnectDecision(
  state: SecondaryMeasurementState,
  devices: LiveDevice[],
): { state: SecondaryMeasurementState; shouldRestart: boolean } {
  if (state.status !== 'disconnected' || state.deviceName === '') {
    return { state, shouldRestart: false };
  }
  const present = devices.some((d) => d.name === state.deviceName);
  if (!present) return { state, shouldRestart: false };
  return { state: { status: 'starting', deviceName: state.deviceName }, shouldRestart: true };
}

/**
 * Options for the secondary-device <select>: a "None" sentinel (empty value)
 * plus one option per input device, names HTML-escaped and the preferred one
 * marked selected by name match (resilient to reordering).
 */
export function secondaryDeviceOptionsHTML(devices: LiveDevice[], preferredName: string): string {
  const noneSelected = preferredName === '' ? ' selected' : '';
  const opts = [`<option value=""${noneSelected}>None (use board channel)</option>`];
  for (const d of devices) {
    const selected = d.name === preferredName ? ' selected' : '';
    opts.push(`<option value="${escapeHtml(String(d.index))}"${selected}>${escapeHtml(d.name)}</option>`);
  }
  return opts.join('');
}

/**
 * Status-line text for the current secondary state. Blocked and disconnected
 * carry actionable guidance (System Settings path / reconnect-to-resume);
 * active names the room device. Off/starting produce a neutral line.
 */
export function secondaryStatusHTML(state: SecondaryMeasurementState): string {
  const name = escapeHtml(state.deviceName);
  switch (state.status) {
    case 'blocked':
      return 'Microphone access is blocked. Enable it in System Settings ▸ Privacy &amp; Security ▸ Microphone, then choose the device again.';
    case 'disconnected':
      return `‘${name}’ disconnected — reconnect the device to resume.`;
    case 'active':
      return `Measuring room via ‘${name}’.`;
    case 'starting':
      return 'Starting measurement source…';
    default:
      return '';
  }
}

/**
 * The permanent time-alignment warning shown whenever a secondary source is
 * selected (#460, ADR 0003). Drift between the two independent clock domains is
 * unquantified until the real-rig runs land, so the warning is unconditional
 * and points at the macOS Aggregate Device as the clock-corrected alternative.
 */
export function alignmentWarningHTML(): string {
  return (
    'This room source may not be time-aligned with the multitrack session — it is a ' +
    'separate device on its own clock, so measurements can drift. For sample-aligned ' +
    'capture, build a macOS Aggregate Device in Audio MIDI Setup and measure a strip of it instead.'
  );
}

export interface RoomFeed {
  windows: LiveEvent[];
  source: number | null;
  config: StripConfig[];
  badge: string;
}

/**
 * The Room feed the badge and live report-card source read (the EQ pane's
 * Room slot reads roomPaneOverride below — same activation rule, tick-shaped
 * data). Defaults to the board feed (a strip of the multitrack stream). When
 * the secondary source is active, it switches to the secondary stream's
 * channel 0 as a single mono strip, with a badge that flags it as not
 * time-aligned.
 */
export function roomFeed(
  secondaryActive: boolean,
  secondaryWindows: LiveEvent[],
  secondaryDeviceName: string,
  boardWindows: LiveEvent[],
  measurementSource: number | null,
  channelConfig: StripConfig[],
): RoomFeed {
  if (!secondaryActive) {
    return {
      windows: boardWindows,
      source: measurementSource,
      config: channelConfig,
      badge: measurementSourceBadgeText(channelConfig, measurementSource),
    };
  }
  return {
    windows: secondaryWindows,
    source: 0,
    config: SECONDARY_MONO_CONFIG,
    badge: `Measuring: ${secondaryDeviceName} (secondary — not time-aligned)`,
  };
}

/**
 * The EQ pane's Room-slot override (#460 visual swap — closes the gap where
 * only the badge/stats row/report-card source switched to the secondary mic).
 * Null while the secondary source isn't active, so the pane renders the board
 * slot byte-identically (the #602 parity guard). When active, the room mic's
 * channel-0 reading + device-name label take the primary slot. The latest
 * meter tick's channels (meter cadence) win over the slower window buffer so
 * the pane moves at the same rate as the board slots; the window buffer is the
 * fallback for the gap before the first meter tick lands. eqPaneHTML escapes
 * the device-name label the same way it escapes strip labels.
 */
export function roomPaneOverride(
  secondaryActive: boolean,
  secondaryWindows: LiveEvent[],
  lastMeasurementChannels: ChannelWindowData[] | null,
  deviceName: string,
): EqPaneRoomOverride | null {
  if (!secondaryActive) return null;
  const lastWindow = secondaryWindows[secondaryWindows.length - 1];
  const ch = lastMeasurementChannels?.[0] ?? lastWindow?.channels?.[0] ?? null;
  if (!ch) return null;
  return { ch, label: deviceName };
}

// The live header's measurement-badge text (TD-001 slice 6h, #711): port of
// inline-app.js's renderMeasurementBadge — now a pure derivation from
// liveCaptureStore state, rendered reactively by MeasurementBadge.tsx. Empty
// unless a capture is running (mirrors the old onCaptureStopped clear); the
// secondary source's badge when active (with windows), else the board strip's
// measurementSourceBadgeText.
export interface MeasurementBadgeInput {
  isCapturing: boolean;
  secondaryStatus: SecondaryMeasurementStatus;
  secondaryWindows: LiveEvent[];
  secondaryDeviceName: string;
  measurementSource: number | null;
  channelConfig: StripConfig[];
}

export function measurementBadgeView(input: MeasurementBadgeInput): string {
  if (!input.isCapturing) return '';
  if (input.secondaryStatus === 'active' && input.secondaryWindows.length > 0) {
    return `Measuring: ${input.secondaryDeviceName} (secondary — not time-aligned)`;
  }
  return measurementSourceBadgeText(input.channelConfig, input.measurementSource);
}
