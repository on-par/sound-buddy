// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The arrangement's time-range selection (#1304). A leaf module on purpose —
// it imports NOTHING — because daw-shell-runtime.ts imports it, and any
// import from here into time-selection-drag.ts / timeline-scale.ts would
// close an ESM cycle back into the painter. Modelled directly on
// clip-selection.ts / timeline-state.ts's createTimelineMarksModel: pure, no
// DOM, no store, no React import.

/** The class both painted band segments carry. Exported so live-workspace-view.ts's
 *  painter and daw-shell-runtime.ts's selector cannot drift. */
export const TIME_SELECTION_CLASS = 'daw-time-selection';

/** A span of arrangement time, in real seconds from t=0. Always startSecs <= endSecs. */
export interface TimeSelectionRange {
  readonly startSecs: number;
  readonly endSecs: number;
}

export interface TimeSelectionModel {
  getSelection(): TimeSelectionRange | null;
  /** Delegates to normalizeTimeRange: a degenerate or non-finite pair CLEARS the
   *  selection (commits null) rather than storing a bad range. */
  setSelection(startSecs: number, endSecs: number): TimeSelectionRange | null;
  clearSelection(): TimeSelectionRange | null;
  /** Returns an unsubscribe function. Listeners fire only on a real change. */
  subscribe(listener: (selection: TimeSelectionRange | null) => void): () => void;
}

/** Orders, clamps and validates a raw pair of endpoints into a TimeSelectionRange.
 *  Returns null for a non-finite endpoint, clamps each to Math.max(0, v) (mirrors
 *  clampMarkSecs in timeline-state.ts), orders them so startSecs <= endSecs, and
 *  returns null when they are equal — a zero-width span is not a selection. */
export function normalizeTimeRange(aSecs: number, bSecs: number): TimeSelectionRange | null {
  if (!Number.isFinite(aSecs) || !Number.isFinite(bSecs)) return null;
  const a = Math.max(0, aSecs);
  const b = Math.max(0, bSecs);
  if (a === b) return null;
  return Object.freeze(a < b ? { startSecs: a, endSecs: b } : { startSecs: b, endSecs: a });
}

export function createTimeSelectionModel(): TimeSelectionModel {
  let selection: TimeSelectionRange | null = null;
  const listeners = new Set<(selection: TimeSelectionRange | null) => void>();

  // Exact-value comparison, not epsilon: `selection` only ever holds a range this
  // module itself produced via normalizeTimeRange, so this compares a stored
  // number to itself, not two independently-derived computations (the float
  // rule targets the latter).
  function commit(next: TimeSelectionRange | null): TimeSelectionRange | null {
    const changed = next === null || selection === null
      ? next !== selection
      : next.startSecs !== selection.startSecs || next.endSecs !== selection.endSecs;
    if (changed) {
      selection = next;
      for (const listener of [...listeners]) listener(selection);
    }
    return selection;
  }

  return {
    getSelection: () => selection,
    setSelection: (startSecs, endSecs) => commit(normalizeTimeRange(startSecs, endSecs)),
    clearSelection: () => commit(null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The one shared instance the drag gesture writes and daw-shell-runtime paints from. */
export const sessionTimeSelection: TimeSelectionModel = createTimeSelectionModel();
