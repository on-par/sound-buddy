// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The arrangement's accessible representation of its four interaction states
// (#1306): the playback playhead, the insert marker, the clip selection and
// the time-range selection. A leaf module on purpose — it imports NOTHING —
// because daw-shell-runtime.ts imports it, and an import of
// ./timeline-ruler-labels (which imports ./timeline-scale, which imports
// ./daw-shell-runtime) would close an ESM cycle back into the painter. That
// is why formatAccessibleTime is a hand-duplicated behavioural copy of
// formatRulerElapsed rather than an import of it, pinned to it by a drift
// test (the ADR-0011 pattern). The region this module's strings feed is
// NEVER an aria-live region (see this story's ADR): renderPlayhead reaches
// the painter at animation rate, and a live region there would fire a
// screen-reader announcement up to sixty times a second.

/** The hidden region that holds the arrangement's four state labels. */
export const TIMELINE_A11Y_REGION_CLASS = 'daw-arrangement-a11y';
/** The accessible name of that region. */
export const TIMELINE_A11Y_REGION_LABEL = 'Arrangement position and selection';
export const TIMELINE_A11Y_INSERT_MARKER_CLASS = 'daw-a11y-insert-marker';
export const TIMELINE_A11Y_PLAYHEAD_CLASS = 'daw-a11y-playhead';
export const TIMELINE_A11Y_CLIP_SELECTION_CLASS = 'daw-a11y-clip-selection';
export const TIMELINE_A11Y_TIME_SELECTION_CLASS = 'daw-a11y-time-selection';

/** Seconds in a minute — the m:ss formatter's one divisor (no magic numbers). */
const SECONDS_PER_MINUTE = 60;

/** A snapshot of the arrangement's four states, in real seconds from t=0. Deliberately
 *  structural (not the model interfaces) so this module imports nothing. */
export interface TimelineAccessibilityState {
  playheadSecs: number;
  insertMarkerSecs: number;
  /** The selected lane's channel index, or null when no clip is selected. */
  selectedClipChannel: number | null;
  /** The selected span, or null when nothing is selected. */
  timeSelection: { startSecs: number; endSecs: number } | null;
}

/** One string per state — four independent strings, never one composed sentence, so a
 *  screen reader reports the marker and the playhead as distinct information. */
export interface TimelineAccessibilityLabels {
  insertMarker: string;
  playhead: string;
  clipSelection: string;
  timeSelection: string;
}

/** M:SS readout, a verbatim behavioural duplicate of formatRulerElapsed
 *  (timeline-ruler-labels.ts) — see the module header for why this can't be
 *  an import. Non-finite or non-positive input formats as 0:00. */
export function formatAccessibleTime(timeSecs: number): string {
  const s = Number.isFinite(timeSecs) && timeSecs > 0 ? timeSecs : 0;
  const m = Math.floor(s / SECONDS_PER_MINUTE);
  const sec = Math.floor(s % SECONDS_PER_MINUTE);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

export function timelineAccessibilityLabels(state: TimelineAccessibilityState): TimelineAccessibilityLabels {
  const { selectedClipChannel, timeSelection } = state;
  const clipSelection = selectedClipChannel !== null && Number.isInteger(selectedClipChannel) && selectedClipChannel >= 0
    ? `Clip selected on channel ${selectedClipChannel}`
    : 'No clip selected';
  const timeSelectionLabel = timeSelection && Number.isFinite(timeSelection.startSecs) && Number.isFinite(timeSelection.endSecs)
    ? `Time selection from ${formatAccessibleTime(timeSelection.startSecs)} to ${formatAccessibleTime(timeSelection.endSecs)}`
    : 'No time selection';
  return {
    insertMarker: `Insert marker at ${formatAccessibleTime(state.insertMarkerSecs)}`,
    playhead: `Playhead at ${formatAccessibleTime(state.playheadSecs)}`,
    clipSelection,
    timeSelection: timeSelectionLabel,
  };
}
