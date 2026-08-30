// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { DAW_TIMELINE_ORIGIN_PX, DAW_TIMELINE_INSET_PX, DAW_TIMELINE_PX_PER_SECOND } from './daw-shell-runtime';
import { TIMELINE_SCALE_MAX_PX_PER_SECOND, TIMELINE_SCALE_MIN_PX_PER_SECOND, timelineTimeAt } from './timeline-scale';
import { formatRulerElapsed } from './timeline-ruler-labels';
import {
  TIMELINE_OVERVIEW_MIN_DURATION_SECS,
  TIMELINE_OVERVIEW_RANGE_SELECTOR,
  TIMELINE_OVERVIEW_TOTAL_SELECTOR,
  timelineOverviewDurationSecs,
  timelineOverviewView,
  timelineOverviewHTML,
  patchTimelineOverview,
  type TimelineOverviewShellLike,
} from './timeline-overview';

describe('timelineOverviewDurationSecs', () => {
  it('returns the floor when both inputs are 0', () => {
    expect(timelineOverviewDurationSecs(0, 0)).toBe(TIMELINE_OVERVIEW_MIN_DURATION_SECS);
  });

  it('returns the loaded duration when it exceeds the floor and the recorded elapsed', () => {
    expect(timelineOverviewDurationSecs(500, 10)).toBe(500);
  });

  it('returns the recorded elapsed when it exceeds the floor and the loaded duration (AC3 growth rule)', () => {
    expect(timelineOverviewDurationSecs(10, 500)).toBe(500);
  });

  it('treats NaN, Infinity and negative inputs as 0', () => {
    expect(timelineOverviewDurationSecs(Number.NaN, Number.NEGATIVE_INFINITY)).toBe(TIMELINE_OVERVIEW_MIN_DURATION_SECS);
    expect(timelineOverviewDurationSecs(Number.POSITIVE_INFINITY, -50)).toBe(TIMELINE_OVERVIEW_MIN_DURATION_SECS);
    expect(timelineOverviewDurationSecs(-5, -5)).toBe(TIMELINE_OVERVIEW_MIN_DURATION_SECS);
  });
});

describe('timelineOverviewView', () => {
  it('renders a full-width box for an unmeasured shell (shellWidthPx 0)', () => {
    const view = timelineOverviewView({
      loadedDurationSecs: 0,
      recordedElapsedSecs: 0,
      pxPerSecond: DAW_TIMELINE_PX_PER_SECOND,
      shellWidthPx: 0,
    });
    expect(view.leftPct).toBe(0);
    expect(view.widthPct).toBe(100);
    expect(view.visibleEndSecs).toBe(view.durationSecs);
  });

  it('renders a full-range view for a degenerate shell exactly at DAW_TIMELINE_ORIGIN_PX', () => {
    const view = timelineOverviewView({
      loadedDurationSecs: 0,
      recordedElapsedSecs: 0,
      pxPerSecond: DAW_TIMELINE_PX_PER_SECOND,
      shellWidthPx: DAW_TIMELINE_ORIGIN_PX,
    });
    expect(view.leftPct).toBe(0);
    expect(view.widthPct).toBe(100);
    expect(view.visibleEndSecs).toBe(view.durationSecs);
  });

  it('computes widthPct from the timeline column visible window at a known fraction of the duration', () => {
    const shellWidthPx = DAW_TIMELINE_ORIGIN_PX + 400;
    const pxPerSecond = DAW_TIMELINE_PX_PER_SECOND;
    const loadedDurationSecs = 1000;
    const view = timelineOverviewView({ loadedDurationSecs, recordedElapsedSecs: 0, pxPerSecond, shellWidthPx });
    const expectedEndSecs = timelineTimeAt(pxPerSecond, shellWidthPx - DAW_TIMELINE_INSET_PX);
    const expectedWidthPct = (expectedEndSecs / loadedDurationSecs) * 100;
    expect(view.widthPct).toBeCloseTo(expectedWidthPct, 6);
    expect(view.leftPct).toBe(0);
  });

  it('clamps to widthPct 100 when the viewport is wider than the duration', () => {
    const view = timelineOverviewView({
      loadedDurationSecs: TIMELINE_OVERVIEW_MIN_DURATION_SECS,
      recordedElapsedSecs: 0,
      pxPerSecond: TIMELINE_SCALE_MIN_PX_PER_SECOND,
      shellWidthPx: DAW_TIMELINE_ORIGIN_PX + 100000,
    });
    expect(view.widthPct).toBe(100);
    expect(view.visibleEndSecs).toBe(view.durationSecs);
  });

  it('AC3: growing recordedElapsedSecs past the floor grows durationSecs, changes totalLabel, and strictly narrows widthPct', () => {
    const shellWidthPx = DAW_TIMELINE_ORIGIN_PX + 400;
    const pxPerSecond = DAW_TIMELINE_PX_PER_SECOND;
    const before = timelineOverviewView({
      loadedDurationSecs: 0,
      recordedElapsedSecs: TIMELINE_OVERVIEW_MIN_DURATION_SECS / 2,
      pxPerSecond,
      shellWidthPx,
    });
    const after = timelineOverviewView({
      loadedDurationSecs: 0,
      recordedElapsedSecs: TIMELINE_OVERVIEW_MIN_DURATION_SECS * 10,
      pxPerSecond,
      shellWidthPx,
    });
    expect(after.durationSecs).toBeGreaterThan(before.durationSecs);
    expect(after.totalLabel).not.toBe(before.totalLabel);
    expect(after.widthPct).toBeLessThan(before.widthPct);
  });

  it('AC2: a zoomed-in scale strictly narrows widthPct compared to a zoomed-out scale at the same shell width and duration', () => {
    const shellWidthPx = DAW_TIMELINE_ORIGIN_PX + 400;
    const loadedDurationSecs = 1000;
    const zoomedIn = timelineOverviewView({
      loadedDurationSecs,
      recordedElapsedSecs: 0,
      pxPerSecond: TIMELINE_SCALE_MAX_PX_PER_SECOND,
      shellWidthPx,
    });
    const zoomedOut = timelineOverviewView({
      loadedDurationSecs,
      recordedElapsedSecs: 0,
      pxPerSecond: TIMELINE_SCALE_MIN_PX_PER_SECOND,
      shellWidthPx,
    });
    expect(zoomedIn.widthPct).toBeLessThan(zoomedOut.widthPct);
  });

  it('totalLabel matches formatRulerElapsed(durationSecs)', () => {
    const view = timelineOverviewView({
      loadedDurationSecs: 250,
      recordedElapsedSecs: 0,
      pxPerSecond: DAW_TIMELINE_PX_PER_SECOND,
      shellWidthPx: 0,
    });
    expect(view.totalLabel).toBe(formatRulerElapsed(view.durationSecs));
  });
});

