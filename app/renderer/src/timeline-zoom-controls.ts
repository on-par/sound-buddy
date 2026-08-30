// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session timeline's fit/zoom controls (#1284): a pure sibling of
// timeline-bpm-control.ts / timeline-overview.ts — a TimelineVisibleRange
// model in real seconds, a single-slot zoom-back memory, and the five pure
// intent handlers behind one applyTimelineZoom(model, action, ctx) reducer,
// plus the compact toolbar view/HTML builder and its id->action lookup. This
// module is pure: no DOM, no store, no React import. It models the visible
// range in seconds only and MUST NOT import './daw-shell-runtime' or compute
// an x — resolving a range to pixels needs a horizontal scroll offset that
// does not exist yet and belongs to #1283 (see this story's ADR).

import { formatRulerElapsed } from './timeline-ruler-labels';

/** The narrowest visible span any zoom action may produce. */
export const TIMELINE_ZOOM_MIN_SPAN_SECS = 1;
/** How far one zoom-in/zoom-out click steps: the span is divided/multiplied by this. */
export const TIMELINE_ZOOM_CONTROL_FACTOR = 2;
/** The window zoom-to-selection uses when the "selection" is a bare insert marker
 *  (no selection and no loaded take) - Ableton's behaviour with only an insert point. */
export const TIMELINE_ZOOM_INSERT_SPAN_SECS = 4;
/** Seconds tolerance for the derived enabled/disabled comparisons below. Spans are
 *  computed by division and multiplication, so `span === fullSecs` is never a safe test. */
const TIMELINE_ZOOM_EPSILON_SECS = 1e-6;

export type TimelineZoomAction = 'fit-full' | 'zoom-in' | 'zoom-out' | 'zoom-to-selection' | 'zoom-back';

/** A slice of session time, in real seconds from t=0. Never a pixel value. */
export interface TimelineVisibleRange {
  readonly startSecs: number;
  readonly endSecs: number;
}

export interface TimelineZoomModel {
  readonly range: TimelineVisibleRange;
  /** The range active immediately before the last zoom-to-selection. Single slot:
   *  only zoom-to-selection writes it, zoom-back consumes it, every other action
   *  clears it (see the ADR - this is not an undo stack). */
  readonly previousRange: TimelineVisibleRange | null;
}

export interface TimelineZoomContext {
  /** The whole loaded/recording timeline, from timelineOverviewDurationSecs (#1282). */
  durationSecs: number;
  /** Anchor for zoom-in/zoom-out and for the insert-marker selection fallback. */
  playheadSecs: number;
  /** The selected time span, or null when nothing is selected. */
  selection: TimelineVisibleRange | null;
}

export interface TimelineZoomControlsView {
  range: TimelineVisibleRange;
  rangeLabel: string;
  canFitFull: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  canZoomBack: boolean;
}

/** Guarantees a finite, positive full duration that is always >= the minimum
 *  span, so every clamp below is safe and no caller can divide by zero. */
