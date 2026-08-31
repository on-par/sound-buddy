// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The arrangement's loop region (#1313). A leaf module on purpose — it
// imports NOTHING — because daw-shell-runtime.ts imports it, and any import
// from here back into daw-shell-runtime.ts would close an ESM cycle back
// into the painter. Modelled directly on time-selection.ts's
// createTimeSelectionModel: pure, no DOM, no store, no React import.

/** The class both painted brace segments carry. Exported so live-workspace-view.ts's
 *  painter and daw-shell-runtime.ts's selector cannot drift. */
export const LOOP_BRACE_CLASS = 'daw-loop-brace';
export const LOOP_HANDLE_CLASS = 'daw-loop-handle';
export const LOOP_HANDLE_START_CLASS = 'daw-loop-handle-start';
export const LOOP_HANDLE_END_CLASS = 'daw-loop-handle-end';

/** Where the loop parks before anything moves it: the top of the arrangement, one
 *  major gridline division long (the ruler's 10s major division). */
export const DEFAULT_LOOP_START_SECS = 0;
export const DEFAULT_LOOP_LENGTH_SECS = 10;

/** A span of arrangement time, in real seconds from t=0. Always startSecs <= endSecs. */
export interface LoopRegion {
  readonly startSecs: number;
  readonly endSecs: number;
}

export interface LoopRegionModel {
  getRegion(): LoopRegion;
  /** A non-finite or zero-width pair is IGNORED — the current region stands. */
  setRegion(startSecs: number, endSecs: number): LoopRegion;
  resetForSession(): LoopRegion;
  /** Returns an unsubscribe function. Listeners fire only on a real change. */
  subscribe(listener: (region: LoopRegion) => void): () => void;
}

/** Orders, clamps and validates a raw pair of endpoints into a LoopRegion.
 *  Returns null for a non-finite endpoint, clamps each to Math.max(0, v) (mirrors
 *  normalizeTimeRange in time-selection.ts), orders them so startSecs <= endSecs, and
 *  returns null when they are equal — a zero-width loop is not a loop. */
export function normalizeLoopRegion(aSecs: number, bSecs: number): LoopRegion | null {
  if (!Number.isFinite(aSecs) || !Number.isFinite(bSecs)) return null;
  const a = Math.max(0, aSecs);
  const b = Math.max(0, bSecs);
  if (a === b) return null;
  return Object.freeze(a < b ? { startSecs: a, endSecs: b } : { startSecs: b, endSecs: a });
}

const DEFAULT_LOOP_REGION: LoopRegion = Object.freeze({
  startSecs: DEFAULT_LOOP_START_SECS,
  endSecs: DEFAULT_LOOP_START_SECS + DEFAULT_LOOP_LENGTH_SECS,
});

export function createLoopRegionModel(): LoopRegionModel {
  let region: LoopRegion = DEFAULT_LOOP_REGION;
  const listeners = new Set<(region: LoopRegion) => void>();

  // Exact-value comparison, not epsilon: `region` only ever holds a range this
  // module itself produced via normalizeLoopRegion (or the default constant), so
  // this compares a stored number to itself, not two independently-derived
  // computations (the float rule targets the latter).
  function commit(next: LoopRegion): LoopRegion {
    const changed = next.startSecs !== region.startSecs || next.endSecs !== region.endSecs;
    if (changed) {
      region = next;
      for (const listener of [...listeners]) listener(region);
    }
    return region;
  }

  return {
    getRegion: () => region,
    setRegion: (startSecs, endSecs) => {
      const next = normalizeLoopRegion(startSecs, endSecs);
      return next ? commit(next) : region;
    },
    resetForSession: () => commit(DEFAULT_LOOP_REGION),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The one shared instance later slices mutate and daw-shell-runtime paints from. */
export const sessionLoopRegion: LoopRegionModel = createLoopRegionModel();
