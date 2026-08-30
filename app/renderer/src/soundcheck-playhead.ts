// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Real playhead geometry for the Virtual Soundcheck timeline (story 4/4 #736):
// the px left of the #sc-playhead overlay line and the continuous seek time for
// a pointer on #sc-waveforms. The soundcheck lanes differ from the full-width
// spectrum heatmap in one way — a variable-width track-name column (flex 0 0
// auto, min 52px) sits before each canvas, so the time axis starts at the
// measured name width, not x=0 — hence both helpers take nameWidthPx and
// canvasWidthPx as measured parameters (ADR-0005: pure math, side effects
// injected as args; the Session workspace owns the DOM measurements and is
// e2e-gated). Both delegate their fraction/clamp to the #695
// spectrum-transport helpers.

import { playheadPercent, seekTimeFromBarClick } from './spectrum-transport';
import { DAW_TIMELINE_ORIGIN_PX } from './daw-shell-runtime';
import { createTimelineScale, type TimelineScale } from './timeline-scale';

/** A clamped Session arrangement position and its shared shell-local x coordinate. */
export interface SoundcheckTimelinePreview {
  elapsedSecs: number;
  leftPx: number;
}

// Px position of the absolute playhead overlay relative to the #sc-waveforms
// container: the time axis starts at the (measured) track-name column edge and
// runs across the (measured) first canvas. Delegates the fraction to the
// #695 helper. null for non-positive duration/geometry.
export function soundcheckPlayheadLeftPx(
  elapsedSecs: number,
  durationSecs: number,
  nameWidthPx: number,
  canvasWidthPx: number,
): number | null {
  if (!(durationSecs > 0) || !(nameWidthPx > 0) || !(canvasWidthPx > 0)) return null;
  return nameWidthPx + (playheadPercent(elapsedSecs, durationSecs) / 100) * canvasWidthPx;
}

// Continuous seek time for a pointer on #sc-waveforms: the seekable area is the
// canvas column [containerLeft + nameWidthPx, + canvasWidthPx]. Delegates to
// the #695 seekTimeFromBarClick (the frameIndexFromClick-equivalent, adapted to
// raw seconds). Returns null when the pointer lands on the track-name column or
// the geometry/duration is invalid.
export function soundcheckSeekTargetFromClick(
  clientX: number,
  containerLeft: number,
  nameWidthPx: number,
  canvasWidthPx: number,
  durationSecs: number,
): number | null {
  if (!(nameWidthPx > 0) || !(canvasWidthPx > 0) || !(durationSecs > 0)) return null;
  const boxLeft = containerLeft + nameWidthPx;
  if (clientX < boxLeft) return null;
  return seekTimeFromBarClick(clientX, boxLeft, canvasWidthPx, durationSecs);
}

// The fixed scale every current caller gets. createTimelineScale('default') is provably
// identical to dawTimelineX (ADR-0100), so this is a wiring change, not a behavior change.
const DEFAULT_TIMELINE_SCALE = createTimelineScale('default');

/**
 * Maps a ruler or lane pointer position into the Session arrangement coordinate space at
 * the given horizontal scale (ADR-0100). The pointer offset is measured from the timeline
 * column's left edge, which is the shared t=0 edge, so it is re-based into shell-local
 * coordinates by DAW_TIMELINE_ORIGIN_PX before the scale converts it — that keeps
 * scale.xToTime(preview.leftPx) === preview.elapsedSecs for any in-range pointer. Omitting
 * the scale yields today's fixed geometry.
 */
export function soundcheckTimelinePreviewFromPointer(
  clientX: number,
  timelineLeftPx: number,
  durationSecs: number,
  scale: TimelineScale = DEFAULT_TIMELINE_SCALE,
): SoundcheckTimelinePreview | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(timelineLeftPx)
    || !Number.isFinite(durationSecs) || durationSecs <= 0) return null;
  const shellX = DAW_TIMELINE_ORIGIN_PX + (clientX - timelineLeftPx);
  const elapsedSecs = Math.min(durationSecs, Math.max(0, scale.xToTime(shellX)));
  return { elapsedSecs, leftPx: scale.timeToX(elapsedSecs) };
}
