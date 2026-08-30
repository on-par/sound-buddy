// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session arrangement's shared playhead/insert-marker model (#1301): the
// ONE owner of TimelineMarks, its clamp rule and a small read/update API that
// daw-shell-runtime.ts's renderPlayhead (the playhead's single writer),
// renderInsertMarker, LiveCapturePanel and timeline-zoom-controls.ts all read
// from and (for the playhead) write through. Modelled directly on
// timeline-visible-range.ts: this module is pure — no DOM, no store, no React
// import — and it MUST NOT import './daw-shell-runtime' (it holds seconds,
// never pixels) nor './timeline-bpm' (ADR-0104/0107). sessionTimelineMarks is
// the one shared module-level instance, the same "one owner" precedent
// SESSION_TIMELINE_SCALE (live-workspace-view.ts) established.

/** Where the insert marker parks when a session loads: the top of the arrangement. */
export const TIMELINE_INSERT_MARKER_DEFAULT_SECS = 0;

/** The arrangement's two independent positions, in real seconds from t=0. */
export interface TimelineMarks {
  readonly playheadSecs: number;
  readonly insertMarkerSecs: number;
}

/** The shared read/update surface. Every write is clamped before it is
 *  stored, so no reader can ever observe a negative or non-finite mark. */
export interface TimelineMarksModel {
  getMarks(): TimelineMarks;
  getPlayheadSecs(): number;
  getInsertMarkerSecs(): number;
  /** Only daw-shell-runtime.ts's renderPlayhead may call this (see this story's ADR). */
  setPlayheadSecs(secs: number): TimelineMarks;
  setInsertMarkerSecs(secs: number): TimelineMarks;
  /** Session load: both positions return to the top of the arrangement. */
  resetForSession(): TimelineMarks;
  /** Returns an unsubscribe function. Listeners fire only on a real change. */
  subscribe(listener: (marks: TimelineMarks) => void): () => void;
}

/** Non-finite or negative seconds clamp to 0, so no NaN can reach a style.left. */
export function clampMarkSecs(secs: number): number {
  return Number.isFinite(secs) && secs > 0 ? secs : 0;
}

export function createTimelineMarksModel(): TimelineMarksModel {
  let marks: TimelineMarks = Object.freeze({
    playheadSecs: 0,
    insertMarkerSecs: TIMELINE_INSERT_MARKER_DEFAULT_SECS,
  });
  const listeners = new Set<(marks: TimelineMarks) => void>();

  // Exact-value comparison, not epsilon: `marks` only ever holds a value this
  // module itself produced via clampMarkSecs, so this compares a stored
  // number to itself, not two independently-derived computations (the float
  // rule targets the latter).
  function commit(next: TimelineMarks): TimelineMarks {
    if (next.playheadSecs !== marks.playheadSecs || next.insertMarkerSecs !== marks.insertMarkerSecs) {
      marks = Object.freeze(next);
      for (const listener of [...listeners]) listener(marks);
    }
    return marks;
  }

  return {
    getMarks: () => marks,
    getPlayheadSecs: () => marks.playheadSecs,
    getInsertMarkerSecs: () => marks.insertMarkerSecs,
    setPlayheadSecs: (secs) => commit({ playheadSecs: clampMarkSecs(secs), insertMarkerSecs: marks.insertMarkerSecs }),
    setInsertMarkerSecs: (secs) => commit({ playheadSecs: marks.playheadSecs, insertMarkerSecs: clampMarkSecs(secs) }),
    resetForSession: () => commit({ playheadSecs: 0, insertMarkerSecs: TIMELINE_INSERT_MARKER_DEFAULT_SECS }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The one shared instance the shell runtime, LiveCapturePanel and future
 *  #1256 gesture slices read and (for the playhead, write through). */
export const sessionTimelineMarks: TimelineMarksModel = createTimelineMarksModel();
