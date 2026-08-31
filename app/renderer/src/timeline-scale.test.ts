// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { DAW_TIMELINE_ORIGIN_PX, DAW_TIMELINE_PX_PER_SECOND, dawTimelineX } from './daw-shell-runtime';
import {
  TIMELINE_SCALE_MIN_PX_PER_SECOND,
  TIMELINE_SCALE_MAX_PX_PER_SECOND,
  clampTimelineScale,
  timelineScaleValue,
  timelineXAt,
  timelineTimeAt,
  timelineSpanSecsAt,
  timelineSpanPxAt,
  createTimelineScale,
  createTimelineScaleFromPxPerSecond,
  sessionTimelineScalePxPerSecond,
  type TimelineZoomState,
} from './timeline-scale';

describe('clampTimelineScale', () => {
  it('returns the request unchanged for a value inside the range', () => {
    expect(clampTimelineScale(10)).toBe(10);
  });

  it('clamps a request above the zoomed-in bound to the max', () => {
    expect(clampTimelineScale(1000)).toBe(TIMELINE_SCALE_MAX_PX_PER_SECOND);
  });

  it('clamps a request below the zoomed-out bound to the min', () => {
    expect(clampTimelineScale(0.5)).toBe(TIMELINE_SCALE_MIN_PX_PER_SECOND);
  });

  it('clamps 0 to the zoomed-out bound', () => {
    expect(clampTimelineScale(0)).toBe(TIMELINE_SCALE_MIN_PX_PER_SECOND);
  });

  it('clamps a negative request to the zoomed-out bound', () => {
    expect(clampTimelineScale(-5)).toBe(TIMELINE_SCALE_MIN_PX_PER_SECOND);
  });

  it('returns the default for NaN', () => {
    expect(clampTimelineScale(NaN)).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });

  it('returns the default for Infinity', () => {
    expect(clampTimelineScale(Number.POSITIVE_INFINITY)).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });

  it('the bounds are exactly the zoomed-out/zoomed-in state values', () => {
    expect(timelineScaleValue('zoomed-out')).toBe(TIMELINE_SCALE_MIN_PX_PER_SECOND);
    expect(timelineScaleValue('zoomed-in')).toBe(TIMELINE_SCALE_MAX_PX_PER_SECOND);
  });
});

