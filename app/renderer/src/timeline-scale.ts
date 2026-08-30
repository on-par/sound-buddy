// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The shared horizontal scale model for the Session arrangement view (#1262, epic
// #1254). It extends ADR-0086's one-origin/one-scale geometry with zoom states
// without redefining either number — DAW_TIMELINE_PX_PER_SECOND and
// DAW_TIMELINE_ORIGIN_PX are imported from ./daw-shell-runtime. It is pure (no
// DOM, no store, no React), and no call site consumes it yet — converting the
// existing dawTimelineX callers is the follow-up slice of #1254.

import { DAW_TIMELINE_ORIGIN_PX, DAW_TIMELINE_PX_PER_SECOND } from './daw-shell-runtime';

/** How far one zoom state steps away from the default scale, as a multiplier.
 *  Zoomed-in is the default times this; zoomed-out is the default divided by it —
 *  the two are also the clamp bounds (ADR: zoom states ARE the bounds). */
export const TIMELINE_ZOOM_STEP = 4;
export const TIMELINE_SCALE_MIN_PX_PER_SECOND = DAW_TIMELINE_PX_PER_SECOND / TIMELINE_ZOOM_STEP; // 2 — the zoomed-out scale
export const TIMELINE_SCALE_MAX_PX_PER_SECOND = DAW_TIMELINE_PX_PER_SECOND * TIMELINE_ZOOM_STEP; // 32 — the zoomed-in scale

/** The four supported arrangement zoom states (#1262). 'default' is today's fixed
 *  geometry; 'fit' is computed from a viewport width and a session duration. */
export type TimelineZoomState = 'fit' | 'default' | 'zoomed-in' | 'zoomed-out';

/** The runtime inputs the 'fit' state needs: how much arrangement time must be shown
 *  and how many pixels of timeline column are available to show it in. */
export interface TimelineFitRequest {
  durationSecs: number;
  viewportWidthPx: number;
}

/** A resolved horizontal scale for the arrangement view: the state it came from, its
 *  clamped pixels-per-second, and the time-to-x conversion every time-positioned
 *  surface should use at that scale. */
export interface TimelineScale {
  readonly state: TimelineZoomState;
  readonly pxPerSecond: number;
  timeToX(timeSecs: number): number;
}

/** Clamps a requested pixels-per-second value into the supported zoom range. A
 *  request outside the range resolves to the nearest supported bound; a
 *  non-finite request falls back to the default scale rather than propagating
 *  NaN into a coordinate. */
export function clampTimelineScale(pxPerSecond: number): number {
  if (!Number.isFinite(pxPerSecond)) return DAW_TIMELINE_PX_PER_SECOND;
  return Math.min(TIMELINE_SCALE_MAX_PX_PER_SECOND, Math.max(TIMELINE_SCALE_MIN_PX_PER_SECOND, pxPerSecond));
}

function fitScale(fit: TimelineFitRequest | undefined): number {
  if (!fit) return DAW_TIMELINE_PX_PER_SECOND;
  const { durationSecs, viewportWidthPx } = fit;
  if (!Number.isFinite(durationSecs) || durationSecs <= 0) return DAW_TIMELINE_PX_PER_SECOND;
  if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return DAW_TIMELINE_PX_PER_SECOND;
  return viewportWidthPx / durationSecs;
}

const SCALE_RESOLVERS: Record<TimelineZoomState, (fit?: TimelineFitRequest) => number> = {
  fit: (fit) => fitScale(fit),
  default: () => DAW_TIMELINE_PX_PER_SECOND,
  'zoomed-in': () => TIMELINE_SCALE_MAX_PX_PER_SECOND,
  'zoomed-out': () => TIMELINE_SCALE_MIN_PX_PER_SECOND,
};

/** Resolves a zoom state (plus an optional fit request) into a clamped
 *  pixels-per-second value. Every state — including 'fit' — passes through
 *  clampTimelineScale, so a resolved value outside the bounds is impossible. */
export function timelineScaleValue(state: TimelineZoomState, fit?: TimelineFitRequest): number {
  return clampTimelineScale(SCALE_RESOLVERS[state](fit));
}

/** Converts a time in seconds to an x coordinate at the given scale: the shared
 *  t=0 origin plus timeSecs * pxPerSecond, the same origin dawTimelineX uses. It
 *  is unclamped in time — negative seconds legitimately return coordinates left
 *  of the shared origin, exactly like dawTimelineX — and a non-finite timeSecs
 *  resolves to the origin instead of producing NaN. At
 *  DAW_TIMELINE_PX_PER_SECOND it is identical to dawTimelineX. */
export function timelineXAt(pxPerSecond: number, timeSecs: number): number {
  if (!Number.isFinite(timeSecs)) return DAW_TIMELINE_ORIGIN_PX;
  return DAW_TIMELINE_ORIGIN_PX + timeSecs * pxPerSecond;
}

/** Resolves a zoom state into a frozen TimelineScale carrying its pxPerSecond and
 *  a timeToX conversion closed over that value. */
export function createTimelineScale(state: TimelineZoomState, fit?: TimelineFitRequest): TimelineScale {
  const pxPerSecond = timelineScaleValue(state, fit);
  return Object.freeze({
    state,
    pxPerSecond,
    timeToX: (timeSecs: number) => timelineXAt(pxPerSecond, timeSecs),
  });
}
