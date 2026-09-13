// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session ruler's dual readout (#1275, epic #1260): bars/beats beside
// elapsed time for each labelled tick. This module is the only one that holds
// both a TimelineScale and a TimelineTempo, and it holds them
// one-directionally — scale.timeToX is the sole source of every label's xPx,
// and tempo.bpm reaches text alone through barsBeatsAt. No coordinate,
// transport value, clip duration or waveform bucket is ever computed through
// BPM (ADR-0104). Pure module: no DOM, no store, no React, no window access.

import { TIMELINE_DEFAULT_BPM, type TimelineTempo } from './timeline-bpm';
import type { TimelineScale } from './timeline-scale';

/** The narrowest a ruler label may sit from its neighbour before the labelling
 *  interval steps up to the next choice. */
export const RULER_LABEL_MIN_SPACING_PX = 64;

/** The labelling intervals, in seconds, in increasing order. The first one wide
 *  enough at the current scale wins; the last is the sparsest fallback. */
export const RULER_LABEL_INTERVAL_CHOICES_SECS: readonly number[] = [5, 10, 30, 60, 120, 300];

/** 4/4 — the arrangement has no time-signature model, so bars are four beats. */
export const RULER_BEATS_PER_BAR = 4;

/** Four sixteenth-note subdivisions make one beat. */
export const RULER_SUBDIVISIONS_PER_BEAT = 4;

const SECONDS_PER_MINUTE = 60;

// Absorbs float error in timeSecs * bpm / 60 * 4 so a tick can never label one
// sixteenth early (e.g. 2.4s at 175 BPM evaluates to 27.999999999999996 units).
const SUBDIVISION_EPSILON = 1e-6;

/** A 1-based 4/4 musical position for display-only timeline text. */
export interface MusicalPosition {
  readonly bar: number;
  readonly beat: number;
  readonly subdivision: number;
}

/** One labelled ruler position: the arrangement time it marks, the shell-local x
 *  for that time from the shared scale, and the two readout strings. Both strings
 *  come from the one timeSecs, and both render inside the one element positioned
 *  at xPx — so they cannot disagree about where they point. */
export interface TimelineRulerLabel {
  timeSecs: number;
  xPx: number;
  bars: string;
  elapsed: string;
}

/** Picks the labelling interval (in seconds) for a given scale: the first choice
 *  in RULER_LABEL_INTERVAL_CHOICES_SECS wide enough to clear
 *  RULER_LABEL_MIN_SPACING_PX at that scale, falling back to the sparsest choice
 *  when pxPerSecond is non-finite, non-positive, or no choice qualifies. */
export function rulerLabelIntervalSecs(pxPerSecond: number): number {
  const sparsest = RULER_LABEL_INTERVAL_CHOICES_SECS[RULER_LABEL_INTERVAL_CHOICES_SECS.length - 1];
  if (!Number.isFinite(pxPerSecond) || pxPerSecond <= 0) return sparsest;
  for (const choice of RULER_LABEL_INTERVAL_CHOICES_SECS) {
    if (choice * pxPerSecond >= RULER_LABEL_MIN_SPACING_PX) return choice;
  }
  return sparsest;
}

/** Converts elapsed real seconds to a 1-based 4/4 musical position. Non-finite
 *  or negative time resolves to 0s; non-finite or non-positive BPM falls back
 *  to TIMELINE_DEFAULT_BPM. */
export function secondsToMusicalPosition(timeSecs: number, bpm: number): MusicalPosition {
  const secs = Number.isFinite(timeSecs) && timeSecs > 0 ? timeSecs : 0;
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : TIMELINE_DEFAULT_BPM;
  const totalSubdivisions = Math.floor(
    ((secs * tempo) / SECONDS_PER_MINUTE) * RULER_SUBDIVISIONS_PER_BEAT + SUBDIVISION_EPSILON,
  );
  const subdivisionsPerBar = RULER_BEATS_PER_BAR * RULER_SUBDIVISIONS_PER_BEAT;
  const bar = Math.floor(totalSubdivisions / subdivisionsPerBar) + 1;
  const subdivisionsWithinBar = totalSubdivisions % subdivisionsPerBar;
  const beat = Math.floor(subdivisionsWithinBar / RULER_SUBDIVISIONS_PER_BEAT) + 1;
  const subdivision = (subdivisionsWithinBar % RULER_SUBDIVISIONS_PER_BEAT) + 1;
  return { bar, beat, subdivision };
}

/** Formats a musical position as a conventional 1-based 'bar.beat.subdivision' string. */
export function formatMusicalPosition(position: MusicalPosition): string {
  return `${position.bar}.${position.beat}.${position.subdivision}`;
}

/** Formats an arrangement time as a 1-based 'bar.beat' compatibility string
 *  at the given 4/4 tempo. */
export function barsBeatsAt(timeSecs: number, bpm: number): string {
  const { bar, beat } = secondsToMusicalPosition(timeSecs, bpm);
  return `${bar}.${beat}`;
}

/** M:SS readout for the ruler, mirroring daw-playhead-state.js's
 *  formatElapsed (guarded by a drift test) without reaching that module's
 *  window.dawPlayheadState global seam from this pure module. Non-finite or
 *  negative time resolves to 0:00. */
export function formatRulerElapsed(timeSecs: number): string {
  const s = Number.isFinite(timeSecs) && timeSecs > 0 ? timeSecs : 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

/** Builds the ruler's dual-readout labels across [0, spanSecs] at the interval
 *  rulerLabelIntervalSecs picks for the scale's pxPerSecond. Every label's xPx
 *  comes from scale.timeToX — the same call the tick at that time makes — and
 *  both readout strings derive from that label's own timeSecs. Returns [] for
 *  a non-finite or negative spanSecs, matching dawRulerTicks's guard shape. */
export function timelineRulerLabels(spanSecs: number, scale: TimelineScale, tempo: TimelineTempo): TimelineRulerLabel[] {
  if (!Number.isFinite(spanSecs) || spanSecs < 0) return [];
  const interval = rulerLabelIntervalSecs(scale.pxPerSecond);
  const count = Math.floor(spanSecs / interval) + 1;
  const labels: TimelineRulerLabel[] = [];
  for (let i = 0; i < count; i++) {
    const timeSecs = i * interval;
    labels.push({
      timeSecs,
      xPx: scale.timeToX(timeSecs),
      bars: barsBeatsAt(timeSecs, tempo.bpm),
      elapsed: formatRulerElapsed(timeSecs),
    });
  }
  return labels;
}
