// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session arrangement's tempo model (#1273, epic #1260). It is deliberately
// separate from ./timeline-scale — seconds remain the sole time base for every
// coordinate, transport position, and clip duration. This module is pure (no
// DOM, no store, no React) and imports nothing, so tempo can never reach a
// pixels-per-second value and a scale consumer can never reach a tempo. No
// call site consumes it yet; the musical ruler labels and the toolbar BPM
// control are follow-up slices of #1260.

/** The tempo a Session timeline starts at when none has been set — a plain 4/4
 *  mid-tempo default, matching the reference mock in
 *  docs/discovery/ableton-daw-timeline-gauntlet.html. */
export const TIMELINE_DEFAULT_BPM = 120;

/** The supported tempo range. A request outside it resolves to the nearest bound. */
export const TIMELINE_MIN_BPM = 20;
export const TIMELINE_MAX_BPM = 300;

/** The arrangement's tempo state. Display-only: it labels musical time and never
 *  participates in a coordinate, a transport position, or a clip duration. */
export interface TimelineTempo {
  readonly bpm: number;
}

/** Validates a requested BPM with the same rules clampTimelineScale already uses:
 *  out-of-range snaps to the nearest bound, and a non-finite request (NaN,
 *  +/-Infinity) falls back to the default rather than propagating NaN into a
 *  stored value. */
export function clampTimelineBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return TIMELINE_DEFAULT_BPM;
  return Math.min(TIMELINE_MAX_BPM, Math.max(TIMELINE_MIN_BPM, bpm));
}

/** Initializes a tempo state. An omitted argument resolves to the documented
 *  default; a supplied argument is validated through clampTimelineBpm. */
export function createTimelineTempo(bpm?: number): TimelineTempo {
  return Object.freeze({ bpm: bpm === undefined ? TIMELINE_DEFAULT_BPM : clampTimelineBpm(bpm) });
}

/** The "BPM is set on the timeline" path. Every set goes through the same clamp
 *  as createTimelineTempo. If the clamped result equals the currently stored bpm
 *  (both values already having passed through the same clamp, so this is an
 *  identity check, not a tolerance question), the identical tempo reference is
 *  returned so a no-op set cannot force a downstream re-render. */
export function withTimelineBpm(tempo: TimelineTempo, bpm: number): TimelineTempo {
  const next = clampTimelineBpm(bpm);
  if (next === tempo.bpm) return tempo;
  return Object.freeze({ bpm: next });
}