describe('timelineOverviewHTML', () => {
  it('renders the overview markup with the range box left/width and the total label', () => {
    const view = timelineOverviewView({
      loadedDurationSecs: 120,
      recordedElapsedSecs: 0,
      pxPerSecond: DAW_TIMELINE_PX_PER_SECOND,
      shellWidthPx: 0,
    });
    const html = timelineOverviewHTML(view);
    expect(html).toContain('class="daw-overview"');
    expect(html).toContain(`class="daw-overview-range" style="left:${view.leftPct}%;width:${view.widthPct}%"`);
    expect(html).toContain(`class="daw-overview-total">${view.totalLabel}</span>`);
  });
});

describe('patchTimelineOverview', () => {
  function fakeShell(clientWidth: number, options: { withRange?: boolean; withTotal?: boolean } = {}): {
    shell: TimelineOverviewShellLike;
    range: { style: { left: string; width: string }; textContent: string | null };
    total: { style: { left: string; width: string }; textContent: string | null };
  } {
    const { withRange = true, withTotal = true } = options;
    const range = { style: { left: '', width: '' }, textContent: null as string | null };
    const total = { style: { left: '', width: '' }, textContent: null as string | null };
    const shell: TimelineOverviewShellLike = {
      clientWidth,
      querySelector: (selector: string) => {
        if (selector === TIMELINE_OVERVIEW_RANGE_SELECTOR) return withRange ? range : null;
        if (selector === TIMELINE_OVERVIEW_TOTAL_SELECTOR) return withTotal ? total : null;
        return null;
      },
    };
    return { shell, range, total };
  }

  it('writes the range node style and the total node textContent from the measured clientWidth', () => {
    const shellWidthPx = DAW_TIMELINE_ORIGIN_PX + 400;
    const { shell, range, total } = fakeShell(shellWidthPx);
    patchTimelineOverview(shell, { loadedDurationSecs: 1000, recordedElapsedSecs: 0, pxPerSecond: DAW_TIMELINE_PX_PER_SECOND });
    const expected = timelineOverviewView({ loadedDurationSecs: 1000, recordedElapsedSecs: 0, pxPerSecond: DAW_TIMELINE_PX_PER_SECOND, shellWidthPx });
    expect(range.style.left).toBe(`${expected.leftPct}%`);
    expect(range.style.width).toBe(`${expected.widthPct}%`);
    expect(total.textContent).toBe(expected.totalLabel);
  });

  it('is a no-op for a null shell', () => {
    expect(() => patchTimelineOverview(null, { loadedDurationSecs: 0, recordedElapsedSecs: 0, pxPerSecond: DAW_TIMELINE_PX_PER_SECOND })).not.toThrow();
  });

  it('is a no-op for the range node when querySelector returns null for it', () => {
    const { shell, total } = fakeShell(DAW_TIMELINE_ORIGIN_PX + 400, { withRange: false });
    expect(() => patchTimelineOverview(shell, { loadedDurationSecs: 100, recordedElapsedSecs: 0, pxPerSecond: DAW_TIMELINE_PX_PER_SECOND })).not.toThrow();
    expect(total.textContent).not.toBeNull();
  });

  it('is a no-op for the total node when querySelector returns null for it', () => {
    const { shell, range } = fakeShell(DAW_TIMELINE_ORIGIN_PX + 400, { withTotal: false });
    expect(() => patchTimelineOverview(shell, { loadedDurationSecs: 100, recordedElapsedSecs: 0, pxPerSecond: DAW_TIMELINE_PX_PER_SECOND })).not.toThrow();
    expect(range.style.left).not.toBe('');
  });

  it('does not rewrite textContent on a second call with an unchanged label', () => {
    const shellWidthPx = DAW_TIMELINE_ORIGIN_PX + 400;
    const { shell, total } = fakeShell(shellWidthPx);
    let writes = 0;
    Object.defineProperty(total, 'textContent', {
      get() { return this._text ?? null; },
      set(value) { writes++; this._text = value; },
    });
    const source = { loadedDurationSecs: 1000, recordedElapsedSecs: 0, pxPerSecond: DAW_TIMELINE_PX_PER_SECOND };
    patchTimelineOverview(shell, source);
    expect(writes).toBe(1);
    patchTimelineOverview(shell, source);
    expect(writes).toBe(1);
  });
});
