// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  createTimelineZoomModel,
  applyTimelineZoom,
  timelineZoomControlsView,
  timelineZoomControlsHTML,
  timelineZoomActionForId,
  TIMELINE_ZOOM_MIN_SPAN_SECS,
  TIMELINE_ZOOM_INSERT_SPAN_SECS,
  TIMELINE_ZOOM_BUTTON_IDS,
  TIMELINE_ZOOM_RANGE_ID,
  type TimelineZoomContext,
  type TimelineZoomModel,
} from './timeline-zoom-controls';

function ctx(overrides: Partial<TimelineZoomContext> = {}): TimelineZoomContext {
  return { durationSecs: 200, playheadSecs: 0, selection: null, ...overrides };
}

describe('createTimelineZoomModel', () => {
  it('starts at the full range with no zoom-back memory', () => {
    expect(createTimelineZoomModel(180)).toEqual({ range: { startSecs: 0, endSecs: 180 }, previousRange: null });
  });

  it('never produces a zero or NaN endSecs for a non-positive or non-finite duration', () => {
    expect(createTimelineZoomModel(0).range.endSecs).toBe(TIMELINE_ZOOM_MIN_SPAN_SECS);
    expect(createTimelineZoomModel(Number.NaN).range.endSecs).toBe(TIMELINE_ZOOM_MIN_SPAN_SECS);
    expect(createTimelineZoomModel(-5).range.endSecs).toBe(TIMELINE_ZOOM_MIN_SPAN_SECS);
  });
});

describe('applyTimelineZoom - fit-full', () => {
  it('resets to [0, durationSecs] and clears zoom-back memory', () => {
    const zoomed: TimelineZoomModel = { range: { startSecs: 40, endSecs: 60 }, previousRange: { startSecs: 0, endSecs: 200 } };
    const next = applyTimelineZoom(zoomed, 'fit-full', ctx({ durationSecs: 180 }));
    expect(next).toEqual({ range: { startSecs: 0, endSecs: 180 }, previousRange: null });
  });
});

describe('applyTimelineZoom - zoom-in', () => {
  it('halves the span and keeps the playhead inside the new range when it is inside the old one', () => {
    const model = createTimelineZoomModel(200);
    const a = applyTimelineZoom(model, 'zoom-in', ctx({ durationSecs: 200, playheadSecs: 50 }));
    expect(a.range).toEqual({ startSecs: 0, endSecs: 100 });

    const b = applyTimelineZoom(model, 'zoom-in', ctx({ durationSecs: 200, playheadSecs: 100 }));
    expect(b.range).toEqual({ startSecs: 50, endSecs: 150 });
  });

  it('centres on the current range itself when the playhead is outside it', () => {
    const model: TimelineZoomModel = { range: { startSecs: 50, endSecs: 150 }, previousRange: null };
    const next = applyTimelineZoom(model, 'zoom-in', ctx({ durationSecs: 200, playheadSecs: 300 }));
    // Centre of {50,150} is 100; halving the 100s span to 50s keeps that centre.
    expect(next.range.startSecs).toBeCloseTo(75);
    expect(next.range.endSecs).toBeCloseTo(125);
  });

  it('never narrows the span below TIMELINE_ZOOM_MIN_SPAN_SECS', () => {
    let model = createTimelineZoomModel(200);
    const c = ctx({ durationSecs: 200, playheadSecs: 100 });
    for (let i = 0; i < 20; i++) model = applyTimelineZoom(model, 'zoom-in', c);
    expect(model.range.endSecs - model.range.startSecs).toBeCloseTo(TIMELINE_ZOOM_MIN_SPAN_SECS);
  });

  it('keeps the range inside [0, durationSecs] when zooming in at the left edge', () => {
    const model: TimelineZoomModel = { range: { startSecs: 0, endSecs: 20 }, previousRange: null };
    const next = applyTimelineZoom(model, 'zoom-in', ctx({ durationSecs: 200, playheadSecs: 0 }));
    expect(next.range.startSecs).toBeGreaterThanOrEqual(0);
    expect(next.range.endSecs).toBeLessThanOrEqual(200);
  });

  it('keeps the range inside [0, durationSecs] when zooming in at the right edge', () => {
    const model: TimelineZoomModel = { range: { startSecs: 180, endSecs: 200 }, previousRange: null };
    const next = applyTimelineZoom(model, 'zoom-in', ctx({ durationSecs: 200, playheadSecs: 200 }));
    expect(next.range.startSecs).toBeGreaterThanOrEqual(0);
    expect(next.range.endSecs).toBeLessThanOrEqual(200);
  });
});

