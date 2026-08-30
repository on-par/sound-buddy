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
  createTimelineScale,
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
