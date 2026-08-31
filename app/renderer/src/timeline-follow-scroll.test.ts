// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  createTimelineFollowModel,
  applyTimelineFollowEvent,
  timelineFollowEventForWheel,
  timelineFollowRange,
  timelineFollowZoom,
  timelineFollowView,
  timelineFollowButtonHTML,
  TIMELINE_FOLLOW_BUTTON_ID,
  type TimelineFollowModel,
  type TimelineFollowContext,
} from './timeline-follow-scroll';

function ctx(overrides: Partial<TimelineFollowContext> = {}): TimelineFollowContext {
  return { playheadSecs: 0, durationSecs: 200, ...overrides };
}

describe('createTimelineFollowModel', () => {
  it('starts following with no pause cause', () => {
    expect(createTimelineFollowModel()).toEqual({ following: true, pausedBy: null });
  });
});

describe('applyTimelineFollowEvent', () => {
  it("'manual-scroll' pauses a following model with cause 'scroll'", () => {
    const next = applyTimelineFollowEvent(createTimelineFollowModel(), 'manual-scroll');
    expect(next).toEqual({ following: false, pausedBy: 'scroll' });
  });

  it("'manual-zoom' pauses a following model with cause 'zoom'", () => {
    const next = applyTimelineFollowEvent(createTimelineFollowModel(), 'manual-zoom');
    expect(next).toEqual({ following: false, pausedBy: 'zoom' });
  });

  it.each<TimelineFollowModel>([
    { following: false, pausedBy: 'scroll' },
    { following: false, pausedBy: 'zoom' },
    { following: false, pausedBy: 'manual' },
  ])('%o resumes on play/seek/navigate', (paused) => {
    for (const event of ['play', 'seek', 'navigate'] as const) {
      expect(applyTimelineFollowEvent(paused, event)).toEqual({ following: true, pausedBy: null });
    }
  });

  it("'toggle' pauses a following model with cause 'manual'", () => {
    const next = applyTimelineFollowEvent(createTimelineFollowModel(), 'toggle');
    expect(next).toEqual({ following: false, pausedBy: 'manual' });
  });

  it("'toggle' resumes a paused model regardless of its cause", () => {
    const next = applyTimelineFollowEvent({ following: false, pausedBy: 'scroll' }, 'toggle');
    expect(next).toEqual({ following: true, pausedBy: null });
  });

  it('returns the identical reference when a repeated pause event changes nothing', () => {
    const paused = applyTimelineFollowEvent(createTimelineFollowModel(), 'manual-scroll');
    expect(applyTimelineFollowEvent(paused, 'manual-scroll')).toBe(paused);
  });

  it('returns the identical reference when a resume event hits an already-following model', () => {
    const following = createTimelineFollowModel();
    expect(applyTimelineFollowEvent(following, 'play')).toBe(following);
    expect(applyTimelineFollowEvent(following, 'seek')).toBe(following);
    expect(applyTimelineFollowEvent(following, 'navigate')).toBe(following);
  });
});

describe('timelineFollowEventForWheel', () => {
  it('classifies a ctrl-modified wheel as a zoom gesture', () => {
    expect(timelineFollowEventForWheel({ deltaX: 0, deltaY: 10, ctrlKey: true, metaKey: false })).toBe('manual-zoom');
  });

  it('classifies a meta-modified wheel as a zoom gesture', () => {
    expect(timelineFollowEventForWheel({ deltaX: 0, deltaY: 10, ctrlKey: false, metaKey: true })).toBe('manual-zoom');
  });

  it('classifies a horizontal wheel as a scroll gesture', () => {
    expect(timelineFollowEventForWheel({ deltaX: -40, deltaY: 0, ctrlKey: false, metaKey: false })).toBe('manual-scroll');
  });

  it('classifies a wheel with any horizontal delta as scroll even when vertical delta is larger', () => {
    expect(timelineFollowEventForWheel({ deltaX: 5, deltaY: 80, ctrlKey: false, metaKey: false })).toBe('manual-scroll');
  });

  it('does not pause on a pure vertical wheel', () => {
    expect(timelineFollowEventForWheel({ deltaX: 0, deltaY: 80, ctrlKey: false, metaKey: false })).toBeNull();
  });

  it('does not pause on a zero-delta wheel', () => {
    expect(timelineFollowEventForWheel({ deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false })).toBeNull();
  });

  it('never pauses on a non-finite delta', () => {
    expect(timelineFollowEventForWheel({ deltaX: Number.NaN, deltaY: 0, ctrlKey: false, metaKey: false })).toBeNull();
    expect(timelineFollowEventForWheel({ deltaX: 0, deltaY: Number.POSITIVE_INFINITY, ctrlKey: false, metaKey: false })).toBeNull();
  });
});