describe('applyTimelineZoom - zoom-out', () => {
  it('doubles the span, clamped so repeated zoom-out never exceeds the full duration', () => {
    let model: TimelineZoomModel = { range: { startSecs: 80, endSecs: 120 }, previousRange: null };
    const c = ctx({ durationSecs: 200, playheadSecs: 100 });
    for (let i = 0; i < 10; i++) {
      model = applyTimelineZoom(model, 'zoom-out', c);
      expect(model.range.startSecs).toBeGreaterThanOrEqual(0);
      expect(model.range.endSecs).toBeLessThanOrEqual(200);
    }
    expect(model.range).toEqual({ startSecs: 0, endSecs: 200 });
  });

  it('keeps the range inside [0, durationSecs] when zooming out at the right edge', () => {
    const model: TimelineZoomModel = { range: { startSecs: 150, endSecs: 200 }, previousRange: null };
    const next = applyTimelineZoom(model, 'zoom-out', ctx({ durationSecs: 200, playheadSecs: 200 }));
    expect(next.range.startSecs).toBeGreaterThanOrEqual(0);
    expect(next.range.endSecs).toBeLessThanOrEqual(200);
  });
});

describe('applyTimelineZoom - zoom-to-selection', () => {
  it('sets the range to the selection and records the pre-zoom range in previousRange', () => {
    const model = createTimelineZoomModel(200);
    const selection = { startSecs: 30, endSecs: 90 };
    const next = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, selection }));
    expect(next.range).toEqual(selection);
    expect(next.previousRange).toEqual({ startSecs: 0, endSecs: 200 });
  });

  it('falls back to an insert-marker window centred on the playhead when there is no selection', () => {
    const model = createTimelineZoomModel(200);
    const next = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, playheadSecs: 50, selection: null }));
    expect(next.range.endSecs - next.range.startSecs).toBeCloseTo(TIMELINE_ZOOM_INSERT_SPAN_SECS);
    expect((next.range.startSecs + next.range.endSecs) / 2).toBeCloseTo(50);
  });

  it('centres on the real insert marker, not the playhead, when both are supplied (#1301)', () => {
    const model = createTimelineZoomModel(200);
    const next = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, playheadSecs: 5, insertMarkerSecs: 40, selection: null }));
    expect(next.range.endSecs - next.range.startSecs).toBeCloseTo(TIMELINE_ZOOM_INSERT_SPAN_SECS);
    expect((next.range.startSecs + next.range.endSecs) / 2).toBeCloseTo(40);
  });

  it('falls back to the playhead when insertMarkerSecs is omitted (#1301, back-compat)', () => {
    const model = createTimelineZoomModel(200);
    const next = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, playheadSecs: 50, selection: null }));
    expect((next.range.startSecs + next.range.endSecs) / 2).toBeCloseTo(50);
  });

  it('falls back to centring the insert-marker window on 0 when the playhead itself is non-finite', () => {
    const model = createTimelineZoomModel(200);
    const next = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, playheadSecs: Number.NaN, selection: null }));
    expect(next.range).toEqual({ startSecs: 0, endSecs: TIMELINE_ZOOM_INSERT_SPAN_SECS });
  });

  it('falls back to the insert-marker window for an inverted or zero-width selection', () => {
    const model = createTimelineZoomModel(200);
    const inverted = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, playheadSecs: 20, selection: { startSecs: 90, endSecs: 30 } }));
    expect(inverted.range.endSecs - inverted.range.startSecs).toBeCloseTo(TIMELINE_ZOOM_INSERT_SPAN_SECS);

    const zeroWidth = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, playheadSecs: 20, selection: { startSecs: 50, endSecs: 50 } }));
    expect(zeroWidth.range.endSecs - zeroWidth.range.startSecs).toBeCloseTo(TIMELINE_ZOOM_INSERT_SPAN_SECS);
  });
});

