// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session timeline's zoom gesture (#1291): a pure sibling of
// timeline-scroll-gesture.ts that turns a ctrl/meta-modified wheel-like object
// (which is also how a macOS trackpad pinch arrives in Chromium) into a new
// TimelineVisibleRange by scaling its span around the shared
// playhead-or-centre anchor. It owns no clamp of its own — that is
// timeline-visible-range.ts's clampVisibleRange / visibleRangeOfSpan — and no
// second unit conversion of its own — deltaMode line/page pixels reuse
// timeline-scroll-gesture.ts's constants. This module is pure: no DOM, no
// store, no React import. It MUST NOT import './daw-shell-runtime',
// './timeline-bpm' (ADR-0104/0107 - no coordinate is computed through the
// tempo model) or any store.

import {
  clampVisibleRange,
  timelineFullDurationSecs,
  visibleRangeAnchorSecs,
  visibleRangeOfSpan,
  visibleRangeSpanSecs,
  type TimelineVisibleRange,
} from './timeline-visible-range';
import { TIMELINE_SCROLL_LINE_PX, TIMELINE_SCROLL_PAGE_PX } from './timeline-scroll-gesture';

/** The span multiplier's exponent per CSS pixel of zoom delta: a ~140px
 *  trackpad pinch or ctrl-wheel roughly doubles the visible span, which is one
 *  comfortable gesture on a Mac trackpad. */
export const TIMELINE_ZOOM_WHEEL_RATE = 0.005;
/** The most one wheel EVENT may scale the span, in either direction. Chromium
 *  can coalesce a fast flick into a single very large delta; without this a
 *  lone event could jump from the full session to the minimum span. */
export const TIMELINE_ZOOM_MAX_STEP_FACTOR = 4;

/** Structural shape so a plain object and a React WheelEvent both satisfy it —
 *  same convention as TimelineScrollWheelLike. deltaMode is optional;
 *  undefined means pixels. */
export interface TimelineZoomWheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface TimelineZoomGestureContext {
  /** The whole loaded/recording timeline, from timelineOverviewDurationSecs (#1282). */
  durationSecs: number;
  /** Anchor for the zoom — the playhead when it is inside the current range. */
  playheadSecs: number;
}

/** The vertical pixel delta of a zoom gesture, or null when the wheel is not
 *  one: unmodified (that is the #1292 pan) or vertical-zero. The exact
 *  complement of timelineScrollDeltaPx, and the same ctrl/meta rule
 *  timelineFollowEventForWheel (#1286) treats as 'manual-zoom', so pan, zoom
 *  and follow-pause can never disagree about a wheel. A macOS trackpad pinch
 *  arrives here because Chromium delivers it as a ctrl-modified wheel. */
export function timelineZoomDeltaPx(wheel: TimelineZoomWheelLike): number | null {
  if (!Number.isFinite(wheel.deltaX) || !Number.isFinite(wheel.deltaY)) return null;
  if (!wheel.ctrlKey && !wheel.metaKey) return null;
  if (wheel.deltaY === 0) return null;
  const factor = wheel.deltaMode === 1 ? TIMELINE_SCROLL_LINE_PX : wheel.deltaMode === 2 ? TIMELINE_SCROLL_PAGE_PX : 1;
  return wheel.deltaY * factor;
}

/** A pixel delta as a multiplicative span factor, bounded to one step per
 *  event. Positive deltaY (ctrl-scroll down / pinch in) widens the span — zooms
 *  OUT — matching every browser and DAW. */
export function timelineZoomSpanFactor(deltaPx: number): number {
  if (!Number.isFinite(deltaPx)) return 1;
  const factor = Math.exp(deltaPx * TIMELINE_ZOOM_WHEEL_RATE);
  return Math.min(TIMELINE_ZOOM_MAX_STEP_FACTOR, Math.max(1 / TIMELINE_ZOOM_MAX_STEP_FACTOR, factor));
}

/** Applies a zoom gesture to a visible range: scales the span by the gesture's
 *  factor around the shared playhead-or-centre anchor and resolves the result
 *  through the shared clamp. Returns the caller's own range reference — never
 *  an equal-but-new object — when the gesture is not a zoom or the candidate
 *  clamps back to exactly where it started, so React can bail out of a
 *  re-render at a bound. */
export function applyTimelineZoomGesture(
  range: TimelineVisibleRange,
  wheel: TimelineZoomWheelLike,
  ctx: TimelineZoomGestureContext,
): TimelineVisibleRange {
  const deltaPx = timelineZoomDeltaPx(wheel);
  if (deltaPx === null) return range;
  const fullSecs = timelineFullDurationSecs(ctx.durationSecs);
  const cur = clampVisibleRange(range, fullSecs);
  const nextSpan = visibleRangeSpanSecs(cur) * timelineZoomSpanFactor(deltaPx);
  const next = visibleRangeOfSpan(visibleRangeAnchorSecs(cur, ctx.playheadSecs), nextSpan, fullSecs);
  // Exact-value comparison, not epsilon: `next` is the shared model's own clamp
  // output, and at a bound the clamp returns the stored bound value itself —
  // the same rationale applyTimelineScroll and createTimelineVisibleRangeModel's
  // commit document. This compares a stored number to itself, not two
  // independently-derived computations (the float rule targets the latter).
  return next.startSecs === range.startSecs && next.endSecs === range.endSecs ? range : next;
}