describe('timelineFollowRange', () => {
  const range = { startSecs: 10, endSecs: 20 };

  it('returns the range unchanged (identical reference) while paused', () => {
    const paused: TimelineFollowModel = { following: false, pausedBy: 'manual' };
    expect(timelineFollowRange(paused, range, ctx({ playheadSecs: 50 }))).toBe(range);
  });

  it('returns the range unchanged when the playhead is already inside it', () => {
    const following = createTimelineFollowModel();
    expect(timelineFollowRange(following, range, ctx({ playheadSecs: 15 }))).toBe(range);
    expect(timelineFollowRange(following, range, ctx({ playheadSecs: 10 }))).toBe(range);
    expect(timelineFollowRange(following, range, ctx({ playheadSecs: 20 }))).toBe(range);
  });

  it('pages the range forward so the playhead lands on the left edge, span preserved', () => {
    const following = createTimelineFollowModel();
    const next = timelineFollowRange(following, range, ctx({ playheadSecs: 45, durationSecs: 200 }));
    expect(next).toEqual({ startSecs: 45, endSecs: 55 });
  });

  it('pages the range back the same way when the playhead is before startSecs', () => {
    const following = createTimelineFollowModel();
    const next = timelineFollowRange(following, range, ctx({ playheadSecs: 2, durationSecs: 200 }));
    expect(next).toEqual({ startSecs: 2, endSecs: 12 });
  });

  it('clamps the paged range so endSecs never exceeds durationSecs, span preserved', () => {
    const following = createTimelineFollowModel();
    const next = timelineFollowRange(following, range, ctx({ playheadSecs: 198, durationSecs: 200 }));
    expect(next.endSecs).toBeLessThanOrEqual(200);
    expect(next.endSecs - next.startSecs).toBeCloseTo(10);
  });

  it('leaves the range unchanged for a non-finite playhead', () => {
    const following = createTimelineFollowModel();
    expect(timelineFollowRange(following, range, ctx({ playheadSecs: Number.NaN }))).toBe(range);
  });

  it('leaves the range unchanged for a non-finite duration', () => {
    const following = createTimelineFollowModel();
    expect(timelineFollowRange(following, range, ctx({ playheadSecs: 45, durationSecs: Number.NaN }))).toBe(range);
  });

  it('leaves the range unchanged for a non-positive duration', () => {
    const following = createTimelineFollowModel();
    expect(timelineFollowRange(following, range, ctx({ playheadSecs: 45, durationSecs: 0 }))).toBe(range);
  });

  it('leaves the range unchanged for a zero-width range', () => {
    const following = createTimelineFollowModel();
    const zeroWidth = { startSecs: 10, endSecs: 10 };
    expect(timelineFollowRange(following, zeroWidth, ctx({ playheadSecs: 45 }))).toBe(zeroWidth);
  });
});

describe('timelineFollowZoom', () => {
  const zoom = { range: { startSecs: 10, endSecs: 20 }, previousRange: { startSecs: 0, endSecs: 60 } };

  it('returns the identical zoom reference while paused, so a setState bails out', () => {
    const paused: TimelineFollowModel = { following: false, pausedBy: 'scroll' };
    expect(timelineFollowZoom(zoom, paused, ctx({ playheadSecs: 50 }))).toBe(zoom);
  });

  it('returns the identical zoom reference when the playhead is already in view', () => {
    const following = createTimelineFollowModel();
    expect(timelineFollowZoom(zoom, following, ctx({ playheadSecs: 15 }))).toBe(zoom);
  });

  it('pages the range to keep the playhead in view, span preserved', () => {
    const following = createTimelineFollowModel();
    const next = timelineFollowZoom(zoom, following, ctx({ playheadSecs: 45, durationSecs: 200 }));
    expect(next.range).toEqual({ startSecs: 45, endSecs: 55 });
  });

  it('clears previousRange on a page, matching a manual scroll (#1292)', () => {
    const following = createTimelineFollowModel();
    const next = timelineFollowZoom(zoom, following, ctx({ playheadSecs: 45, durationSecs: 200 }));
    expect(next.previousRange).toBeNull();
  });

  it('leaves previousRange untouched when nothing pages (identical reference)', () => {
    const following = createTimelineFollowModel();
    const settled = timelineFollowZoom(zoom, following, ctx({ playheadSecs: 15 }));
    expect(settled.previousRange).toBe(zoom.previousRange);
  });
});

describe('timelineFollowView / timelineFollowButtonHTML', () => {
  it('renders the following view pressed, with the active class and a pause-oriented title', () => {
    const view = timelineFollowView(createTimelineFollowModel());
    expect(view).toEqual({
      following: true,
      label: 'Follow',
      title: 'Following the playhead - click to pause',
    });
    const html = timelineFollowButtonHTML(view);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('active');
    expect(html).toContain(`id="${TIMELINE_FOLLOW_BUTTON_ID}"`);
    expect(html).not.toContain('daw-zoom-btn');
  });

  it('renders the paused view unpressed, without the active class and a resume-oriented title', () => {
    const view = timelineFollowView({ following: false, pausedBy: 'scroll' });
    expect(view).toEqual({
      following: false,
      label: 'Follow',
      title: 'Follow paused - click to follow the playhead again',
    });
    const html = timelineFollowButtonHTML(view);
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain(' active');
    expect(html).not.toContain('daw-zoom-btn');
  });
});