describe('applyTimelineZoom - zoom-back', () => {
  it('restores the exact range active before the last zoom-to-selection and clears the memory', () => {
    const model = createTimelineZoomModel(200);
    const zoomed = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, selection: { startSecs: 30, endSecs: 90 } }));
    const restored = applyTimelineZoom(zoomed, 'zoom-back', ctx({ durationSecs: 200 }));
    expect(restored.range.startSecs).toBeCloseTo(0);
    expect(restored.range.endSecs).toBeCloseTo(200);
    expect(restored.previousRange).toBeNull();
  });

  it('returns the same model instance when there is no recorded range, so setState is a no-op', () => {
    const model = createTimelineZoomModel(200);
    const result = applyTimelineZoom(model, 'zoom-back', ctx({ durationSecs: 200 }));
    expect(result).toBe(model);
  });

  it('every non-selection action clears the zoom-back memory', () => {
    const model = createTimelineZoomModel(200);
    const zoomed = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, selection: { startSecs: 30, endSecs: 90 } }));
    expect(timelineZoomControlsView(zoomed, ctx({ durationSecs: 200 })).canZoomBack).toBe(true);

    for (const action of ['fit-full', 'zoom-in', 'zoom-out'] as const) {
      const cleared = applyTimelineZoom(zoomed, action, ctx({ durationSecs: 200, playheadSecs: 50 }));
      expect(timelineZoomControlsView(cleared, ctx({ durationSecs: 200 })).canZoomBack).toBe(false);
    }
  });
});

describe('applyTimelineZoom - non-finite guards', () => {
  it('normalizes a non-finite or inverted stored range to the full range instead of propagating NaN', () => {
    const bad: TimelineZoomModel = { range: { startSecs: Number.NaN, endSecs: 50 }, previousRange: null };
    const next = applyTimelineZoom(bad, 'zoom-in', ctx({ durationSecs: 200, playheadSecs: 0 }));
    expect(Number.isFinite(next.range.startSecs)).toBe(true);
    expect(Number.isFinite(next.range.endSecs)).toBe(true);

    const inverted: TimelineZoomModel = { range: { startSecs: 150, endSecs: 20 }, previousRange: null };
    const next2 = applyTimelineZoom(inverted, 'fit-full', ctx({ durationSecs: 200 }));
    expect(next2.range).toEqual({ startSecs: 0, endSecs: 200 });
  });

  it('widens a valid but sub-minimum stored span back up to TIMELINE_ZOOM_MIN_SPAN_SECS', () => {
    const narrow: TimelineZoomModel = { range: { startSecs: 50, endSecs: 50.5 }, previousRange: null };
    const view = timelineZoomControlsView(narrow, ctx({ durationSecs: 200 }));
    expect(view.range.endSecs - view.range.startSecs).toBeCloseTo(TIMELINE_ZOOM_MIN_SPAN_SECS);
  });

  it('falls back to identity for an unrecognized action (defensive default)', () => {
    const model = createTimelineZoomModel(200);
    const next = applyTimelineZoom(model, 'not-a-real-action' as unknown as Parameters<typeof applyTimelineZoom>[1], ctx({ durationSecs: 200 }));
    expect(next).toBe(model);
  });
});

describe('timelineZoomControlsView', () => {
  it('formats both ends of the range as m:ss', () => {
    const model = createTimelineZoomModel(180);
    const view = timelineZoomControlsView(model, ctx({ durationSecs: 180 }));
    expect(view.rangeLabel).toBe('0:00 - 3:00');
  });

  it('disables zoom-in at the minimum span', () => {
    const model: TimelineZoomModel = { range: { startSecs: 0, endSecs: TIMELINE_ZOOM_MIN_SPAN_SECS }, previousRange: null };
    expect(timelineZoomControlsView(model, ctx({ durationSecs: 200 })).canZoomIn).toBe(false);
  });

  it('disables zoom-out and fit-full at the full range', () => {
    const model = createTimelineZoomModel(200);
    const view = timelineZoomControlsView(model, ctx({ durationSecs: 200 }));
    expect(view.canZoomOut).toBe(false);
    expect(view.canFitFull).toBe(false);
  });

  it('tracks canZoomBack from previousRange', () => {
    const model = createTimelineZoomModel(200);
    expect(timelineZoomControlsView(model, ctx({ durationSecs: 200 })).canZoomBack).toBe(false);
    const zoomed = applyTimelineZoom(model, 'zoom-to-selection', ctx({ durationSecs: 200, selection: { startSecs: 10, endSecs: 20 } }));
    expect(timelineZoomControlsView(zoomed, ctx({ durationSecs: 200 })).canZoomBack).toBe(true);
  });
});

