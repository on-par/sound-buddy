// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { TIMELINE_MIN_VISIBLE_SPAN_SECS } from './timeline-visible-range';
import {
  TIMELINE_SCROLL_LINE_PX,
  TIMELINE_SCROLL_PAGE_PX,
  TIMELINE_SCROLL_OFFSET_VAR,
  timelineScrollDeltaPx,
  applyTimelineScroll,
  timelineScrollOffsetPx,
  patchTimelineScrollOffset,
  type TimelineScrollWheelLike,
} from './timeline-scroll-gesture';

function wheel(overrides: Partial<TimelineScrollWheelLike>): TimelineScrollWheelLike {
  return { deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, ...overrides };
}

describe('timelineScrollDeltaPx', () => {
  it('pixel-mode passthrough', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: 40 }))).toBe(40);
  });

  it('preserves a negative delta', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: -40 }))).toBe(-40);
  });

  it('deltaMode 1 (lines) scales by TIMELINE_SCROLL_LINE_PX', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: 3, deltaMode: 1 }))).toBe(3 * TIMELINE_SCROLL_LINE_PX);
  });

  it('deltaMode 2 (pages) scales by TIMELINE_SCROLL_PAGE_PX', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: 2, deltaMode: 2 }))).toBe(2 * TIMELINE_SCROLL_PAGE_PX);
  });

  it('deltaMode undefined is treated as pixels', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: 12, deltaMode: undefined }))).toBe(12);
  });

  it('returns null when ctrlKey is set (the #1291 zoom gesture)', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: 40, ctrlKey: true }))).toBeNull();
  });

  it('returns null when metaKey is set', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: 40, metaKey: true }))).toBeNull();
  });

  it('returns null for a vertical-only wheel (deltaX === 0, deltaY !== 0)', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: 0, deltaY: 40 }))).toBeNull();
  });

  it('returns null for a non-finite deltaX', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: NaN }))).toBeNull();
  });

  it('returns null for a non-finite deltaY', () => {
    expect(timelineScrollDeltaPx(wheel({ deltaX: 40, deltaY: NaN }))).toBeNull();
  });
});

describe('applyTimelineScroll', () => {
  const ctx = { pxPerSecond: 8, durationSecs: 300 };

  it('AC1: start moves later on a positive deltaX, span unchanged', () => {
    const range = { startSecs: 10, endSecs: 30 };
    const next = applyTimelineScroll(range, wheel({ deltaX: 80 }), ctx);
    expect(next).toEqual({ startSecs: 20, endSecs: 40 });
  });

  it('AC1: a negative deltaX moves the start earlier', () => {
    const range = { startSecs: 10, endSecs: 30 };
    const next = applyTimelineScroll(range, wheel({ deltaX: -80 }), ctx);
    expect(next).toEqual({ startSecs: 0, endSecs: 20 });
  });

  it('AC2: scrolling further left from a range already pinned at the minimum span at t=0 returns the same reference', () => {
    // clampVisibleRange (#1290, unchanged by this slice) only reaches a true
    // fixed point at a bound once the span has degenerated to
    // TIMELINE_MIN_VISIBLE_SPAN_SECS - the same invariant its own
    // "setStartSecs pins the start at durationSecs - span..." test exercises.
    const range = { startSecs: 0, endSecs: TIMELINE_MIN_VISIBLE_SPAN_SECS };
    const next = applyTimelineScroll(range, wheel({ deltaX: -80 }), ctx);
    expect(next).toBe(range);
  });

  it('AC2: scrolling further right from a range already pinned at the minimum span at durationSecs returns the same reference', () => {
    const range = { startSecs: ctx.durationSecs - TIMELINE_MIN_VISIBLE_SPAN_SECS, endSecs: ctx.durationSecs };
    const next = applyTimelineScroll(range, wheel({ deltaX: 80 }), ctx);
    expect(next).toBe(range);
  });

  it('AC2: scrolling left from startSecs 0 never produces a negative start', () => {
    const range = { startSecs: 0, endSecs: 20 };
    const next = applyTimelineScroll(range, wheel({ deltaX: -80 }), ctx);
    expect(next.startSecs).toBeGreaterThanOrEqual(0);
  });

  it('AC2: scrolling right from a range already flush against durationSecs never overshoots the end', () => {
    const range = { startSecs: 280, endSecs: 300 };
    const next = applyTimelineScroll(range, wheel({ deltaX: 80 }), ctx);
    expect(next.endSecs).toBeLessThanOrEqual(300);
  });

  it('AC2: a large right delta from mid-timeline lands within bounds, not past durationSecs', () => {
    const range = { startSecs: 100, endSecs: 120 };
    const next = applyTimelineScroll(range, wheel({ deltaX: 100_000 }), ctx);
    expect(next.startSecs).toBeGreaterThanOrEqual(0);
    expect(next.endSecs).toBe(300);
    expect(next.endSecs).toBeLessThanOrEqual(300);
  });

  it('a ctrl-modified wheel returns the input reference (not a pan)', () => {
    const range = { startSecs: 10, endSecs: 30 };
    expect(applyTimelineScroll(range, wheel({ deltaX: 80, ctrlKey: true }), ctx)).toBe(range);
  });

  it('a vertical-only wheel returns the input reference (not a pan)', () => {
    const range = { startSecs: 10, endSecs: 30 };
    expect(applyTimelineScroll(range, wheel({ deltaX: 0, deltaY: 80 }), ctx)).toBe(range);
  });

  it('pxPerSecond of 0 leaves the range unmoved (same reference)', () => {
    const range = { startSecs: 10, endSecs: 30 };
    expect(applyTimelineScroll(range, wheel({ deltaX: 80 }), { pxPerSecond: 0, durationSecs: 300 })).toBe(range);
  });

  it('a non-finite pxPerSecond leaves the range unmoved (same reference)', () => {
    const range = { startSecs: 10, endSecs: 30 };
    expect(applyTimelineScroll(range, wheel({ deltaX: 80 }), { pxPerSecond: NaN, durationSecs: 300 })).toBe(range);
  });
});

describe('timelineScrollOffsetPx', () => {
  it('converts startSecs to an offset in px through the shared scale', () => {
    expect(timelineScrollOffsetPx({ startSecs: 12, endSecs: 40 }, 8)).toBe(96);
  });

  it('a start of 0 is an offset of 0', () => {
    expect(timelineScrollOffsetPx({ startSecs: 0, endSecs: 20 }, 8)).toBe(0);
  });

  it('a non-finite pxPerSecond resolves to 0', () => {
    expect(timelineScrollOffsetPx({ startSecs: 12, endSecs: 40 }, NaN)).toBe(0);
  });
});

describe('patchTimelineScrollOffset', () => {
  it('writes the offset as a px string to the shared custom property', () => {
    const shell = { style: { setProperty: vi.fn() } };
    patchTimelineScrollOffset(shell, 96);
    expect(shell.style.setProperty).toHaveBeenCalledWith(TIMELINE_SCROLL_OFFSET_VAR, '96px');
  });

  it('a null shell is a silent no-op', () => {
    expect(() => patchTimelineScrollOffset(null, 96)).not.toThrow();
  });

  it('a non-finite offset writes 0px', () => {
    const shell = { style: { setProperty: vi.fn() } };
    patchTimelineScrollOffset(shell, NaN);
    expect(shell.style.setProperty).toHaveBeenCalledWith(TIMELINE_SCROLL_OFFSET_VAR, '0px');
  });
});