function fullDurationSecs(durationSecs: number): number {
  return Math.max(TIMELINE_ZOOM_MIN_SPAN_SECS, Number.isFinite(durationSecs) && durationSecs > 0 ? durationSecs : 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// centerSecs and spanSecs are always finite by the time they reach here —
// every call site already resolves its own non-finite input to a fallback
// (anchorSecs, the range-midpoint math, or a literal constant) before calling
// this helper, so a second guard here would be unreachable dead code.
function rangeOfSpan(centerSecs: number, spanSecs: number, fullSecs: number): TimelineVisibleRange {
  const span = clamp(spanSecs, TIMELINE_ZOOM_MIN_SPAN_SECS, fullSecs);
  const startSecs = clamp(centerSecs - span / 2, 0, fullSecs - span);
  return { startSecs, endSecs: startSecs + span };
}

function normalizeRange(range: TimelineVisibleRange | null, fullSecs: number): TimelineVisibleRange {
  if (range === null || !Number.isFinite(range.startSecs) || !Number.isFinite(range.endSecs) || range.endSecs - range.startSecs <= 0) {
    return { startSecs: 0, endSecs: fullSecs };
  }
  const startSecs = clamp(range.startSecs, 0, fullSecs);
  const endSecs = clamp(range.endSecs, startSecs, fullSecs);
  if (endSecs - startSecs < TIMELINE_ZOOM_MIN_SPAN_SECS) {
    return rangeOfSpan((startSecs + endSecs) / 2, TIMELINE_ZOOM_MIN_SPAN_SECS, fullSecs);
  }
  return { startSecs, endSecs };
}

/** "around a fixed center or playhead" from the issue: the playhead when it is
 *  finite and inside the current range, otherwise the range's own centre. */
function anchorSecs(cur: TimelineVisibleRange, playheadSecs: number): number {
  if (Number.isFinite(playheadSecs) && playheadSecs >= cur.startSecs && playheadSecs <= cur.endSecs) return playheadSecs;
  return (cur.startSecs + cur.endSecs) / 2;
}

function selectionRange(ctx: TimelineZoomContext, fullSecs: number): TimelineVisibleRange {
  const sel = ctx.selection;
  if (sel !== null && Number.isFinite(sel.startSecs) && Number.isFinite(sel.endSecs) && sel.endSecs > sel.startSecs) {
    return normalizeRange(sel, fullSecs);
  }
  return rangeOfSpan(Number.isFinite(ctx.playheadSecs) ? ctx.playheadSecs : 0, TIMELINE_ZOOM_INSERT_SPAN_SECS, fullSecs);
}

export function createTimelineZoomModel(durationSecs: number): TimelineZoomModel {
  return { range: { startSecs: 0, endSecs: fullDurationSecs(durationSecs) }, previousRange: null };
}

export function applyTimelineZoom(model: TimelineZoomModel, action: TimelineZoomAction, ctx: TimelineZoomContext): TimelineZoomModel {
  const fullSecs = fullDurationSecs(ctx.durationSecs);
  const cur = normalizeRange(model.range, fullSecs);
  switch (action) {
    case 'fit-full':
      return { range: { startSecs: 0, endSecs: fullSecs }, previousRange: null };
    case 'zoom-in':
      return { range: rangeOfSpan(anchorSecs(cur, ctx.playheadSecs), (cur.endSecs - cur.startSecs) / TIMELINE_ZOOM_CONTROL_FACTOR, fullSecs), previousRange: null };
    case 'zoom-out':
      return { range: rangeOfSpan(anchorSecs(cur, ctx.playheadSecs), (cur.endSecs - cur.startSecs) * TIMELINE_ZOOM_CONTROL_FACTOR, fullSecs), previousRange: null };
    case 'zoom-to-selection':
      return { range: selectionRange(ctx, fullSecs), previousRange: cur };
    case 'zoom-back':
      if (model.previousRange === null) return model;
      return { range: normalizeRange(model.previousRange, fullSecs), previousRange: null };
    default:
      return model;
  }
}

export function timelineZoomControlsView(model: TimelineZoomModel, ctx: TimelineZoomContext): TimelineZoomControlsView {
  const fullSecs = fullDurationSecs(ctx.durationSecs);
  const range = normalizeRange(model.range, fullSecs);
  const span = range.endSecs - range.startSecs;
  return {
    range,
    rangeLabel: `${formatRulerElapsed(range.startSecs)} - ${formatRulerElapsed(range.endSecs)}`,
    canFitFull: range.startSecs > TIMELINE_ZOOM_EPSILON_SECS || fullSecs - range.endSecs > TIMELINE_ZOOM_EPSILON_SECS,
    canZoomIn: span - TIMELINE_ZOOM_MIN_SPAN_SECS > TIMELINE_ZOOM_EPSILON_SECS,
    canZoomOut: fullSecs - span > TIMELINE_ZOOM_EPSILON_SECS,
    canZoomBack: model.previousRange !== null,
  };
}

/** One frozen id map, not five loose string constants — every button id and
 *  its reverse lookup below read from this one source. */
export const TIMELINE_ZOOM_BUTTON_IDS: Readonly<Record<TimelineZoomAction, string>> = Object.freeze({
  'fit-full': 'daw-zoom-fit',
  'zoom-in': 'daw-zoom-in',
  'zoom-out': 'daw-zoom-out',
  'zoom-to-selection': 'daw-zoom-selection',
  'zoom-back': 'daw-zoom-back',
});
export const TIMELINE_ZOOM_RANGE_ID = 'daw-zoom-range';

export function timelineZoomActionForId(id: string): TimelineZoomAction | null {
  const found = (Object.keys(TIMELINE_ZOOM_BUTTON_IDS) as TimelineZoomAction[])
    .find((action) => TIMELINE_ZOOM_BUTTON_IDS[action] === id);
  return found ?? null;
}

interface ZoomButtonSpec {
  action: TimelineZoomAction;
  label: string;
  title: string;
  disabled: boolean;
}

function buttonSpecs(view: TimelineZoomControlsView): ZoomButtonSpec[] {
  return [
    { action: 'fit-full', label: 'Fit', title: 'Fit the whole session in view', disabled: !view.canFitFull },
    { action: 'zoom-out', label: '-', title: 'Zoom out', disabled: !view.canZoomOut },
    { action: 'zoom-in', label: '+', title: 'Zoom in', disabled: !view.canZoomIn },
    { action: 'zoom-to-selection', label: 'Sel', title: 'Zoom to the selected time range', disabled: false },
    { action: 'zoom-back', label: 'Back', title: 'Back to the range before Zoom to selection', disabled: !view.canZoomBack },
  ];
}

/** Raw toolbar markup consumed by LiveCapturePanel's delegated click handler.
 *  No escaping is applied — every interpolation is either one of this module's
 *  own literals or formatRulerElapsed's digits-and-colon output, never user text. */
export function timelineZoomControlsHTML(view: TimelineZoomControlsView): string {
  const buttonsHTML = buttonSpecs(view).map((spec) => {
    const id = TIMELINE_ZOOM_BUTTON_IDS[spec.action];
    return `<button type="button" class="ghost-btn sm daw-zoom-btn" id="${id}" title="${spec.title}" aria-label="${spec.title}"${spec.disabled ? ' disabled' : ''}>${spec.label}</button>`;
  }).join('');
  return `<span class="daw-transport-zoom">${buttonsHTML}`
    + `<span class="daw-transport-zoom-range" id="${TIMELINE_ZOOM_RANGE_ID}" role="status">${view.rangeLabel}</span>`
    + `</span>`;
}
