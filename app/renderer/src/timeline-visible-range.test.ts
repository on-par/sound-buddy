// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  TIMELINE_MIN_VISIBLE_SPAN_SECS,
  timelineFullDurationSecs,
  visibleRangeSpanSecs,
  visibleRangeOfSpan,
  visibleRangeAnchorSecs,
  clampVisibleRange,
  createTimelineVisibleRangeModel,
  type TimelineVisibleRange,
} from './timeline-visible-range';

describe('timelineFullDurationSecs', () => {
  it('returns the duration unchanged for a positive finite input', () => {
    expect(timelineFullDurationSecs(180)).toBe(180);
  });

  it('floors non-positive or non-finite input to the minimum span', () => {
    expect(timelineFullDurationSecs(0)).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
    expect(timelineFullDurationSecs(-5)).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
    expect(timelineFullDurationSecs(Number.NaN)).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
    expect(timelineFullDurationSecs(Number.POSITIVE_INFINITY)).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
  });

  it('is idempotent', () => {
    for (const x of [180, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const once = timelineFullDurationSecs(x);
      expect(timelineFullDurationSecs(once)).toBe(once);
    }
  });
});

describe('visibleRangeSpanSecs', () => {
  it('returns endSecs - startSecs', () => {
    expect(visibleRangeSpanSecs({ startSecs: 10, endSecs: 35 })).toBe(25);
  });
});

describe('visibleRangeOfSpan', () => {
  it('centres the span on centerSecs when it fits in bounds', () => {
    expect(visibleRangeOfSpan(100, 20, 200)).toEqual({ startSecs: 90, endSecs: 110 });
  });

  it('pins the start at 0 when the centred window would run left of t=0', () => {
    expect(visibleRangeOfSpan(2, 20, 200)).toEqual({ startSecs: 0, endSecs: 20 });
  });

  it('pins the end at durationSecs when the centred window would run past the end', () => {
    expect(visibleRangeOfSpan(195, 20, 200)).toEqual({ startSecs: 180, endSecs: 200 });
  });

  it('widens a below-minimum span to TIMELINE_MIN_VISIBLE_SPAN_SECS', () => {
    const range = visibleRangeOfSpan(100, 0.2, 200);
    expect(visibleRangeSpanSecs(range)).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
  });

  it('narrows an over-long span to the full duration', () => {
    expect(visibleRangeOfSpan(100, 500, 200)).toEqual({ startSecs: 0, endSecs: 200 });
  });

  it('resolves a non-finite centerSecs to a window at t=0', () => {
    expect(visibleRangeOfSpan(Number.NaN, 20, 200)).toEqual({ startSecs: 0, endSecs: 20 });
  });

  it('resolves a non-finite spanSecs to the full range', () => {
    expect(visibleRangeOfSpan(100, Number.NaN, 200)).toEqual({ startSecs: 0, endSecs: 200 });
  });
});

describe('visibleRangeAnchorSecs (#1291)', () => {
  it('returns the playhead when it is inside the range', () => {
    expect(visibleRangeAnchorSecs({ startSecs: 0, endSecs: 300 }, 150)).toBe(150);
  });

  it('returns the range centre when the playhead is below startSecs', () => {
    expect(visibleRangeAnchorSecs({ startSecs: 100, endSecs: 200 }, 10)).toBe(150);
  });

  it('returns the range centre when the playhead is above endSecs', () => {
    expect(visibleRangeAnchorSecs({ startSecs: 0, endSecs: 100 }, 900)).toBe(50);
  });

  it('returns the range centre for a non-finite playhead', () => {
    expect(visibleRangeAnchorSecs({ startSecs: 0, endSecs: 100 }, Number.NaN)).toBe(50);
  });
});

describe('clampVisibleRange', () => {
  it('passes an in-bounds range through unchanged', () => {
    expect(clampVisibleRange({ startSecs: 10, endSecs: 40 }, 200)).toEqual({ startSecs: 10, endSecs: 40 });
  });

  it('pins a negative start to 0', () => {
    expect(clampVisibleRange({ startSecs: -50, endSecs: 40 }, 200)).toEqual({ startSecs: 0, endSecs: 40 });
  });

  it('pins an end past the duration to the duration', () => {
    expect(clampVisibleRange({ startSecs: 100, endSecs: 500 }, 200)).toEqual({ startSecs: 100, endSecs: 200 });
  });

  it('widens a sub-minimum span', () => {
    const clamped = clampVisibleRange({ startSecs: 190, endSecs: 190.2 }, 200);
    expect(visibleRangeSpanSecs(clamped)).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
    expect(clamped.endSecs).toBeLessThanOrEqual(200);
  });

  it('returns the full range for null', () => {
    expect(clampVisibleRange(null, 200)).toEqual({ startSecs: 0, endSecs: 200 });
  });

  it('returns the full range for a NaN bound', () => {
    expect(clampVisibleRange({ startSecs: Number.NaN, endSecs: 40 }, 200)).toEqual({ startSecs: 0, endSecs: 200 });
    expect(clampVisibleRange({ startSecs: 10, endSecs: Number.NaN }, 200)).toEqual({ startSecs: 0, endSecs: 200 });
  });

  it('returns the full range for an inverted or zero-width range', () => {
    expect(clampVisibleRange({ startSecs: 40, endSecs: 10 }, 200)).toEqual({ startSecs: 0, endSecs: 200 });
    expect(clampVisibleRange({ startSecs: 40, endSecs: 40 }, 200)).toEqual({ startSecs: 0, endSecs: 200 });
  });

  it('returns a frozen object and does not mutate the input', () => {
    const input: TimelineVisibleRange = { startSecs: -50, endSecs: 40 };
    const frozenCopy = { ...input };
    const clamped = clampVisibleRange(input, 200);
    expect(Object.isFrozen(clamped)).toBe(true);
    expect(input).toEqual(frozenCopy);
  });
});

describe('createTimelineVisibleRangeModel initialization', () => {
  it('starts at the full in-bounds range for a positive finite duration', () => {
    const model = createTimelineVisibleRangeModel(180);
    expect(model.getRange()).toEqual({ startSecs: 0, endSecs: 180 });
  });

  it('starts at the minimum span for 0, negative and NaN durations', () => {
    for (const duration of [0, -5, Number.NaN]) {
      const model = createTimelineVisibleRangeModel(duration);
      expect(model.getRange()).toEqual({ startSecs: 0, endSecs: TIMELINE_MIN_VISIBLE_SPAN_SECS });
    }
  });

  it('getDurationSecs matches timelineFullDurationSecs(input)', () => {
    for (const duration of [180, 0, -5, Number.NaN]) {
      const model = createTimelineVisibleRangeModel(duration);
      expect(model.getDurationSecs()).toBe(timelineFullDurationSecs(duration));
    }
  });

  it('the initial range is always in bounds', () => {
    for (const duration of [180, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const model = createTimelineVisibleRangeModel(duration);
      const range = model.getRange();
      const durationSecs = model.getDurationSecs();
      expect(range.startSecs).toBeGreaterThanOrEqual(0);
      expect(range.endSecs).toBeLessThanOrEqual(durationSecs);
      expect(visibleRangeSpanSecs(range)).toBeGreaterThanOrEqual(TIMELINE_MIN_VISIBLE_SPAN_SECS);
    }
  });
});

describe('createTimelineVisibleRangeModel updates clamp', () => {
  it('setRange clamps an out-of-bounds range to the full duration', () => {
    const model = createTimelineVisibleRangeModel(200);
    const result = model.setRange({ startSecs: -50, endSecs: 500 });
    expect(result).toEqual({ startSecs: 0, endSecs: 200 });
    expect(model.getRange()).toEqual(result);
  });

  it('setRange widens a sub-minimum span and keeps the end in bounds', () => {
    const model = createTimelineVisibleRangeModel(200);
    const result = model.setRange({ startSecs: 190, endSecs: 190.2 });
    expect(visibleRangeSpanSecs(result)).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
    expect(result.endSecs).toBeLessThanOrEqual(200);
    expect(model.getRange()).toEqual(result);
  });

  it('setStartSecs keeps the current span when the move stays in bounds', () => {
    const model = createTimelineVisibleRangeModel(200);
    model.setRange({ startSecs: 0, endSecs: 50 });
    const result = model.setStartSecs(120);
    expect(result).toEqual({ startSecs: 120, endSecs: 170 });
    expect(model.getRange()).toEqual(result);
  });

  it('setStartSecs pins the start at durationSecs - span when the move overshoots the end', () => {
    const model = createTimelineVisibleRangeModel(200);
    model.setRange({ startSecs: 190, endSecs: 190.2 });
    expect(visibleRangeSpanSecs(model.getRange())).toBe(TIMELINE_MIN_VISIBLE_SPAN_SECS);
    const result = model.setStartSecs(1000);
    expect(result).toEqual({ startSecs: 200 - TIMELINE_MIN_VISIBLE_SPAN_SECS, endSecs: 200 });
    expect(model.getRange()).toEqual(result);
  });

  it('setStartSecs pins a negative start to 0', () => {
    const model = createTimelineVisibleRangeModel(200);
    model.setRange({ startSecs: 50, endSecs: 100 });
    const result = model.setStartSecs(-10);
    expect(result).toEqual({ startSecs: 0, endSecs: 40 });
    expect(model.getRange()).toEqual(result);
  });

  it('setStartSecs(NaN) leaves an in-bounds range (the full-range fallback)', () => {
    const model = createTimelineVisibleRangeModel(200);
    model.setRange({ startSecs: 50, endSecs: 100 });
    const result = model.setStartSecs(Number.NaN);
    expect(result.startSecs).toBeGreaterThanOrEqual(0);
    expect(result.endSecs).toBeLessThanOrEqual(200);
    expect(model.getRange()).toEqual(result);
  });

  it('setDurationSecs re-clamps the stored range inside the new duration', () => {
    const model = createTimelineVisibleRangeModel(200);
    model.setRange({ startSecs: 100, endSecs: 150 });
    const result = model.setDurationSecs(30);
    expect(result.startSecs).toBeGreaterThanOrEqual(0);
    expect(result.endSecs).toBeLessThanOrEqual(30);
    expect(model.getRange()).toEqual(result);
    expect(model.getDurationSecs()).toBe(30);
  });
});

describe('single read source (AC3)', () => {
  it('two references to the same model observe identical bounds after an update', () => {
    const model = createTimelineVisibleRangeModel(200);
    const readA = (m: typeof model) => m.getRange();
    const readB = (m: typeof model) => m.getRange();
    model.setRange({ startSecs: 20, endSecs: 60 });
    expect(readA(model)).toEqual(readB(model));
  });

  it('a subscriber receives the same range object the setter returned and getRange reports', () => {
    const model = createTimelineVisibleRangeModel(200);
    let received: TimelineVisibleRange | null = null;
    model.subscribe((range) => { received = range; });
    const result = model.setRange({ startSecs: 20, endSecs: 60 });
    expect(received).toEqual(result);
    expect(received).toEqual(model.getRange());
  });
});

describe('subscription behaviour', () => {
  it('fires on a real change', () => {
    const model = createTimelineVisibleRangeModel(200);
    const calls: TimelineVisibleRange[] = [];
    model.subscribe((range) => calls.push(range));
    model.setRange({ startSecs: 20, endSecs: 60 });
    expect(calls).toEqual([{ startSecs: 20, endSecs: 60 }]);
  });

  it('does not fire when a write produces the already-stored range', () => {
    const model = createTimelineVisibleRangeModel(200);
    model.setRange({ startSecs: 20, endSecs: 60 });
    const calls: TimelineVisibleRange[] = [];
    model.subscribe((range) => calls.push(range));
    model.setRange({ startSecs: 20, endSecs: 60 });
    expect(calls).toEqual([]);
  });

  it('does not fire when a second out-of-bounds write clamps to the same values', () => {
    const model = createTimelineVisibleRangeModel(200);
    model.setRange({ startSecs: -50, endSecs: 500 });
    const calls: TimelineVisibleRange[] = [];
    model.subscribe((range) => calls.push(range));
    model.setRange({ startSecs: -999, endSecs: 999 });
    expect(calls).toEqual([]);
  });

  it('the returned unsubscribe stops further notifications', () => {
    const model = createTimelineVisibleRangeModel(200);
    const calls: TimelineVisibleRange[] = [];
    const unsubscribe = model.subscribe((range) => calls.push(range));
    model.setRange({ startSecs: 20, endSecs: 60 });
    unsubscribe();
    model.setRange({ startSecs: 30, endSecs: 70 });
    expect(calls).toHaveLength(1);
  });

  it('two subscribers both receive the same range', () => {
    const model = createTimelineVisibleRangeModel(200);
    const callsA: TimelineVisibleRange[] = [];
    const callsB: TimelineVisibleRange[] = [];
    model.subscribe((range) => callsA.push(range));
    model.subscribe((range) => callsB.push(range));
    model.setRange({ startSecs: 20, endSecs: 60 });
    expect(callsA).toEqual(callsB);
  });
});