describe('timelineZoomControlsHTML', () => {
  it('emits the wrapper, all five ids, the range readout, and disabled exactly where can* is false', () => {
    const model: TimelineZoomModel = { range: { startSecs: 0, endSecs: TIMELINE_ZOOM_MIN_SPAN_SECS }, previousRange: null };
    const view = timelineZoomControlsView(model, ctx({ durationSecs: 200 }));
    const html = timelineZoomControlsHTML(view);

    expect(html).toContain('class="daw-transport-zoom daw-transport-group"');
    for (const id of Object.values(TIMELINE_ZOOM_BUTTON_IDS)) expect(html).toContain(`id="${id}"`);
    expect(html).toContain(`id="${TIMELINE_ZOOM_RANGE_ID}" role="status"`);
    expect(html).toContain(view.rangeLabel);

    // #1347: the cluster is a named group so a screen-reader user hears one
    // "Timeline zoom" grouping instead of five loose buttons, and the label
    // makes the shortened button text scannable in context.
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Timeline zoom"');

    // #1347: the two cryptic labels (`Sel`, `Back`) are replaced with clearer
    // compact text; every button still carries its descriptive aria-label so
    // the accessible name is unchanged.
    expect(html).toContain(`id="${TIMELINE_ZOOM_BUTTON_IDS['zoom-to-selection']}" title="Zoom to the selected time range" aria-label="Zoom to the selected time range"`);
    expect(html).toMatch(new RegExp(`id="${TIMELINE_ZOOM_BUTTON_IDS['zoom-to-selection']}"[^>]*>Fit sel<`));
    expect(html).toMatch(new RegExp(`id="${TIMELINE_ZOOM_BUTTON_IDS['zoom-back']}"[^>]*aria-label="[^"]+"`));
    expect(html).toMatch(new RegExp(`id="${TIMELINE_ZOOM_BUTTON_IDS['zoom-back']}"[^>]*>Prev<`));
    // Every zoom button keeps a non-empty accessible name (#1347 a11y guard).
    for (const id of Object.values(TIMELINE_ZOOM_BUTTON_IDS)) {
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*aria-label="[^"]+"`));
    }

    // canFitFull true (not at full range), canZoomIn false (min span), canZoomOut
    // true, canZoomBack false (no previousRange) - Sel is never disabled.
    expect(html.match(new RegExp(`id="${TIMELINE_ZOOM_BUTTON_IDS['fit-full']}"[^>]*disabled`))).toBeNull();
    expect(html).toMatch(new RegExp(`id="${TIMELINE_ZOOM_BUTTON_IDS['zoom-in']}"[^>]*disabled`));
    expect(html.match(new RegExp(`id="${TIMELINE_ZOOM_BUTTON_IDS['zoom-out']}"[^>]*disabled`))).toBeNull();
    expect(html.match(new RegExp(`id="${TIMELINE_ZOOM_BUTTON_IDS['zoom-to-selection']}"[^>]*disabled`))).toBeNull();
    expect(html).toMatch(new RegExp(`id="${TIMELINE_ZOOM_BUTTON_IDS['zoom-back']}"[^>]*disabled`));
  });
});

describe('timelineZoomActionForId', () => {
  it('maps each of the five ids to its action', () => {
    for (const action of Object.keys(TIMELINE_ZOOM_BUTTON_IDS) as (keyof typeof TIMELINE_ZOOM_BUTTON_IDS)[]) {
      expect(timelineZoomActionForId(TIMELINE_ZOOM_BUTTON_IDS[action])).toBe(action);
    }
  });

  it('returns null for an unrelated or empty id', () => {
    expect(timelineZoomActionForId('daw-session-play')).toBeNull();
    expect(timelineZoomActionForId('')).toBeNull();
  });
});
