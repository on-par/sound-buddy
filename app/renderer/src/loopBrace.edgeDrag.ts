// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The loop brace edge handle drag gesture (#1316): pressing and moving either handle
// resizes the loop range from that edge only, clamped so the range can never invert
// or collapse. Modelled directly on loopBrace.bodyDrag.ts's structural window type,
// listener add/remove and pointerId-matching, and its 4px click-vs-drag threshold. A
// leaf module on purpose: it must not import './daw-shell-runtime' or './timeline-bpm',
// so the preview/commit effects stay fully injected and this module cannot close an
// ESM cycle.

import { type LoopRegion } from './loopBrace.render';
import { timelineSpanSecsAt } from './timeline-scale';

/** The two selectors LiveCapturePanel's pointerdown closest() calls use to route a press
 *  into an edge resize. Must stay equal to `.${LOOP_HANDLE_START_CLASS}` /
 *  `.${LOOP_HANDLE_END_CLASS}` in loopBrace.render.ts. */
export const LOOP_HANDLE_START_SELECTOR = '.daw-loop-handle-start';
export const LOOP_HANDLE_END_SELECTOR = '.daw-loop-handle-end';

/** Mirrors LOOP_BODY_DRAG_THRESHOLD_PX / TIME_SELECTION_DRAG_THRESHOLD_PX so every
 *  arrangement drag agrees on what a click is. */
export const LOOP_EDGE_DRAG_THRESHOLD_PX = 4;

/** The shortest loop a resize may leave behind. Keeps the two handles from landing on the
 *  same pixel (they are 6px wide) and keeps the committed range non-degenerate, which
 *  LoopRegionModel.setRegion requires — it ignores a zero-width pair. */
export const MIN_LOOP_LENGTH_SECS = 0.25;

export type LoopEdge = 'start' | 'end';

export interface LoopEdgeDragInput {
  /** PointerEvent.button — only the primary button (0) qualifies. */
  button: number;
  clientX: number;
  /** SESSION_TIMELINE_SCALE.pxPerSecond. The gesture works in DELTAS, so it needs
   *  neither the surface's left edge nor the scroll offset — both cancel. */
  pxPerSecond: number;
  /** The timeline's upper bound in seconds (the take/session duration), when one is
   *  known. Undefined leaves the end edge bounded only below, against the start. */
  maxSecs?: number;
  /** Which handle was pressed. */
  edge: LoopEdge;
}

export interface LoopEdgeDragWindow {
  addEventListener(type: 'pointermove', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'pointercancel', listener: () => void): void;
  removeEventListener(type: 'pointermove', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointercancel', listener: () => void): void;
}

export interface LoopEdgeDragDeps {
  windowTarget: LoopEdgeDragWindow;
  pointerId: number;
  /** The loop range as it stands at pointerdown — the drag's anchor. */
  region: LoopRegion;
  /** Paint the in-flight range. Imperative only: it must not write the shared model. */
  previewRegion(region: LoopRegion): void;
  /** Write the final range into the shared model and repaint. Called at most once. */
  commitRegion(region: LoopRegion): void;
}

export interface LoopEdgeDragHandle {
  hasDragged(): boolean;
}

/** Moves one edge of `region` by `deltaSecs`, leaving the other edge byte-identical to the
 *  anchor, and clamps so the range can never invert or collapse below MIN_LOOP_LENGTH_SECS.
 *  Returns `region` unchanged for a non-finite delta/endpoint or a degenerate
 *  (zero-or-negative-width) anchor — there is nothing to resize. */
export function resizedLoopRegion(region: LoopRegion, edge: LoopEdge, deltaSecs: number, maxSecs?: number): LoopRegion {
  if (
    !Number.isFinite(deltaSecs) ||
    !Number.isFinite(region.startSecs) ||
    !Number.isFinite(region.endSecs) ||
    region.endSecs - region.startSecs <= 0
  ) {
    return region;
  }
  if (edge === 'start') {
    let startSecs = region.startSecs + deltaSecs;
    // Crossover clamp first, floor clamp second: when the anchor is already shorter than
    // the minimum, pinning at 0 must win over the crossover clamp so the range is never
    // inverted (mirrors movedLoopRegion's max-then-min ordering).
    startSecs = Math.min(startSecs, region.endSecs - MIN_LOOP_LENGTH_SECS);
    startSecs = Math.max(0, startSecs);
    return Object.freeze({ startSecs, endSecs: region.endSecs });
  }
  let endSecs = region.endSecs + deltaSecs;
  if (maxSecs !== undefined && Number.isFinite(maxSecs)) endSecs = Math.min(endSecs, maxSecs);
  endSecs = Math.max(endSecs, region.startSecs + MIN_LOOP_LENGTH_SECS);
  return Object.freeze({ startSecs: region.startSecs, endSecs });
}

export function beginLoopEdgeDrag(input: LoopEdgeDragInput, deps: LoopEdgeDragDeps): LoopEdgeDragHandle | null {
  if (input.button !== 0) return null;
  if (!Number.isFinite(input.clientX)) return null;

  const anchorClientX = input.clientX;
  const anchorRegion = deps.region;
  let dragged = false;
  let done = false;

  const update = (clientX: number): LoopRegion | null => {
    if (!dragged && Math.abs(clientX - anchorClientX) >= LOOP_EDGE_DRAG_THRESHOLD_PX) {
      dragged = true;
    }
    if (!dragged) return null;
    const deltaSecs = timelineSpanSecsAt(input.pxPerSecond, clientX - anchorClientX);
    return resizedLoopRegion(anchorRegion, input.edge, deltaSecs, input.maxSecs);
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

  // Does NOT call setPointerCapture (same reasoning as loopBrace.bodyDrag.ts): window
  // listeners work regardless of capture ownership.
  deps.windowTarget.addEventListener('pointermove', onPointerMove);
  deps.windowTarget.addEventListener('pointerup', onPointerUp);
  deps.windowTarget.addEventListener('pointercancel', onPointerCancel);

  return { hasDragged: () => dragged };
}
