// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The clip half of the arrangement's pointerdown routing (#1303) — the exact
// complement of lane-background-click.ts's background half. It reuses that
// module's laneClipHitAt so the two hit-tests cannot drift: a press either
// lands on a clip (this module) or on the background (lane-background-click.ts),
// never both. ClipClickDeps deliberately contains no insert-marker member, so
// the clip route is structurally incapable of moving the insert marker — the
// mirror image of ADR-0115, where the background route is structurally
// incapable of selecting.

import { laneClipHitAt, type LaneClickRect } from './lane-background-click';
import { timelineSpanSecsAt } from './timeline-scale';

export interface ClipClickInput {
  /** PointerEvent.button — only the primary button (0) qualifies. */
  button: number;
  clientX: number;
  /** The pressed .daw-lane's left edge — the arrangement's shared t=0 edge. */
  laneLeftPx: number;
  /** The visible range's horizontal scroll offset, from timelineScrollOffsetPx. */
  scrollOffsetPx: number;
  /** SESSION_TIMELINE_SCALE.pxPerSecond. */
  pxPerSecond: number;
  /** The pressed lane's data-ch — the selected clip's identity. */
  channelIndex: number;
  /** Every take clip painted in the PRESSED lane, in client coordinates. */
  clipRects: readonly LaneClickRect[];
  /** The seek-target override modifier (Option/Alt) held at press time. */
  overrideHeld: boolean;
  /** Whether a targeted seek is allowed at all — the panel passes
   *  canBeginSessionScrub('ruler', gate()): a session is loaded and no record is running. */
  canSeek: boolean;
}

export type ClipClickDecision =
  | { kind: 'none' }
  | { kind: 'select'; channelIndex: number }
  | { kind: 'select-and-seek'; channelIndex: number; secs: number };

/** The whole effect surface of a clip press. Deliberately three members and NO
 *  setInsertMarkerSecs: the route is structurally incapable of moving the insert marker. */
export interface ClipClickDeps {
  selectClip(channelIndex: number): void;
  repaintClipSelection(): void;
  seekTo(secs: number): void;
}

/** Resolves a clip press to a decision. Pure — no DOM, no store. `none` when the
 *  press doesn't qualify at all: wrong button, non-finite coordinates, an invalid
 *  channel index, or a miss against every painted clip rect (that press belongs to
 *  the background route). Otherwise `select`, or `select-and-seek` when the seek
 *  override is held and a seek is currently allowed. */
export function clipClickDecision(input: ClipClickInput): ClipClickDecision {
  if (input.button !== 0) return { kind: 'none' };
  if (!Number.isFinite(input.clientX) || !Number.isFinite(input.laneLeftPx)) return { kind: 'none' };
  if (!Number.isInteger(input.channelIndex) || input.channelIndex < 0) return { kind: 'none' };
  if (!laneClipHitAt(input.clientX, input.clipRects)) return { kind: 'none' };

  if (input.overrideHeld && input.canSeek) {
    const scrollPx = Number.isFinite(input.scrollOffsetPx) ? input.scrollOffsetPx : 0;
    const offsetPx = input.clientX - input.laneLeftPx + scrollPx;
    const secs = Math.max(0, timelineSpanSecsAt(input.pxPerSecond, offsetPx));
    return { kind: 'select-and-seek', channelIndex: input.channelIndex, secs };
  }

  return { kind: 'select', channelIndex: input.channelIndex };
}

/** Applies a clip press: resolves the decision, and on a qualifying press calls
 *  selectClip then repaintClipSelection, and additionally seekTo for a
 *  select-and-seek decision. On `none` calls no dep. Always returns the decision. */
export function applyClipClick(input: ClipClickInput, deps: ClipClickDeps): ClipClickDecision {
  const decision = clipClickDecision(input);
  if (decision.kind === 'none') return decision;

  deps.selectClip(decision.channelIndex);
  deps.repaintClipSelection();
  if (decision.kind === 'select-and-seek') deps.seekTo(decision.secs);

  return decision;
}
