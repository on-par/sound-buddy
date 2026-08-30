// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { TIMELINE_MIN_VISIBLE_SPAN_SECS } from './timeline-visible-range';
import { TIMELINE_SCROLL_LINE_PX, TIMELINE_SCROLL_PAGE_PX } from './timeline-scroll-gesture';
import {
  TIMELINE_ZOOM_WHEEL_RATE,
  TIMELINE_ZOOM_MAX_STEP_FACTOR,
  timelineZoomDeltaPx,
  timelineZoomSpanFactor,
  applyTimelineZoomGesture,
  type TimelineZoomWheelLike,
} from './timeline-zoom-gesture';

function wheel(overrides: Partial<TimelineZoomWheelLike>): TimelineZoomWheelLike {
  return { deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, ...overrides };
}

describe('timeline zoom gesture (#1291)', () => {
  describe('timelineZoomDeltaPx', () => {
    it('ctrl-modified deltaY (pixels) passes through', () => {
      expect(timelineZoomDeltaPx(wheel({ deltaY: 100, ctrlKey: true }))).toBe(100);
    });

    it('meta-modified deltaY passes through (both modifiers accepted)', () => {
      expect(timelineZoomDeltaPx(wheel({ deltaY: -50, metaKey: true }))).toBe(-50);
    });

    it('deltaMode 1 (lines) scales by TIMELINE_SCROLL_LINE_PX', () => {
      expect(timelineZoomDeltaPx(wheel({ deltaY: 3, deltaMode: 1, ctrlKey: true }))).toBe(3 * TIMELINE_SCROLL_LINE_PX);
    });

    it('deltaMode 2 (pages) scales by TIMELINE_SCROLL_PAGE_PX', () => {
      expect(timelineZoomDeltaPx(wheel({ deltaY: 2, deltaMode: 2, ctrlKey: true }))).toBe(2 * TIMELINE_SCROLL_PAGE_PX);
    });

    it('returns null when no modifier is held (the #1292 pan path)', () => {
      expect(timelineZoomDeltaPx(wheel({ deltaY: 100 }))).toBeNull();
    });

    it('returns null for a zero deltaY even when ctrl-modified', () => {
      expect(timelineZoomDeltaPx(wheel({ deltaY: 0, ctrlKey: true }))).toBeNull();
    });

    it('returns null for a non-finite deltaY', () => {
      expect(timelineZoomDeltaPx(wheel({ deltaY: NaN, ctrlKey: true }))).toBeNull();
    });

    it('returns null for a non-finite deltaX', () => {
      expect(timelineZoomDeltaPx(wheel({ deltaX: Infinity, deltaY: 10, ctrlKey: true }))).toBeNull();
    });
  });

  describe('timelineZoomSpanFactor', () => {
    it('a zero delta returns 1 (no change)', () => {
      expect(timelineZoomSpanFactor(0)).toBe(1);
    });

    it('a positive delta widens the span (factor > 1), and the equal-magnitude negative delta is its reciprocal', () => {
      const out = timelineZoomSpanFactor(50);
      const in_ = timelineZoomSpanFactor(-50);
      expect(out).toBeGreaterThan(1);
      expect(out * in_).toBeCloseTo(1);
    });

    it('a huge positive delta clamps to TIMELINE_ZOOM_MAX_STEP_FACTOR', () => {
      expect(timelineZoomSpanFactor(100_000)).toBe(TIMELINE_ZOOM_MAX_STEP_FACTOR);
    });

    it('a huge negative delta clamps to 1 / TIMELINE_ZOOM_MAX_STEP_FACTOR', () => {
      expect(timelineZoomSpanFactor(-100_000)).toBe(1 / TIMELINE_ZOOM_MAX_STEP_FACTOR);
    });

    it('a non-finite delta returns 1', () => {
      expect(timelineZoomSpanFactor(NaN)).toBe(1);
    });
  });

  describe('applyTimelineZoomGesture', () => {
    it('AC1: shrinks the span and stays centred on the playhead', () => {
      const range = { startSecs: 0, endSecs: 300 };
      const next = applyTimelineZoomGesture(range, wheel({ deltaY: -100, ctrlKey: true }), { durationSecs: 300, playheadSecs: 150 });
      expect(next.endSecs - next.startSecs).toBeLessThan(300);
      expect(next.startSecs + next.endSecs).toBeCloseTo(300);
    });

    it('a playhead outside the range centres on the range itself, not the playhead', () => {
      const range = { startSecs: 0, endSecs: 100 };
      const next = applyTimelineZoomGesture(range, wheel({ deltaY: -100, ctrlKey: true }), { durationSecs: 1000, playheadSecs: 900 });
      expect(next.startSecs + next.endSecs).toBeCloseTo(range.startSecs + range.endSecs);
    });

    it('a non-finite playhead falls back to the range centre', () => {
      const range = { startSecs: 0, endSecs: 100 };
      const next = applyTimelineZoomGesture(range, wheel({ deltaY: -100, ctrlKey: true }), { durationSecs: 300, playheadSecs: NaN });
      expect(next.startSecs + next.endSecs).toBeCloseTo(range.startSecs + range.endSecs);
    });

    it('AC2 min bound: a range already at the minimum span returns the same reference', () => {
      // Playhead outside the range so the anchor falls back to the range's own
      // centre — the fixed point that reproduces this exact {start, end} pair.
      const range = { startSecs: 100, endSecs: 100 + TIMELINE_MIN_VISIBLE_SPAN_SECS };
      const next = applyTimelineZoomGesture(range, wheel({ deltaY: -10_000, ctrlKey: true }), { durationSecs: 300, playheadSecs: 1000 });
      expect(next).toBe(range);
      expect(next.endSecs - next.startSecs).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
    });

    it('AC2 max bound: a range already at the full duration returns the same reference', () => {
      const range = { startSecs: 0, endSecs: 300 };
      const next = applyTimelineZoomGesture(range, wheel({ deltaY: 10_000, ctrlKey: true }), { durationSecs: 300, playheadSecs: 150 });
      expect(next).toBe(range);
    });

    it('AC2 max bound: a big zoom-out from mid-range lands exactly on the full duration and never wider', () => {
      const range = { startSecs: 100, endSecs: 200 };
      const next = applyTimelineZoomGesture(range, wheel({ deltaY: 10_000, ctrlKey: true }), { durationSecs: 300, playheadSecs: 150 });
      expect(next).toEqual({ startSecs: 0, endSecs: 300 });
    });

    it('a non-zoom wheel (no modifier) returns the caller\'s own reference untouched', () => {
      const range = { startSecs: 10, endSecs: 30 };
      const next = applyTimelineZoomGesture(range, wheel({ deltaX: 120 }), { durationSecs: 300, playheadSecs: 15 });
      expect(next).toBe(range);
    });

    it('a zero/negative/non-finite durationSecs never produces NaN, and the result stays within bounds', () => {
      for (const durationSecs of [0, -5, NaN]) {
        const range = { startSecs: 0, endSecs: 1 };
        const next = applyTimelineZoomGesture(range, wheel({ deltaY: -100, ctrlKey: true }), { durationSecs, playheadSecs: 0 });
        expect(Number.isFinite(next.startSecs)).toBe(true);
        expect(Number.isFinite(next.endSecs)).toBe(true);
        expect(next.startSecs).toBeGreaterThanOrEqual(0);
        expect(next.endSecs).toBeGreaterThanOrEqual(next.startSecs);
      }
    });

    it('constants are wired the way the ADR describes (exp of rate * pixel delta)', () => {
      expect(TIMELINE_ZOOM_WHEEL_RATE).toBeGreaterThan(0);
      expect(TIMELINE_ZOOM_MAX_STEP_FACTOR).toBeGreaterThan(1);
    });
  });
});
