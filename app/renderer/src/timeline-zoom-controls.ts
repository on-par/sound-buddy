// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session timeline's fit/zoom controls (#1284): a pure sibling of
// timeline-bpm-control.ts / timeline-overview.ts — the single-slot zoom-back
// memory and the five pure intent handlers behind one
// applyTimelineZoom(model, action, ctx) reducer, plus the compact toolbar
// view/HTML builder and its id->action lookup. This module is pure: no DOM,
// no store, no React import. It models the visible range in seconds only and
// MUST NOT import './daw-shell-runtime' or compute an x — resolving a range
// to pixels needs a horizontal scroll offset that does not exist yet and
// belongs to #1283 (see this story's ADR). The TimelineVisibleRange type and
// its clamp rule now live in ./timeline-visible-range (#1290) — this module
// delegates to that shared model instead of keeping its own copy.

import { formatRulerElapsed } from './timeline-ruler-labels';
import {
  clampVisibleRange,
  timelineFullDurationSecs,
  visibleRangeAnchorSecs,
  visibleRangeOfSpan,
  TIMELINE_MIN_VISIBLE_SPAN_SECS,
  type TimelineVisibleRange,
} from './timeline-visible-range';

export type { TimelineVisibleRange };

/** The narrowest visible span any zoom action may produce — the shared bound,
 *  see timeline-visible-range.ts. */
export const TIMELINE_ZOOM_MIN_SPAN_SECS = TIMELINE_MIN_VISIBLE_SPAN_SECS;
/** How far one zoom-in/zoom-out click steps: the span is divided/multiplied by this. */
export const TIMELINE_ZOOM_CONTROL_FACTOR = 2;
/** The window zoom-to-selection uses when the "selection" is a bare insert marker
 *  (no selection and no loaded take) - Ableton's behaviour with only an insert point. */
export const TIMELINE_ZOOM_INSERT_SPAN_SECS = 4;
/** Seconds tolerance for the derived enabled/disabled comparisons below. Spans are
 *  computed by division and multiplication, so `span === fullSecs` is never a safe test. */
const TIMELINE_ZOOM_EPSILON_SECS = 1e-6;

export type TimelineZoomAction = 'fit-full' | 'zoom-in' | 'zoom-out' | 'zoom-to-selection' | 'zoom-back';

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
  /** Anchor for zoom-in/zoom-out (ADR-0113). No longer the insert-marker
   *  selection fallback — see insertMarkerSecs below. */
  playheadSecs: number;
  /** The selected time span, or null when nothing is selected. */
  selection: TimelineVisibleRange | null;
  /** Where an insert-point action starts (#1301) — distinct from the playhead. Optional:
   *  a caller that supplies none falls back to the playhead, which is pre-#1301 behaviour. */
  insertMarkerSecs?: number;
}

export interface TimelineZoomControlsView {
  range: TimelineVisibleRange;
  rangeLabel: string;
  canFitFull: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  canZoomBack: boolean;
}

function selectionRange(ctx: TimelineZoomContext, fullSecs: number): TimelineVisibleRange {
  const sel = ctx.selection;
  if (sel !== null && Number.isFinite(sel.startSecs) && Number.isFinite(sel.endSecs) && sel.endSecs > sel.startSecs) {
    return clampVisibleRange(sel, fullSecs);
  }
  const insertSecs = ctx.insertMarkerSecs ?? ctx.playheadSecs;
  return visibleRangeOfSpan(Number.isFinite(insertSecs) ? insertSecs : 0, TIMELINE_ZOOM_INSERT_SPAN_SECS, fullSecs);
}

export function createTimelineZoomModel(durationSecs: number): TimelineZoomModel {
  return { range: { startSecs: 0, endSecs: timelineFullDurationSecs(durationSecs) }, previousRange: null };
}

export function applyTimelineZoom(model: TimelineZoomModel, action: TimelineZoomAction, ctx: TimelineZoomContext): TimelineZoomModel {
  const fullSecs = timelineFullDurationSecs(ctx.durationSecs);
  const cur = clampVisibleRange(model.range, fullSecs);
  switch (action) {
    case 'fit-full':
      return { range: { startSecs: 0, endSecs: fullSecs }, previousRange: null };
    case 'zoom-in':
      return { range: visibleRangeOfSpan(visibleRangeAnchorSecs(cur, ctx.playheadSecs), (cur.endSecs - cur.startSecs) / TIMELINE_ZOOM_CONTROL_FACTOR, fullSecs), previousRange: null };
    case 'zoom-out':
      return { range: visibleRangeOfSpan(visibleRangeAnchorSecs(cur, ctx.playheadSecs), (cur.endSecs - cur.startSecs) * TIMELINE_ZOOM_CONTROL_FACTOR, fullSecs), previousRange: null };
    case 'zoom-to-selection':
      return { range: selectionRange(ctx, fullSecs), previousRange: cur };
    case 'zoom-back':
      if (model.previousRange === null) return model;
      return { range: clampVisibleRange(model.previousRange, fullSecs), previousRange: null };
    default:
      return model;
  }
}

export function timelineZoomControlsView(model: TimelineZoomModel, ctx: TimelineZoomContext): TimelineZoomControlsView {
  const fullSecs = timelineFullDurationSecs(ctx.durationSecs);
  const range = clampVisibleRange(model.range, fullSecs);
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
    // #1347: `Sel`/`Back` read as cryptic in the packed toolbar. The verbs
    // `Fit sel`/`Prev` are self-explanatory beside the `Fit` button and inside
    // the "Timeline zoom" group; the full description stays in title/aria-label.
    { action: 'zoom-to-selection', label: 'Fit sel', title: 'Zoom to the selected time range', disabled: false },
    { action: 'zoom-back', label: 'Prev', title: 'Back to the range before Zoom to selection', disabled: !view.canZoomBack },
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
  // #1347: role="group" + a label names the cluster so it reads as one
  // "Timeline zoom" unit rather than five loose buttons, and so the compact
  // button labels are scannable in context.
  return `<span class="daw-transport-zoom daw-transport-group" role="group" aria-label="Timeline zoom">${buttonsHTML}`
    + `<span class="daw-transport-zoom-range" id="${TIMELINE_ZOOM_RANGE_ID}" role="status">${view.rangeLabel}</span>`
    + `</span>`;
}
