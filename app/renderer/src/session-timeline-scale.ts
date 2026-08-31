// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session arrangement's ONE production paint scale (#1342, epic #1254): the
// single mutable owner of the horizontal pixels-per-second every painted surface
// resolves a time to an x through. Before this story the shell painted from a fixed
// SESSION_TIMELINE_SCALE ('default', 8px/s) and the #1284 toolbar zoom controls only
// panned the visible range; ADR-0111 parked the wiring (#1283) that lets a zoom state
// change the painted scale. This module is that wiring: LiveCapturePanel derives the
// scale from the current visible range once per render and writes it here, and every
// reader — dawShellHTML's ruler/gridline/clip builders (live-workspace-view.ts) and the
// daw-shell-runtime.ts painters via App.tsx's getTimelineScale — reads the same value,
// so the six timeline surfaces stay aligned by construction (they share one scale and
// one --daw-scroll-x re-base, ADR-0086/0090).
//
// This is deliberately NOT the test-only sessionTimelineScaleModel harness in
// timeline-scale-harness.ts (#1294): that harness sets a scale STATE directly for e2e
// and stays out of the paint path (timeline-zoom-state-alignment.spec.ts asserts the
// painted scale does not follow it). The production paint scale is derived from the
// toolbar's visible range instead — see sessionTimelineScaleForRange below.

import {
  createTimelineScale,
  createTimelineScaleFromPxPerSecond,
  sessionTimelineScalePxPerSecond,
  type TimelineScale,
} from './timeline-scale';
import { visibleRangeSpanSecs, type TimelineVisibleRange } from './timeline-visible-range';

// The base scale until the first render sets a range-derived one — provably identical
// to dawTimelineX (ADR-0100), so an un-set reader paints the pre-#1342 geometry.
let currentScale: TimelineScale = createTimelineScale('default');

/** The current production paint scale — read by dawShellHTML's builders and the
 *  daw-shell-runtime painters (via getTimelineScale) so both resolve one time to one x. */
export function getSessionTimelineScale(): TimelineScale {
  return currentScale;
}

/** Sets the current production paint scale. LiveCapturePanel calls this once per render,
 *  before it builds the shell markup, from the range-derived scale below. */
export function setSessionTimelineScale(scale: TimelineScale): void {
  currentScale = scale;
}

/** The paint scale for a visible range out of a full timeline of `fullDurationSecs`
 *  (#1342): the base scale magnified by how many times narrower than full the visible
 *  span is (see sessionTimelineScalePxPerSecond). A full-range view resolves to the base
 *  DAW_TIMELINE_PX_PER_SECOND, so the default/fit view paints identically to pre-#1342. */
export function sessionTimelineScaleForRange(range: TimelineVisibleRange, fullDurationSecs: number): TimelineScale {
  return createTimelineScaleFromPxPerSecond(
    sessionTimelineScalePxPerSecond(visibleRangeSpanSecs(range), fullDurationSecs),
  );
}
