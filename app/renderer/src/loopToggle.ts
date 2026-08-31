// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Loop toggle's pure policy (#1314). A leaf module — it imports only from
// ./loopBrace.render, itself a leaf, so no ESM cycle back into daw-shell-runtime.ts
// or LiveCapturePanel.tsx is possible.

import {
  DEFAULT_LOOP_START_SECS,
  DEFAULT_LOOP_LENGTH_SECS,
  type LoopRegion,
  type LoopRegionModel,
} from './loopBrace.render';

/** The two facts that decide whether the arrangement is looping. Structural, not the
 *  SessionTabPlaybackView interface, so this module stays a leaf. `looping` is read from
 *  soundcheckStore and is the single source of truth for loop enablement (see this
 *  story's ADR) — LoopRegionModel itself carries no enabled/disabled concept. */
export interface LoopToggleState {
  available: boolean;
  looping: boolean;
}

/** Whether the ruler should show the loop brace: a recorded session is loaded AND
 *  looping is on. Mirrors playheadVisible's markup-level gating convention. */
export function loopBraceVisible(state: LoopToggleState | null | undefined): boolean {
  return state != null && state.available === true && state.looping === true;
}

/** The sensible default range seeded the first time Loop is switched on for a session:
 *  0 to 10s, shortened to the take's duration when the take is shorter than 10s. */
export function defaultLoopRegionFor(durationSecs: number | null | undefined): LoopRegion {
  const takeSecs = typeof durationSecs === 'number' && Number.isFinite(durationSecs) ? durationSecs : 0;
  const lengthSecs = takeSecs > 0 && takeSecs < DEFAULT_LOOP_LENGTH_SECS ? takeSecs : DEFAULT_LOOP_LENGTH_SECS;
  return Object.freeze({ startSecs: DEFAULT_LOOP_START_SECS, endSecs: DEFAULT_LOOP_START_SECS + lengthSecs });
}

/** Called BEFORE the store flips `looping`, so `state.looping` is the pre-press value and
 *  `!state.looping` means "this press turns looping ON". Seeds a default range on the first
 *  switch-on for a session; a range already set (by a prior seed or, in later slices, a drag)
 *  is never overwritten — that is what makes toggling Loop off and on lossless. */
export function seedLoopRegionOnToggle(
  model: LoopRegionModel,
  state: LoopToggleState,
  durationSecs: number | null | undefined,
): void {
  if (!state.available || state.looping) return;
  model.applyDefaultIfUnseeded(defaultLoopRegionFor(durationSecs));
}