describe('timelineScaleValue', () => {
  it("'default' returns exactly DAW_TIMELINE_PX_PER_SECOND", () => {
    expect(timelineScaleValue('default')).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });

  it("'zoomed-in' returns the max bound and 'zoomed-out' returns the min bound", () => {
    expect(timelineScaleValue('zoomed-in')).toBe(TIMELINE_SCALE_MAX_PX_PER_SECOND);
    expect(timelineScaleValue('zoomed-out')).toBe(TIMELINE_SCALE_MIN_PX_PER_SECOND);
  });

  it("'fit' resolves to viewportWidthPx / durationSecs", () => {
    expect(timelineScaleValue('fit', { durationSecs: 100, viewportWidthPx: 1000 })).toBeCloseTo(10);
  });

  it('all four states are distinct and finite', () => {
    const states: TimelineZoomState[] = ['fit', 'default', 'zoomed-in', 'zoomed-out'];
    const values = states.map((state) =>
      timelineScaleValue(state, { durationSecs: 100, viewportWidthPx: 1000 })
    );
    expect(new Set(values).size).toBe(4);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it('all four states sit inside the clamp bounds', () => {
    const states: TimelineZoomState[] = ['fit', 'default', 'zoomed-in', 'zoomed-out'];
    for (const state of states) {
      const value = timelineScaleValue(state, { durationSecs: 100, viewportWidthPx: 1000 });
      expect(value).toBeGreaterThanOrEqual(TIMELINE_SCALE_MIN_PX_PER_SECOND);
      expect(value).toBeLessThanOrEqual(TIMELINE_SCALE_MAX_PX_PER_SECOND);
    }
  });

  it("'fit' clamps up to the zoomed-in bound", () => {
    expect(timelineScaleValue('fit', { durationSecs: 1, viewportWidthPx: 4000 })).toBe(
      TIMELINE_SCALE_MAX_PX_PER_SECOND
    );
  });

  it("'fit' clamps down to the zoomed-out bound", () => {
    expect(timelineScaleValue('fit', { durationSecs: 100_000, viewportWidthPx: 100 })).toBe(
      TIMELINE_SCALE_MIN_PX_PER_SECOND
    );
  });

  it("'fit' falls back to the default when the request is absent", () => {
    expect(timelineScaleValue('fit')).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });

  it("'fit' falls back to the default when durationSecs is 0", () => {
    expect(timelineScaleValue('fit', { durationSecs: 0, viewportWidthPx: 1000 })).toBe(
      DAW_TIMELINE_PX_PER_SECOND
    );
  });

  it("'fit' falls back to the default when durationSecs is negative", () => {
    expect(timelineScaleValue('fit', { durationSecs: -10, viewportWidthPx: 1000 })).toBe(
      DAW_TIMELINE_PX_PER_SECOND
    );
  });

  it("'fit' falls back to the default when durationSecs is NaN", () => {
    expect(timelineScaleValue('fit', { durationSecs: NaN, viewportWidthPx: 1000 })).toBe(
      DAW_TIMELINE_PX_PER_SECOND
    );
  });

  it("'fit' falls back to the default when viewportWidthPx is 0", () => {
    expect(timelineScaleValue('fit', { durationSecs: 100, viewportWidthPx: 0 })).toBe(
      DAW_TIMELINE_PX_PER_SECOND
    );
  });

  it("'fit' falls back to the default when viewportWidthPx is NaN", () => {
    expect(timelineScaleValue('fit', { durationSecs: 100, viewportWidthPx: NaN })).toBe(
      DAW_TIMELINE_PX_PER_SECOND
    );
  });
});

describe('timelineXAt / TimelineScale.timeToX', () => {
  it('at the default scale it equals the existing fixed geometry', () => {
    for (const t of [0, 1, 2.5, 12.5, 60]) {
      expect(timelineXAt(DAW_TIMELINE_PX_PER_SECOND, t)).toBe(dawTimelineX(t));
    }
  });

  it('t=0 is scale-invariant across all four states', () => {
    const states: TimelineZoomState[] = ['fit', 'default', 'zoomed-in', 'zoomed-out'];
    for (const state of states) {
      const scale = createTimelineScale(state, { durationSecs: 100, viewportWidthPx: 1000 });
      expect(scale.timeToX(0)).toBe(DAW_TIMELINE_ORIGIN_PX);
    }
  });

  it('advances by exactly pxPerSecond per second at each state', () => {
    const states: TimelineZoomState[] = ['fit', 'default', 'zoomed-in', 'zoomed-out'];
    for (const state of states) {
      const scale = createTimelineScale(state, { durationSecs: 100, viewportWidthPx: 1000 });
      expect(scale.timeToX(3) - scale.timeToX(2)).toBeCloseTo(scale.pxPerSecond);
    }
  });

  it('is unclamped in time — negative seconds go left of the origin', () => {
    expect(timelineXAt(DAW_TIMELINE_PX_PER_SECOND, -1)).toBe(
      DAW_TIMELINE_ORIGIN_PX - DAW_TIMELINE_PX_PER_SECOND
    );
  });

  it('a non-finite time resolves to the origin', () => {
    expect(timelineXAt(8, NaN)).toBe(DAW_TIMELINE_ORIGIN_PX);
    expect(timelineXAt(8, Number.POSITIVE_INFINITY)).toBe(DAW_TIMELINE_ORIGIN_PX);
  });
});

describe('timelineTimeAt / TimelineScale.xToTime', () => {
  it('at the shared origin resolves to exactly 0', () => {
    expect(timelineTimeAt(DAW_TIMELINE_PX_PER_SECOND, DAW_TIMELINE_ORIGIN_PX)).toBe(0);
  });

  it('is the exact inverse of timelineXAt at the default scale', () => {
    expect(timelineTimeAt(DAW_TIMELINE_PX_PER_SECOND, DAW_TIMELINE_ORIGIN_PX + 32)).toBe(4);
  });

  it('is unclamped in time — an x left of the origin returns negative seconds', () => {
    expect(timelineTimeAt(8, DAW_TIMELINE_ORIGIN_PX - 8)).toBe(-1);
  });

  it('a non-finite x resolves to 0', () => {
    expect(timelineTimeAt(DAW_TIMELINE_PX_PER_SECOND, NaN)).toBe(0);
    expect(timelineTimeAt(DAW_TIMELINE_PX_PER_SECOND, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('a non-finite scale resolves to 0', () => {
    expect(timelineTimeAt(NaN, 300)).toBe(0);
  });

  it('a non-positive scale resolves to 0', () => {
    expect(timelineTimeAt(0, 300)).toBe(0);
    expect(timelineTimeAt(-8, 300)).toBe(0);
  });

  it('round-trips through timeToX at every zoom state', () => {
    const states: TimelineZoomState[] = ['fit', 'default', 'zoomed-in', 'zoomed-out'];
    for (const state of states) {
      const scale = createTimelineScale(state, { durationSecs: 100, viewportWidthPx: 1000 });
      for (const t of [0, 1, 2.5, 12.5, 60]) {
        expect(scale.xToTime(scale.timeToX(t))).toBeCloseTo(t, 10);
      }
    }
  });

  it('round-trips x-first at the default scale', () => {
    const scale = createTimelineScale('default');
    for (const x of [208, 240, 288]) {
      expect(scale.timeToX(scale.xToTime(x))).toBeCloseTo(x, 10);
    }
  });

  it("createTimelineScale('default') exposes xToTime as a function on a frozen object", () => {
    const scale = createTimelineScale('default');
    expect(Object.isFrozen(scale)).toBe(true);
    expect(typeof scale.xToTime).toBe('function');
  });
});

describe('timelineSpanSecsAt / timelineSpanPxAt (#1292)', () => {
  it('round-trip a span through both directions', () => {
    expect(timelineSpanSecsAt(8, timelineSpanPxAt(8, 12.5))).toBeCloseTo(12.5);
  });

  it('are origin-free — a span of 0 px is 0 s, unlike timelineTimeAt at x=0', () => {
    expect(timelineSpanSecsAt(8, 0)).toBe(0);
    expect(timelineTimeAt(8, 0)).not.toBe(0);
  });

  it('timelineSpanSecsAt: a non-finite span resolves to 0', () => {
    expect(timelineSpanSecsAt(8, NaN)).toBe(0);
    expect(timelineSpanSecsAt(8, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('timelineSpanSecsAt: a non-finite scale resolves to 0', () => {
    expect(timelineSpanSecsAt(NaN, 80)).toBe(0);
  });

  it('timelineSpanSecsAt: a zero/negative scale resolves to 0', () => {
    expect(timelineSpanSecsAt(0, 80)).toBe(0);
    expect(timelineSpanSecsAt(-8, 80)).toBe(0);
  });

  it('timelineSpanPxAt: a non-finite span resolves to 0', () => {
    expect(timelineSpanPxAt(8, NaN)).toBe(0);
    expect(timelineSpanPxAt(8, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('timelineSpanPxAt: a non-finite scale resolves to 0', () => {
    expect(timelineSpanPxAt(NaN, 10)).toBe(0);
  });

  it('timelineSpanPxAt: a zero/negative scale resolves to 0', () => {
    expect(timelineSpanPxAt(0, 10)).toBe(0);
    expect(timelineSpanPxAt(-8, 10)).toBe(0);
  });
});

describe('createTimelineScale', () => {
  it('carries the requested state and the resolved pxPerSecond', () => {
    const scale = createTimelineScale('zoomed-in');
    expect(scale.state).toBe('zoomed-in');
    expect(scale.pxPerSecond).toBe(TIMELINE_SCALE_MAX_PX_PER_SECOND);
  });

  it("'default' has no shipped behavior change vs dawTimelineX", () => {
    const scale = createTimelineScale('default');
    for (const t of [0, 1, 2.5, 12.5, 60]) {
      expect(scale.timeToX(t)).toBe(dawTimelineX(t));
    }
  });

  it("'fit' resolves pxPerSecond and timeToX from the fit request", () => {
    const scale = createTimelineScale('fit', { durationSecs: 100, viewportWidthPx: 1000 });
    expect(scale.pxPerSecond).toBeCloseTo(10);
    expect(scale.timeToX(10)).toBeCloseTo(DAW_TIMELINE_ORIGIN_PX + 100);
  });

  it('the returned object is frozen', () => {
    const scale = createTimelineScale('default');
    expect(Object.isFrozen(scale)).toBe(true);
  });
});

describe('createTimelineScaleFromPxPerSecond (#1342)', () => {
  it('carries the requested pixels-per-second and a matching timeToX', () => {
    const scale = createTimelineScaleFromPxPerSecond(16);
    expect(scale.pxPerSecond).toBe(16);
    expect(scale.timeToX(10)).toBe(timelineXAt(16, 10));
    expect(scale.xToTime(scale.timeToX(10))).toBeCloseTo(10);
  });

  it('reports the default state only when the resolved scale is the base geometry', () => {
    expect(createTimelineScaleFromPxPerSecond(DAW_TIMELINE_PX_PER_SECOND).state).toBe('default');
    expect(createTimelineScaleFromPxPerSecond(16).state).not.toBe('default');
  });

  it('clamps an over-range request into the supported bounds', () => {
    expect(createTimelineScaleFromPxPerSecond(1000).pxPerSecond).toBe(TIMELINE_SCALE_MAX_PX_PER_SECOND);
    expect(createTimelineScaleFromPxPerSecond(0.1).pxPerSecond).toBe(TIMELINE_SCALE_MIN_PX_PER_SECOND);
  });

  it('falls back to the default scale for a non-finite request', () => {
    expect(createTimelineScaleFromPxPerSecond(Number.NaN).pxPerSecond).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(createTimelineScaleFromPxPerSecond(16))).toBe(true);
  });
});

describe('sessionTimelineScalePxPerSecond (#1342)', () => {
  it('is exactly the base scale when the visible span is the full duration (default/fit)', () => {
    expect(sessionTimelineScalePxPerSecond(60, 60)).toBe(DAW_TIMELINE_PX_PER_SECOND);
    expect(sessionTimelineScalePxPerSecond(300, 300)).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });

  it('magnifies by how many times narrower than full the span is', () => {
    expect(sessionTimelineScalePxPerSecond(30, 60)).toBe(DAW_TIMELINE_PX_PER_SECOND * 2); // 16
    expect(sessionTimelineScalePxPerSecond(15, 60)).toBe(DAW_TIMELINE_PX_PER_SECOND * 4); // 32
  });

  it('clamps the magnified scale to the zoomed-in bound', () => {
    // 8 * (60 / 1) = 480, clamped to the max.
    expect(sessionTimelineScalePxPerSecond(1, 60)).toBe(TIMELINE_SCALE_MAX_PX_PER_SECOND);
  });

  it('never resolves below the base scale (the visible span is never wider than the full duration)', () => {
    expect(sessionTimelineScalePxPerSecond(60, 60)).toBeGreaterThanOrEqual(DAW_TIMELINE_PX_PER_SECOND);
  });

  it('resolves a non-finite or non-positive span or duration to the base scale', () => {
    expect(sessionTimelineScalePxPerSecond(0, 60)).toBe(DAW_TIMELINE_PX_PER_SECOND);
    expect(sessionTimelineScalePxPerSecond(Number.NaN, 60)).toBe(DAW_TIMELINE_PX_PER_SECOND);
    expect(sessionTimelineScalePxPerSecond(30, 0)).toBe(DAW_TIMELINE_PX_PER_SECOND);
    expect(sessionTimelineScalePxPerSecond(30, Number.NaN)).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });
});
