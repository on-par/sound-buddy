// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The time-selection drag gesture (#1304): a pointer drag on `.daw-ruler` or
// `.daw-lane` background that defines a time range. Modelled on
// session-timeline-scrub.ts's structural window type and listener
// add/remove/pointerId-matching, plus lane-background-click.ts's geometry
// input shape. It must NOT import './daw-shell-runtime' (it holds seconds,
// never shell-local x) nor './timeline-bpm' (ADR-0104/0107).

import { timelineSpanSecsAt } from './timeline-scale';
import { normalizeTimeRange, type TimeSelectionRange } from './time-selection';

/** How far the pointer must travel horizontally before a press becomes a drag rather
 *  than a click. Below it, ADR-0110's ruler seek and ADR-0115's insert marker keep
 *  their exact pre-#1304 behaviour. */
export const TIME_SELECTION_DRAG_THRESHOLD_PX = 4;

export interface TimeSelectionDragInput {
  /** PointerEvent.button — only the primary button (0) qualifies. */
  button: number;
  clientX: number;
  /** The pressed surface's own left edge — the arrangement's shared t=0 edge. The
   *  ruler and every lane share it, so one input shape serves both zones. */
  laneLeftPx: number;
  /** The visible range's horizontal scroll offset, from timelineScrollOffsetPx. */
  scrollOffsetPx: number;
  /** SESSION_TIMELINE_SCALE.pxPerSecond. */
  pxPerSecond: number;
}

export interface TimeSelectionDragWindow {
  addEventListener(type: 'pointermove', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'pointercancel', listener: () => void): void;
  removeEventListener(type: 'pointermove', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointerup', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'pointercancel', listener: () => void): void;
}

/** The whole effect surface of a time-selection drag. Deliberately carries NO
 *  selectClip and no insert-marker setter: the route is structurally incapable of
 *  selecting a clip (ADR-0115/0116's discipline). */
export interface TimeSelectionDragDeps {
  windowTarget: TimeSelectionDragWindow;
  pointerId: number;
  setSelection(range: TimeSelectionRange): void;
  clearSelection(): void;
  /** Repaint the band. Called after every selection change. */
  repaint(): void;
  /** Called exactly once when the gesture finishes (up or cancel), with whether the
   *  pointer ever exceeded the threshold. */
  onDragEnd(dragged: boolean): void;
}

export interface TimeSelectionDragHandle {
  hasDragged(): boolean;
}

/** Converts a clientX to clamped arrangement seconds at the input's scale and
 *  scroll offset — identical conversion to laneBackgroundInsertMarkerSecs.
 *  A non-finite clientX resolves to 0. */
export function timeSelectionSecsAt(input: TimeSelectionDragInput, clientX: number): number {
  if (!Number.isFinite(clientX)) return 0;
  const scrollPx = Number.isFinite(input.scrollOffsetPx) ? input.scrollOffsetPx : 0;
  const offsetPx = clientX - input.laneLeftPx + scrollPx;
  return Math.max(0, timelineSpanSecsAt(input.pxPerSecond, offsetPx));
}

export function beginTimeSelectionDrag(
  input: TimeSelectionDragInput,
  deps: TimeSelectionDragDeps,
): TimeSelectionDragHandle | null {
  if (input.button !== 0) return null;
  if (!Number.isFinite(input.clientX) || !Number.isFinite(input.laneLeftPx)) return null;

  const anchorClientX = input.clientX;
  const anchorSecs = timeSelectionSecsAt(input, anchorClientX);
  let dragged = false;
  let done = false;

  const update = (clientX: number): void => {
    if (!dragged && Math.abs(clientX - anchorClientX) >= TIME_SELECTION_DRAG_THRESHOLD_PX) {
      dragged = true;
    }
    if (!dragged) return;
    const range = normalizeTimeRange(anchorSecs, timeSelectionSecsAt(input, clientX));
    if (range) deps.setSelection(range);
    else deps.clearSelection();
    deps.repaint();
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
    update(move.clientX);
  };

  const onPointerUp = (up: PointerEvent): void => {
    if (up.pointerId !== deps.pointerId) return;
    cleanup();
    update(up.clientX);
    if (!dragged) {
      deps.clearSelection();
      deps.repaint();
    }
    deps.onDragEnd(dragged);
  };

  const onPointerCancel = (): void => {
    cleanup();
    deps.clearSelection();
    deps.repaint();
    deps.onDragEnd(dragged);
  };

  // Does NOT call setPointerCapture — the scrub already owns the capture for the
  // same pointer, and window listeners work regardless of capture ownership.
  deps.windowTarget.addEventListener('pointermove', onPointerMove);
  deps.windowTarget.addEventListener('pointerup', onPointerUp);
  deps.windowTarget.addEventListener('pointercancel', onPointerCancel);

  return { hasDragged: () => dragged };
}
