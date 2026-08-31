// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The lane-background press policy for #1302: which pointerdown presses on a
// .daw-lane count as "background" (no take clip under the cursor), and what
// insert-marker time such a press resolves to. Pure — no DOM types, no store,
// no React import — and it MUST NOT import './daw-shell-runtime' (it holds
// seconds and client-space offsets, never shell-local x) nor './timeline-bpm'
// (ADR-0104/0107). Clips are pointer-events:none in app.css, so a press over a
// clip already reports the enclosing lane as its event target — the hit-test
// therefore reads the clip's laid-out client rect, never the event target.

import { timelineSpanSecsAt } from './timeline-scale';

/** The class the take-clip span carries. Exported so live-workspace-view.ts's
 *  painter and this module's hit-test selector cannot drift. */
export const LANE_TAKE_CLIP_CLASS = 'daw-take-clip';
/** The one selector the lane-background hit-test queries within the pressed lane. */
export const LANE_TAKE_CLIP_SELECTOR = `.${LANE_TAKE_CLIP_CLASS}`;

/** The horizontal extent of one painted take clip, in client coordinates — a
 *  structural shape so a plain object and a real DOMRect both satisfy it. */
export interface LaneClickRect {
  readonly left: number;
  readonly right: number;
}

export interface LaneBackgroundClickInput {
  /** PointerEvent.button — only the primary button (0) qualifies. */
  button: number;
  clientX: number;
  /** The pressed .daw-lane's own left edge: the arrangement's shared t=0 edge,
   *  the same reference session-ruler-scrub.ts measures from. */
  laneLeftPx: number;
  /** The visible range's horizontal scroll offset, from timelineScrollOffsetPx. */
  scrollOffsetPx: number;
  /** The shared horizontal scale (SESSION_TIMELINE_SCALE.pxPerSecond). */
  pxPerSecond: number;
  /** Every take clip painted in the PRESSED lane, in client coordinates. */
  clipRects: readonly LaneClickRect[];
}

/** The whole effect surface of a lane-background press. Deliberately two members:
 *  the route is structurally incapable of touching selection state (#1302). */
export interface LaneBackgroundClickDeps {
  setInsertMarkerSecs(secs: number): void;
  repaintInsertMarker(): void;
}

/** True when clientX falls inside [left, right) of any rect — a half-open
 *  interval, so a press at a clip's trailing edge belongs to the lane pixel
 *  after it. A degenerate rect (right <= left) or one with a non-finite edge
 *  is skipped: an unpainted clip must never swallow a press. A non-finite
 *  clientX never matches. */
export function laneClipHitAt(clientX: number, clipRects: readonly LaneClickRect[]): boolean {
  if (!Number.isFinite(clientX)) return false;
  return clipRects.some((rect) => {
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.right)) return false;
    if (rect.right <= rect.left) return false;
    return clientX >= rect.left && clientX < rect.right;
  });
}

/** Resolves a lane-background press to insert-marker seconds, or null meaning
 *  "change nothing". Null for a non-primary button, a non-finite clientX or
 *  laneLeftPx, or a press that hits a take clip. */
export function laneBackgroundInsertMarkerSecs(input: LaneBackgroundClickInput): number | null {
  if (input.button !== 0) return null;
  if (!Number.isFinite(input.clientX) || !Number.isFinite(input.laneLeftPx)) return null;
  if (laneClipHitAt(input.clientX, input.clipRects)) return null;

  const scrollPx = Number.isFinite(input.scrollOffsetPx) ? input.scrollOffsetPx : 0;
  const offsetPx = input.clientX - input.laneLeftPx + scrollPx;
  // Clamp: a press left of the lane's t=0 edge resolves to 0, never negative.
  return Math.max(0, timelineSpanSecsAt(input.pxPerSecond, offsetPx));
}

/** Applies a lane-background press: resolves the seconds, and on a qualifying
 *  press calls setInsertMarkerSecs then repaintInsertMarker and returns true.
 *  On null (no qualifying press) calls neither dep and returns false. */
export function applyLaneBackgroundClick(input: LaneBackgroundClickInput, deps: LaneBackgroundClickDeps): boolean {
  const secs = laneBackgroundInsertMarkerSecs(input);
  if (secs === null) return false;
  deps.setInsertMarkerSecs(secs);
  deps.repaintInsertMarker();
  return true;
}
