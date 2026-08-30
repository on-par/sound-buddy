// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session timeline's shared visible-range model (#1290): the ONE owner of
// TimelineVisibleRange, its clamp rule and a small read/update API that every
// future consumer of the visible range — the scroll (#1292) and zoom (#1291)
// gesture slices, the ruler, lanes, clip geometry and playhead — reads from
// and mutates through. This module is pure: no DOM, no store, no React
// import. Per ADR-0109 it models the visible range in real seconds only and
// MUST NOT import './daw-shell-runtime' or compute an x. Per ADR-0104/0107 it
// MUST NOT import './timeline-bpm' — no coordinate is computed through the
// tempo model. Gesture wiring (reading the current playhead, dispatching
// scroll/zoom events) is #1291/#1292's job, not this module's — #1291's
// timeline-zoom-gesture.ts and timeline-zoom-controls.ts's toolbar both read
// the shared anchor rule from this module's visibleRangeAnchorSecs below.

/** The narrowest visible span the timeline may ever show. */
export const TIMELINE_MIN_VISIBLE_SPAN_SECS = 1;

/** A slice of session time, in real seconds from t=0. Never a pixel value. */
export interface TimelineVisibleRange {
  readonly startSecs: number;
  readonly endSecs: number;
}

/** The shared read/update surface. Every write is clamped before it is stored,
 *  so no reader can ever observe an out-of-bounds range. */
export interface TimelineVisibleRangeModel {
  getRange(): TimelineVisibleRange;
  getDurationSecs(): number;
  setRange(range: TimelineVisibleRange | null): TimelineVisibleRange;
  /** Scroll primitive (#1292): keep the current span, move its start. */
  setStartSecs(startSecs: number): TimelineVisibleRange;
  /** Re-clamps the stored range against a new full duration. */
  setDurationSecs(durationSecs: number): TimelineVisibleRange;
  /** Returns an unsubscribe function. Listeners fire only on a real change. */
  subscribe(listener: (range: TimelineVisibleRange) => void): () => void;
}

/** Guarantees a finite, positive full duration that is always >= the minimum
 *  span, so every clamp below is safe and no caller can divide by zero. */
export function timelineFullDurationSecs(durationSecs: number): number {
  return Math.max(TIMELINE_MIN_VISIBLE_SPAN_SECS, Number.isFinite(durationSecs) && durationSecs > 0 ? durationSecs : 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function visibleRangeSpanSecs(range: TimelineVisibleRange): number {
  return range.endSecs - range.startSecs;
}

// Unlike the private helper this replaces, this function is exported, so it
// guards its own inputs rather than relying on a caller to have already
// resolved a non-finite value to a fallback: a non-finite centerSecs resolves
// to a window at t=0, a non-finite spanSecs resolves to the full duration.
export function visibleRangeOfSpan(centerSecs: number, spanSecs: number, durationSecs: number): TimelineVisibleRange {
  const fullSecs = timelineFullDurationSecs(durationSecs);
  const safeCenterSecs = Number.isFinite(centerSecs) ? centerSecs : 0;
  const safeSpanSecs = Number.isFinite(spanSecs) ? spanSecs : fullSecs;
  const span = clamp(safeSpanSecs, TIMELINE_MIN_VISIBLE_SPAN_SECS, fullSecs);
  const startSecs = clamp(safeCenterSecs - span / 2, 0, fullSecs - span);
  return Object.freeze({ startSecs, endSecs: startSecs + span });
}

/** The fixed point a zoom keeps in view: the playhead when it is finite and
 *  inside the range, the range's own centre otherwise. Exported here (rather
 *  than duplicated) so the #1284 toolbar buttons and the #1291 gesture are
 *  provably the same rule. */
export function visibleRangeAnchorSecs(range: TimelineVisibleRange, playheadSecs: number): number {
  if (Number.isFinite(playheadSecs) && playheadSecs >= range.startSecs && playheadSecs <= range.endSecs) return playheadSecs;
  return (range.startSecs + range.endSecs) / 2;
}

export function clampVisibleRange(range: TimelineVisibleRange | null, durationSecs: number): TimelineVisibleRange {
  const fullSecs = timelineFullDurationSecs(durationSecs);
  if (range === null || !Number.isFinite(range.startSecs) || !Number.isFinite(range.endSecs) || range.endSecs - range.startSecs <= 0) {
    return Object.freeze({ startSecs: 0, endSecs: fullSecs });
  }
  const startSecs = clamp(range.startSecs, 0, fullSecs);
  const endSecs = clamp(range.endSecs, startSecs, fullSecs);
  if (endSecs - startSecs < TIMELINE_MIN_VISIBLE_SPAN_SECS) {
    return visibleRangeOfSpan((startSecs + endSecs) / 2, TIMELINE_MIN_VISIBLE_SPAN_SECS, fullSecs);
  }
  return Object.freeze({ startSecs, endSecs });
}

export function createTimelineVisibleRangeModel(durationSecs: number): TimelineVisibleRangeModel {
  let fullSecs = timelineFullDurationSecs(durationSecs);
  let range = clampVisibleRange(null, fullSecs);
  const listeners = new Set<(range: TimelineVisibleRange) => void>();

  // Exact-value comparison, not epsilon: `range` only ever holds a value this
  // module itself produced via clampVisibleRange, so this compares a stored
  // number to itself, not two independently-derived computations (the float
  // rule targets the latter).
  function commit(next: TimelineVisibleRange): TimelineVisibleRange {
    if (next.startSecs !== range.startSecs || next.endSecs !== range.endSecs) {
      range = next;
      for (const listener of [...listeners]) listener(range);
    }
    return range;
  }

  return {
    getRange: () => range,
    getDurationSecs: () => fullSecs,
    setRange: (next) => commit(clampVisibleRange(next, fullSecs)),
    setStartSecs: (startSecs) => commit(clampVisibleRange({ startSecs, endSecs: startSecs + visibleRangeSpanSecs(range) }, fullSecs)),
    setDurationSecs: (next) => {
      fullSecs = timelineFullDurationSecs(next);
      return commit(clampVisibleRange(range, fullSecs));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
