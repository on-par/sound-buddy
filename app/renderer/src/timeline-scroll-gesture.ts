// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Session timeline's horizontal-pan gesture (#1292): a pure sibling of
// timeline-follow-scroll.ts that turns a wheel-like object into a new
// TimelineVisibleRange. It owns no clamp of its own — that is
// timeline-visible-range.ts's clampVisibleRange — and no scale of its own —
// that is timeline-scale.ts's origin-free span helpers. This module is pure:
// no DOM, no store, no React import. It MUST NOT import './daw-shell-runtime',
// './timeline-bpm' (ADR-0104/0107 - no coordinate is computed through the
// tempo model) or any store.

import { clampVisibleRange, visibleRangeSpanSecs, type TimelineVisibleRange } from './timeline-visible-range';
import { timelineSpanPxAt, timelineSpanSecsAt } from './timeline-scale';

/** deltaMode 1 (lines): CSS px per wheel line. */
export const TIMELINE_SCROLL_LINE_PX = 16;
/** deltaMode 2 (pages): CSS px per wheel page — 20 lines, the same ratio browsers
 *  use for a page scroll of a default-height viewport. */
export const TIMELINE_SCROLL_PAGE_PX = TIMELINE_SCROLL_LINE_PX * 20;
/** The one custom property the visible range's scroll offset is written to. The
 *  shared re-basing translate in app.css reads it — see this story's ADR. */
export const TIMELINE_SCROLL_OFFSET_VAR = '--daw-scroll-x';

/** Structural shape so a plain object and a React WheelEvent both satisfy it —
 *  same convention as TimelineFollowWheelLike. deltaMode is optional so a test
 *  fixture (and a plain object) may omit it; undefined means pixels. */
export interface TimelineScrollWheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface TimelineScrollContext {
  /** The shared scale's pixels-per-second (SESSION_TIMELINE_SCALE.pxPerSecond). */
  pxPerSecond: number;
  /** The whole loaded/recording timeline, from timelineOverviewDurationSecs (#1282). */
  durationSecs: number;
}

/** Structural shape so a plain object satisfies the patcher in tests — same
 *  convention as TimelineOverviewShellLike. */
export interface TimelineScrollShellLike {
  style: { setProperty(name: string, value: string): void };
}

/** The horizontal pixel delta of a wheel gesture, or null when the gesture is
 *  not a horizontal pan: ctrl/meta-modified (the #1291 zoom gesture) or
 *  vertical-only (deltaX === 0) — the same rule timelineFollowEventForWheel
 *  (#1286) uses to pause follow, so panning and follow-pause can never disagree
 *  about what a scroll gesture is. */
export function timelineScrollDeltaPx(wheel: TimelineScrollWheelLike): number | null {
  if (!Number.isFinite(wheel.deltaX) || !Number.isFinite(wheel.deltaY)) return null;
  if (wheel.ctrlKey || wheel.metaKey) return null;
  if (wheel.deltaX === 0) return null;
  const factor = wheel.deltaMode === 1 ? TIMELINE_SCROLL_LINE_PX : wheel.deltaMode === 2 ? TIMELINE_SCROLL_PAGE_PX : 1;
  return wheel.deltaX * factor;
}

/** Applies a wheel gesture to a visible range: converts its pixel delta to
 *  seconds through the shared scale, then clamps through the shared model.
 *  Returns the caller's own range reference — never an equal-but-new object —
 *  when the gesture is not a pan or the candidate range clamps back to exactly
 *  where it started, so React can bail out of a re-render at a bound. */
export function applyTimelineScroll(range: TimelineVisibleRange, wheel: TimelineScrollWheelLike, ctx: TimelineScrollContext): TimelineVisibleRange {
  const deltaPx = timelineScrollDeltaPx(wheel);
  if (deltaPx === null) return range;
  const startSecs = range.startSecs + timelineSpanSecsAt(ctx.pxPerSecond, deltaPx);
  const next = clampVisibleRange({ startSecs, endSecs: startSecs + visibleRangeSpanSecs(range) }, ctx.durationSecs);
  // Exact-value comparison, not epsilon: `next` is the shared model's own clamp
  // output, and at a bound the clamp returns the stored bound value itself, not
  // an independently derived one (the same rationale createTimelineVisibleRangeModel's
  // commit documents) — this compares a stored number to itself, not two
  // independently-derived computations (the float rule targets the latter).
  return next.startSecs === range.startSecs && next.endSecs === range.endSecs ? range : next;
}

/** The visible range's startSecs resolved to a scroll offset in pixels through
 *  the shared scale. Never negative; a non-finite start resolves to 0 via the
 *  scale helper. */
export function timelineScrollOffsetPx(range: TimelineVisibleRange, pxPerSecond: number): number {
  return Math.max(0, timelineSpanPxAt(pxPerSecond, range.startSecs));
}

/** Writes the resolved offset to the one custom property app.css's shared
 *  re-basing translate reads. A null shell (not yet mounted) is a silent
 *  no-op; a non-finite offset writes 0px rather than an invalid calc(). */
export function patchTimelineScrollOffset(shell: TimelineScrollShellLike | null, offsetPx: number): void {
  if (!shell) return;
  const px = Number.isFinite(offsetPx) ? Math.max(0, offsetPx) : 0;
  shell.style.setProperty(TIMELINE_SCROLL_OFFSET_VAR, `${px}px`);
}
