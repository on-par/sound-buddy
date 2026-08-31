// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  applyLaneBackgroundClick,
  laneBackgroundInsertMarkerSecs,
  laneClipHitAt,
  LANE_TAKE_CLIP_CLASS,
  LANE_TAKE_CLIP_SELECTOR,
  type LaneBackgroundClickInput,
  type LaneClickRect,
} from './lane-background-click';
import { createTimelineMarksModel } from './timeline-state';

function input(overrides: Partial<LaneBackgroundClickInput> = {}): LaneBackgroundClickInput {
  return {
    button: 0,
    clientX: 500,
    laneLeftPx: 100,
    scrollOffsetPx: 0,
    pxPerSecond: 8,
    clipRects: [],
    ...overrides,
  };
}

describe('LANE_TAKE_CLIP_SELECTOR', () => {
  it('is the dotted form of LANE_TAKE_CLIP_CLASS', () => {
    expect(LANE_TAKE_CLIP_SELECTOR).toBe(`.${LANE_TAKE_CLIP_CLASS}`);
  });
});

describe('laneClipHitAt', () => {
  it('returns true for a clientX inside a rect', () => {
    expect(laneClipHitAt(500, [{ left: 480, right: 560 }])).toBe(true);
  });

  it('returns true at the exact left edge (inclusive)', () => {
    expect(laneClipHitAt(480, [{ left: 480, right: 560 }])).toBe(true);
  });

  it('returns false at the exact right edge (half-open interval)', () => {
    expect(laneClipHitAt(560, [{ left: 480, right: 560 }])).toBe(false);
  });

  it('returns false for a clientX outside every rect', () => {
    expect(laneClipHitAt(700, [{ left: 480, right: 560 }])).toBe(false);
  });

  it('returns false when the only rect is degenerate (right <= left)', () => {
    expect(laneClipHitAt(480, [{ left: 480, right: 480 }])).toBe(false);
    expect(laneClipHitAt(480, [{ left: 500, right: 480 }])).toBe(false);
  });

  it('returns false when the only rect has a non-finite edge', () => {
    expect(laneClipHitAt(480, [{ left: Number.NaN, right: 560 }])).toBe(false);
    expect(laneClipHitAt(480, [{ left: 480, right: Number.POSITIVE_INFINITY }])).toBe(false);
  });

  it('with several rects, returns true only for a clientX inside one of them', () => {
    const rects: LaneClickRect[] = [
      { left: 100, right: 200 },
      { left: 480, right: 560 },
    ];
    expect(laneClipHitAt(150, rects)).toBe(true);
    expect(laneClipHitAt(500, rects)).toBe(true);
    expect(laneClipHitAt(300, rects)).toBe(false);
  });

  it('returns false for a non-finite clientX', () => {
    expect(laneClipHitAt(Number.NaN, [{ left: 480, right: 560 }])).toBe(false);
  });
});

describe('laneBackgroundInsertMarkerSecs', () => {
  it('resolves a background press to seconds from the lane t=0 edge', () => {
    expect(laneBackgroundInsertMarkerSecs(input())).toBeCloseTo(50);
  });

  it('adds the scroll offset', () => {
    expect(laneBackgroundInsertMarkerSecs(input({ scrollOffsetPx: 400 }))).toBeCloseTo(100);
  });

  it('clamps a press left of the lane t=0 edge to 0, never negative', () => {
    expect(laneBackgroundInsertMarkerSecs(input({ clientX: 40, laneLeftPx: 100 }))).toBe(0);
  });

  it('returns null for a non-primary button press', () => {
    expect(laneBackgroundInsertMarkerSecs(input({ button: 2 }))).toBeNull();
    expect(laneBackgroundInsertMarkerSecs(input({ button: 1 }))).toBeNull();
  });

  it('returns null when the press hits a take-clip rect', () => {
    expect(laneBackgroundInsertMarkerSecs(input({ clipRects: [{ left: 480, right: 560 }] }))).toBeNull();
  });

  it('returns null for a non-finite clientX', () => {
    expect(laneBackgroundInsertMarkerSecs(input({ clientX: Number.NaN }))).toBeNull();
  });

  it('returns null for a non-finite laneLeftPx', () => {
    expect(laneBackgroundInsertMarkerSecs(input({ laneLeftPx: Number.NaN }))).toBeNull();
  });

  it('treats a non-finite scrollOffsetPx as 0 rather than producing NaN', () => {
    expect(laneBackgroundInsertMarkerSecs(input({ scrollOffsetPx: Number.NaN }))).toBeCloseTo(50);
  });

  it('resolves a non-finite, zero or negative pxPerSecond to 0, not NaN', () => {
    expect(laneBackgroundInsertMarkerSecs(input({ pxPerSecond: Number.NaN }))).toBe(0);
    expect(laneBackgroundInsertMarkerSecs(input({ pxPerSecond: 0 }))).toBe(0);
    expect(laneBackgroundInsertMarkerSecs(input({ pxPerSecond: -8 }))).toBe(0);
  });
});

describe('applyLaneBackgroundClick', () => {
  it('background press: resolves seconds, calls both deps exactly once, returns true', () => {
    const setInsertMarkerSecs = vi.fn();
    const repaintInsertMarker = vi.fn();
    const result = applyLaneBackgroundClick(input(), { setInsertMarkerSecs, repaintInsertMarker });
    expect(result).toBe(true);
    expect(setInsertMarkerSecs).toHaveBeenCalledTimes(1);
    expect(setInsertMarkerSecs).toHaveBeenCalledWith(50);
    expect(repaintInsertMarker).toHaveBeenCalledTimes(1);
  });

  it('clip press: returns false and calls neither dep', () => {
    const setInsertMarkerSecs = vi.fn();
    const repaintInsertMarker = vi.fn();
    const result = applyLaneBackgroundClick(
      input({ clipRects: [{ left: 480, right: 560 }] }),
      { setInsertMarkerSecs, repaintInsertMarker },
    );
    expect(result).toBe(false);
    expect(setInsertMarkerSecs).toHaveBeenCalledTimes(0);
    expect(repaintInsertMarker).toHaveBeenCalledTimes(0);
  });

  it('non-primary press: returns false and calls neither dep', () => {
    const setInsertMarkerSecs = vi.fn();
    const repaintInsertMarker = vi.fn();
    const result = applyLaneBackgroundClick(input({ button: 2 }), { setInsertMarkerSecs, repaintInsertMarker });
    expect(result).toBe(false);
    expect(setInsertMarkerSecs).toHaveBeenCalledTimes(0);
    expect(repaintInsertMarker).toHaveBeenCalledTimes(0);
  });

  it('selection preserved / playhead untouched (acceptance criterion 2)', () => {
    const model = createTimelineMarksModel();
    model.setPlayheadSecs(12);
    const deps = {
      setInsertMarkerSecs: (secs: number) => { model.setInsertMarkerSecs(secs); },
      repaintInsertMarker: vi.fn(),
    };
    expect(Object.keys(deps)).toEqual(['setInsertMarkerSecs', 'repaintInsertMarker']);
    const result = applyLaneBackgroundClick(input(), deps);
    expect(result).toBe(true);
    expect(model.getInsertMarkerSecs()).toBeCloseTo(50);
    expect(model.getPlayheadSecs()).toBe(12);
  });
});
