// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session overview/fit strip (#1282): a read-only band showing the WHOLE
// session duration and a visible-range box marking the slice of it the
// (zoomable, clipped) timeline column is currently showing. This is
// deliberately a PERCENT-OF-DURATION coordinate space, not the shell-local
// pixel space ADR-0086/0090 give the ruler, gridlines, clips and playhead —
// see this story's ADR. The one join between the two spaces is
// timelineTimeAt, the shared scale's sanctioned inverse (ADR-0101); no
// overview code may divide an x by a pixels-per-second value of its own.
//
// Do NOT import this module from daw-shell-runtime.ts — that module's header
// documents why timeline-scale.ts already imports FROM it, and a runtime
// import back here would close an ESM cycle.

import { DAW_TIMELINE_ORIGIN_PX, DAW_TIMELINE_INSET_PX } from './daw-shell-runtime';
import { timelineTimeAt } from './timeline-scale';
import { formatRulerElapsed } from './timeline-ruler-labels';

/** The shortest span the overview ever represents, so a short or empty
 *  session still gets a sane strip instead of a degenerate zero-width one. */
export const TIMELINE_OVERVIEW_MIN_DURATION_SECS = 60;

export const TIMELINE_OVERVIEW_RANGE_SELECTOR = '.daw-overview-range';
export const TIMELINE_OVERVIEW_TOTAL_SELECTOR = '.daw-overview-total';

const PERCENT = 100;

/** Everything the overview needs that is NOT a measurement of the shell. */
export interface TimelineOverviewSource {
  loadedDurationSecs: number;
  recordedElapsedSecs: number;
  pxPerSecond: number;
}

export interface TimelineOverviewInput extends TimelineOverviewSource {
  /** The .daw-shell's measured width in px. 0 (or anything <= the head column)
   *  means "not measured yet" and resolves to a full-width visible range,
   *  never a NaN one. */
  shellWidthPx: number;
}

export interface TimelineOverviewView {
  durationSecs: number;
  visibleStartSecs: number;
  visibleEndSecs: number;
  leftPct: number;
  widthPct: number;
  totalLabel: string;
}

/** Structural shapes so a plain object satisfies the patcher in tests — same
 *  convention as session-timeline-scrub.ts / session-tab-waveforms.ts. */
interface TimelineOverviewNodeLike {
  style: { left: string; width: string };
  textContent: string | null;
}
export interface TimelineOverviewShellLike {
  clientWidth: number;
  querySelector(selector: string): TimelineOverviewNodeLike | null;
}

function positiveSecs(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The full-timeline duration the overview's percentages are taken against:
 *  the larger of the loaded take's duration and the elapsed recording time,
 *  floored at TIMELINE_OVERVIEW_MIN_DURATION_SECS. Non-finite or negative
 *  inputs contribute 0 rather than NaN, so the result is always finite and
 *  >= the floor — safe to divide by. */
export function timelineOverviewDurationSecs(loadedDurationSecs: number, recordedElapsedSecs: number): number {
  return Math.max(TIMELINE_OVERVIEW_MIN_DURATION_SECS, positiveSecs(loadedDurationSecs), positiveSecs(recordedElapsedSecs));
}

function fullRangeView(durationSecs: number): TimelineOverviewView {
  return {
    durationSecs,
    visibleStartSecs: 0,
    visibleEndSecs: durationSecs,
    leftPct: 0,
    widthPct: PERCENT,
    totalLabel: formatRulerElapsed(durationSecs),
  };
}

/** Builds the overview's view: the resolved full-timeline duration plus the
 *  visible-range box's percentages, derived from the timeline column's own
 *  visible x window [DAW_TIMELINE_ORIGIN_PX, shellWidthPx - DAW_TIMELINE_INSET_PX]
 *  converted back to seconds through the shared scale's timelineTimeAt
 *  inverse (ADR-0101) — never a local division by pxPerSecond. */
export function timelineOverviewView(input: TimelineOverviewInput): TimelineOverviewView {
  const durationSecs = timelineOverviewDurationSecs(input.loadedDurationSecs, input.recordedElapsedSecs);
  const maxX = Number.isFinite(input.shellWidthPx) ? input.shellWidthPx - DAW_TIMELINE_INSET_PX : DAW_TIMELINE_ORIGIN_PX;
  if (maxX <= DAW_TIMELINE_ORIGIN_PX) return fullRangeView(durationSecs);

  const startSecs = timelineTimeAt(input.pxPerSecond, DAW_TIMELINE_ORIGIN_PX);
  const endSecs = timelineTimeAt(input.pxPerSecond, maxX);
  const visibleStartSecs = clamp(startSecs, 0, durationSecs);
  const visibleEndSecs = clamp(endSecs, visibleStartSecs, durationSecs);
  // Both percentages are already inside [0, 100] by construction from the
  // clamp above — no re-clamping needed.
  const leftPct = (visibleStartSecs / durationSecs) * PERCENT;
  const widthPct = ((visibleEndSecs - visibleStartSecs) / durationSecs) * PERCENT;
  return { durationSecs, visibleStartSecs, visibleEndSecs, leftPct, widthPct, totalLabel: formatRulerElapsed(durationSecs) };
}

// No escaping applied: both interpolations are String(number) off a finite,
// clamped value and formatRulerElapsed's digits-and-colon output — never user
// text (same rationale as timelineBpmControlHTML).
export function timelineOverviewHTML(view: TimelineOverviewView): string {
  return `<div class="daw-overview"><span class="daw-overview-range" style="left:${view.leftPct}%;width:${view.widthPct}%"></span><span class="daw-overview-total">${view.totalLabel}</span></div>`;
}

/** Patches the overview's visible-range box and total-duration readout onto a
 *  measured shell, exactly like renderPlayhead: imperative, DOM-in/DOM-out,
 *  no state read. A null shell, or a shell missing either node, is a no-op
 *  for that node. */
export function patchTimelineOverview(shell: TimelineOverviewShellLike | null, source: TimelineOverviewSource): void {
  if (!shell) return;
  const view = timelineOverviewView({ ...source, shellWidthPx: shell.clientWidth });
  const range = shell.querySelector(TIMELINE_OVERVIEW_RANGE_SELECTOR);
  if (range) {
    range.style.left = `${view.leftPct}%`;
    range.style.width = `${view.widthPct}%`;
  }
  const total = shell.querySelector(TIMELINE_OVERVIEW_TOTAL_SELECTOR);
  if (total && total.textContent !== view.totalLabel) total.textContent = view.totalLabel;
}
