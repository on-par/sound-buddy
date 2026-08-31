// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The loop brace body drag gesture (#1315): pressing and moving the loop brace body
// translates the whole loop range by the drag delta. Modelled directly on
// time-selection-drag.ts's structural window type, listener add/remove and
// pointerId-matching, and its 4px click-vs-drag threshold. A leaf module on purpose:
// it must not import './daw-shell-runtime' or './timeline-bpm', so the preview/commit
// effects stay fully injected and this module cannot close an ESM cycle.

import { type LoopRegion } from './loopBrace.render';
import { timelineSpanSecsAt } from './timeline-scale';

/** The one selector LiveCapturePanel's pointerdown closest() call uses to route a press
 *  into the loop body drag. Must stay equal to `.${LOOP_BRACE_CLASS}`. */
export const LOOP_BRACE_BODY_SELECTOR = '.daw-loop-brace';

/** How far the pointer must travel horizontally before a press on the brace becomes a
 *  move rather than a click. Mirrors TIME_SELECTION_DRAG_THRESHOLD_PX so the arrangement's
 *  two drags agree on what a click is. */
export const LOOP_BODY_DRAG_THRESHOLD_PX = 4;

export interface LoopBodyDragInput {
  /** PointerEvent.button — only the primary button (0) qualifies. */
  button: number;
  clientX: number;
  /** SESSION_TIMELINE_SCALE.pxPerSecond. The gesture works in DELTAS, so it needs
   *  neither the surface's left edge nor the scroll offset — both cancel. */
  pxPerSecond: number;
  /** The timeline's upper bound in seconds (the take/session duration), when one is
   *  known. Undefined leaves the drag bounded only below, at t=0. */
  maxSecs?: number;
}

export interface LoopBodyDragWindow {
  addEventListener(type: 'pointermove', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'pointercancel', listener: () => void): void;
  removeEventListener(type: 'pointermove', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointercancel', listener: () => void): void;
}

export interface LoopBodyDragDeps {
  windowTarget: LoopBodyDragWindow;
  pointerId: number;
  /** The loop range as it stands at pointerdown — the drag's anchor. */
  region: LoopRegion;
  /** Paint the in-flight range. Imperative only: it must not write the shared model. */
  previewRegion(region: LoopRegion): void;
  /** Write the final range into the shared model and repaint. Called at most once. */
  commitRegion(region: LoopRegion): void;
}

export interface LoopBodyDragHandle {
  hasDragged(): boolean;
}

/** Translates `region` by `deltaSecs`, preserving its length exactly, and clamps it to
 *  stay within [0, maxSecs]. Max clamp runs before the min clamp so a bound shorter than
 *  the loop's length pins startSecs to 0 rather than shrinking the loop. Returns `region`
 *  unchanged for a non-finite delta/endpoint or a degenerate (zero-or-negative-width)
 *  anchor — there is nothing to translate. */
export function movedLoopRegion(region: LoopRegion, deltaSecs: number, maxSecs?: number): LoopRegion {
  if (
    !Number.isFinite(deltaSecs) ||
    !Number.isFinite(region.startSecs) ||
    !Number.isFinite(region.endSecs) ||
    region.endSecs - region.startSecs <= 0
  ) {
    return region;
  }
  const lengthSecs = region.endSecs - region.startSecs;
  let startSecs = region.startSecs + deltaSecs;
  // Max clamp first, min clamp second: when maxSecs is shorter than the loop's length,
  // the two clamps disagree and the min (start pinned at 0) must win, keeping the loop
  // length intact instead of shrinking it to fit.
  if (maxSecs !== undefined && Number.isFinite(maxSecs)) startSecs = Math.min(startSecs, maxSecs - lengthSecs);
  startSecs = Math.max(0, startSecs);
  return Object.freeze({ startSecs, endSecs: startSecs + lengthSecs });
}

export function beginLoopBodyDrag(input: LoopBodyDragInput, deps: LoopBodyDragDeps): LoopBodyDragHandle | null {
  if (input.button !== 0) return null;
  if (!Number.isFinite(input.clientX)) return null;

  const anchorClientX = input.clientX;
  const anchorRegion = deps.region;
  let dragged = false;
  let done = false;

  const update = (clientX: number): LoopRegion | null => {
    if (!dragged && Math.abs(clientX - anchorClientX) >= LOOP_BODY_DRAG_THRESHOLD_PX) {
      dragged = true;
    }
    if (!dragged) return null;
    const deltaSecs = timelineSpanSecsAt(input.pxPerSecond, clientX - anchorClientX);
    return movedLoopRegion(anchorRegion, deltaSecs, input.maxSecs);
  };

  const cleanup = (): void => {
    // Defensive re-entrancy guard: cleanup() always removes all three listeners
    // synchronously before any dep is called, so a second dispatch of pointerup
    // or pointercancel for this gesture can never reach here through the public
    // event contract — unreachable in a single-threaded event loop, kept for
    // safety against a future caller that invokes cleanup some other way.
    /* c8 ignore next */
    if (done) return;
    done = true;
    deps.windowTarget.removeEventListener('pointermove', onPointerMove);
    deps.windowTarget.removeEventListener('pointerup', onPointerUp);
    deps.windowTarget.removeEventListener('pointercancel', onPointerCancel);
  };

  const onPointerMove = (move: PointerEvent): void => {
    if (move.pointerId !== deps.pointerId) return;
    const next = update(move.clientX);
    if (next) deps.previewRegion(next);
  };

  const onPointerUp = (up: PointerEvent): void => {
    if (up.pointerId !== deps.pointerId) return;
    cleanup();
    const next = update(up.clientX);
    if (next) deps.commitRegion(next);
  };

  const onPointerCancel = (): void => {
    cleanup();
    if (dragged) deps.previewRegion(anchorRegion);
  };

  // Does NOT call setPointerCapture (same reasoning as time-selection-drag.ts): window
  // listeners work regardless of capture ownership.
  deps.windowTarget.addEventListener('pointermove', onPointerMove);
  deps.windowTarget.addEventListener('pointerup', onPointerUp);
  deps.windowTarget.addEventListener('pointercancel', onPointerCancel);

  return { hasDragged: () => dragged };
}
