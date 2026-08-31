// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The "Loop Selection" promotion policy (#1317). A leaf module — it imports only
// from ./loopBrace.render and ./time-selection, both leaves, so no ESM cycle back
// into daw-shell-runtime.ts or LiveCapturePanel.tsx is possible.

import {
  normalizeLoopRegion,
  type LoopRegion,
  type LoopRegionModel,
} from './loopBrace.render';
import { type TimeSelectionRange } from './time-selection';

/** The id of the Session-toolbar button that promotes the selection. Must stay equal to
 *  the id session-tab-playback.ts writes into the markup (drift-tested). */
export const LOOP_FROM_SELECTION_BUTTON_ID = 'daw-session-loop-selection';

/** The two facts that decide whether a promotion can happen and whether it must also
 *  switch Loop on. Structural, not the SessionTabPlaybackView interface, so this module
 *  stays a leaf — same convention as loopToggle.ts's LoopToggleState. */
export interface LoopPromotionState {
  available: boolean;
  looping: boolean;
}

export interface LoopPromotionResult {
  /** The range actually committed to the model. */
  region: LoopRegion;
  /** True when looping was off and the caller must switch it on so the brace renders. */
  enableLooping: boolean;
}

/** The selection's endpoints as a loop range, or null when there is no usable selection.
 *  Delegates ordering/clamping/zero-width rejection to normalizeLoopRegion so the two
 *  span concepts cannot drift. */
export function loopRegionFromSelection(
  selection: TimeSelectionRange | null | undefined,
): LoopRegion | null {
  if (selection == null) return null;
  return normalizeLoopRegion(selection.startSecs, selection.endSecs);
}

/** Applies the current time selection as the loop range. Returns null — writing nothing —
 *  when no session is loaded or there is no selection; that null IS the story's "no-op
 *  without a selection" acceptance criterion. setRegion marks the range seeded, so a later
 *  Loop toggle-on can never reseed the #1314 default over a promoted range. */
export function promoteSelectionToLoop(
  model: LoopRegionModel,
  selection: TimeSelectionRange | null | undefined,
  state: LoopPromotionState,
): LoopPromotionResult | null {
  if (!state.available) return null;
  const region = loopRegionFromSelection(selection);
  if (!region) return null;
  const applied = model.setRegion(region.startSecs, region.endSecs);
  return { region: applied, enableLooping: !state.looping };
}
