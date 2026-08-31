// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { DAW_TIMELINE_PX_PER_SECOND } from './daw-shell-runtime';
import { TIMELINE_SCALE_MAX_PX_PER_SECOND, createTimelineScale, createTimelineScaleFromPxPerSecond } from './timeline-scale';
import {
  getSessionTimelineScale,
  setSessionTimelineScale,
  sessionTimelineScaleForRange,
} from './session-timeline-scale';

// Restore the shared singleton so one test's write cannot leak into another.
afterEach(() => setSessionTimelineScale(createTimelineScale('default')));

describe('session-timeline-scale (#1342)', () => {
  it('defaults to the base geometry before any write', () => {
    expect(getSessionTimelineScale().pxPerSecond).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });

  it('getSessionTimelineScale returns what setSessionTimelineScale last stored', () => {
    setSessionTimelineScale(createTimelineScaleFromPxPerSecond(16));
    expect(getSessionTimelineScale().pxPerSecond).toBe(16);
  });

  describe('sessionTimelineScaleForRange', () => {
    it('resolves the full range to the base scale (default/fit paints identically)', () => {
      expect(sessionTimelineScaleForRange({ startSecs: 0, endSecs: 60 }, 60).pxPerSecond)
        .toBe(DAW_TIMELINE_PX_PER_SECOND);
    });

    it('magnifies a narrowed range', () => {
      expect(sessionTimelineScaleForRange({ startSecs: 15, endSecs: 45 }, 60).pxPerSecond)
        .toBe(DAW_TIMELINE_PX_PER_SECOND * 2); // span 30 of 60
    });

    it('clamps a very narrow range to the zoomed-in bound', () => {
      expect(sessionTimelineScaleForRange({ startSecs: 0, endSecs: 1 }, 60).pxPerSecond)
        .toBe(TIMELINE_SCALE_MAX_PX_PER_SECOND);
    });
  });
});
