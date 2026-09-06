// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The arrangement's single-playhead clock precedence (#1377). This is the one
// owner of "which clock is the arrangement's one playhead showing right now":
// an advancing record session always wins; otherwise a non-null playback
// position wins (advancing = the playback-active flag); otherwise the frozen
// or zero wall clock. soundcheckStore.loadSession seeds lastElapsedTick to a
// truthy `{ elapsed: 0, duration: 0 }` on session load and never clears it, so
// a playback position can be present and frozen for the entire life of a
// loaded session — it must never be allowed to outrank a running record
// clock. Leaf module (imports nothing), so a value import into
// daw-shell-runtime.ts creates no ESM cycle — same convention as
// clip-selection.ts / time-selection.ts.

export const PLAYHEAD_MS_PER_SECOND = 1000;

/** The playback transport's last reported position, as soundcheckStore reports it. */
export interface PlaybackPosition {
  elapsed: number;
  duration: number;
}

/** Which clock produced the resolved instant. */
export type PlayheadInstantSource = 'record' | 'playback';

/** Every input the precedence rule reads. */
export interface PlayheadInstantInputs {
  /** The last playback progress position, or null when no take position is held. */
  playbackPosition: PlaybackPosition | null;
  /** Whether that playback position is currently advancing (soundcheck.playing). */
  playbackActive: boolean;
  /** Whether a live RECORD session's wall clock is running right now. */
  recordAdvancing: boolean;
  /** The record wall clock's elapsed ms (0 before any capture, frozen after a stop). */
  recordElapsedMs: number;
}

/** The one instant a paint pass shows. */
export interface PlayheadInstant {
  elapsedMs: number;
  advancing: boolean;
  source: PlayheadInstantSource;
}

/** Non-finite input can never reach a style or a transport string as NaN. */
function finiteMs(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function resolvePlayheadInstant(inputs: PlayheadInstantInputs): PlayheadInstant {
  if (inputs.recordAdvancing) {
    return { elapsedMs: finiteMs(inputs.recordElapsedMs), advancing: true, source: 'record' };
  }
  if (inputs.playbackPosition !== null) {
    return {
      elapsedMs: finiteMs(inputs.playbackPosition.elapsed) * PLAYHEAD_MS_PER_SECOND,
      advancing: inputs.playbackActive,
      source: 'playback',
    };
  }
  return { elapsedMs: finiteMs(inputs.recordElapsedMs), advancing: false, source: 'record' };
}
