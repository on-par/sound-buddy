// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The arrangement's clip selection (#1303). A leaf module on purpose — it
// imports NOTHING — because daw-shell-runtime.ts imports it, and any import
// from here into lane-background-click.ts / timeline-scale.ts would close an
// ESM cycle back into the painter. Modelled directly on timeline-state.ts's
// createTimelineMarksModel: pure, no DOM, no store, no React import.

/** The class the SELECTED clip's enclosing .daw-channel-lane carries. On the lane, not the
 *  clip span, so the painter needs no import from lane-background-click.ts (ESM cycle). */
export const CLIP_SELECTED_LANE_CLASS = 'clip-selected';

/** The arrangement's clip selection. Identity is the lane's channel index — exact while a
 *  lane holds at most one take clip; a multi-clip lane widens this to a compound id. */
export interface ClipSelectionModel {
  getSelectedChannel(): number | null;
  /** Ignores a non-integer or negative index (returns the unchanged selection). */
  selectClip(channelIndex: number): number | null;
  clearSelection(): number | null;
  /** Returns an unsubscribe function. Listeners fire only on a real change. */
  subscribe(listener: (selected: number | null) => void): () => void;
}

export function createClipSelectionModel(): ClipSelectionModel {
  let selected: number | null = null;
  const listeners = new Set<(selected: number | null) => void>();

  function commit(next: number | null): number | null {
    if (next !== selected) {
      selected = next;
      for (const listener of [...listeners]) listener(selected);
    }
    return selected;
  }

  return {
    getSelectedChannel: () => selected,
    selectClip: (channelIndex) => {
      if (!Number.isInteger(channelIndex) || channelIndex < 0) return selected;
      return commit(channelIndex);
    },
    clearSelection: () => commit(null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The one shared instance LiveCapturePanel writes and daw-shell-runtime paints from. */
export const sessionClipSelection: ClipSelectionModel = createClipSelectionModel();
