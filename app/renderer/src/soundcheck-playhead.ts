// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Real playhead geometry for the Virtual Soundcheck timeline (story 4/4 #736):
// the px left of the #sc-playhead overlay line and the continuous seek time for
// a pointer on #sc-waveforms. The soundcheck lanes differ from the full-width
// spectrum heatmap in one way — a variable-width track-name column (flex 0 0
// auto, min 52px) sits before each canvas, so the time axis starts at the
// measured name width, not x=0 — hence both helpers take nameWidthPx and
// canvasWidthPx as measured parameters (ADR-0005: pure math, side effects
// injected as args; the DOM appliers that measure them live in SoundcheckPanel
// and are e2e-gated). Both delegate their fraction/clamp to the #695
// spectrum-transport helpers.

import { playheadPercent, seekTimeFromBarClick } from './spectrum-transport';
import { DAW_TIMELINE_PX_PER_SECOND, dawTimelineX } from './daw-shell-runtime';

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

/**
 * Maps a ruler or lane pointer position into the fixed-scale Session
 * arrangement coordinate space. Unlike the legacy Soundcheck panel, every
 * arrangement surface shares the DAW timeline scale and shell-local origin.
 */
export function soundcheckTimelinePreviewFromPointer(
  clientX: number,
  timelineLeftPx: number,
  durationSecs: number,
): SoundcheckTimelinePreview | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(timelineLeftPx)
    || !Number.isFinite(durationSecs) || durationSecs <= 0) return null;
  const elapsedSecs = Math.min(
    durationSecs,
    Math.max(0, (clientX - timelineLeftPx) / DAW_TIMELINE_PX_PER_SECOND),
  );
  return { elapsedSecs, leftPx: dawTimelineX(elapsedSecs) };
}
