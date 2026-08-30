// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  RULER_LABEL_MIN_SPACING_PX,
  RULER_LABEL_INTERVAL_CHOICES_SECS,
  rulerLabelIntervalSecs,
  barsBeatsAt,
  formatRulerElapsed,
  timelineRulerLabels,
} from './timeline-ruler-labels';
import { TIMELINE_DEFAULT_BPM, createTimelineTempo } from './timeline-bpm';
import {
  createTimelineScale,
  TIMELINE_SCALE_MIN_PX_PER_SECOND,
  TIMELINE_SCALE_MAX_PX_PER_SECOND,
  type TimelineZoomState,
} from './timeline-scale';
import { dawRulerTicks, DAW_TIMELINE_SPAN_SECS, DAW_TIMELINE_ORIGIN_PX, DAW_TIMELINE_PX_PER_SECOND } from './daw-shell-runtime';

describe('rulerLabelIntervalSecs', () => {
  it('picks 10s at the shipped default scale (8 px/s) — the mock cadence', () => {
    expect(rulerLabelIntervalSecs(DAW_TIMELINE_PX_PER_SECOND)).toBe(10);
  });

  it('picks 5s at the zoomed-in bound (32 px/s)', () => {
    expect(rulerLabelIntervalSecs(TIMELINE_SCALE_MAX_PX_PER_SECOND)).toBe(5);
  });

  it('picks 60s at the zoomed-out bound (2 px/s)', () => {
    expect(rulerLabelIntervalSecs(TIMELINE_SCALE_MIN_PX_PER_SECOND)).toBe(60);
  });

  it('falls back to the sparsest choice for a non-finite or non-positive scale', () => {
    const sparsest = RULER_LABEL_INTERVAL_CHOICES_SECS[RULER_LABEL_INTERVAL_CHOICES_SECS.length - 1];
    expect(rulerLabelIntervalSecs(NaN)).toBe(sparsest);
    expect(rulerLabelIntervalSecs(Infinity)).toBe(sparsest);
    expect(rulerLabelIntervalSecs(0)).toBe(sparsest);
    expect(rulerLabelIntervalSecs(-4)).toBe(sparsest);
  });

  it('falls back to the sparsest choice when no choice is wide enough', () => {
    const sparsest = RULER_LABEL_INTERVAL_CHOICES_SECS[RULER_LABEL_INTERVAL_CHOICES_SECS.length - 1];
    expect(rulerLabelIntervalSecs(0.01)).toBe(sparsest);
  });

  it('every returned interval satisfies the minimum-spacing rule at each real zoom-state scale', () => {
    for (const pxPerSecond of [DAW_TIMELINE_PX_PER_SECOND, TIMELINE_SCALE_MIN_PX_PER_SECOND, TIMELINE_SCALE_MAX_PX_PER_SECOND]) {
      const interval = rulerLabelIntervalSecs(pxPerSecond);
      expect(interval * pxPerSecond).toBeGreaterThanOrEqual(RULER_LABEL_MIN_SPACING_PX);
    }
  });
});

describe('barsBeatsAt', () => {
  it('t=0 at 120 BPM reads 1.1 — 1-based bars and beats', () => {
    expect(barsBeatsAt(0, 120)).toBe('1.1');
  });

  it('steps through beats and bars at 120 BPM', () => {
    expect(barsBeatsAt(1, 120)).toBe('1.3');
    expect(barsBeatsAt(2, 120)).toBe('2.1');
    expect(barsBeatsAt(10, 120)).toBe('6.1');
  });

  it('computes correctly at a different tempo', () => {
    expect(barsBeatsAt(60, 140)).toBe('36.1');
  });

  it('tolerates float error via the epsilon guard', () => {
    // 2.4 * 175 / 60 evaluates to 6.999999999999999 in IEEE-754; without the
    // epsilon this floors to 6 beats and mislabels as '2.3'.
    expect(barsBeatsAt(2.4, 175)).toBe('2.4');
  });

  it('non-finite or negative time resolves to 1.1', () => {
    expect(barsBeatsAt(-5, 120)).toBe('1.1');
    expect(barsBeatsAt(NaN, 120)).toBe('1.1');
    expect(barsBeatsAt(Infinity, 120)).toBe('1.1');
  });

  it('non-finite or non-positive bpm falls back to the exported default, not a fresh literal', () => {
    expect(barsBeatsAt(10, NaN)).toBe(barsBeatsAt(10, TIMELINE_DEFAULT_BPM));
    expect(barsBeatsAt(10, 0)).toBe(barsBeatsAt(10, TIMELINE_DEFAULT_BPM));
  });
});

describe('formatRulerElapsed', () => {
  it('formats M:SS', () => {
    expect(formatRulerElapsed(0)).toBe('0:00');
    expect(formatRulerElapsed(9)).toBe('0:09');
    expect(formatRulerElapsed(10)).toBe('0:10');
    expect(formatRulerElapsed(65)).toBe('1:05');
    expect(formatRulerElapsed(600)).toBe('10:00');
  });

  it('non-finite or negative time resolves to 0:00', () => {
    expect(formatRulerElapsed(-5)).toBe('0:00');
    expect(formatRulerElapsed(NaN)).toBe('0:00');
    expect(formatRulerElapsed(-Infinity)).toBe('0:00');
  });

  it('matches the shipped transport formatter exactly (drift guard, ADR-0011)', () => {
    const { formatElapsed } = require('../daw-playhead-state.js') as { formatElapsed: (ms: number) => string };
    for (const secs of [0, 1, 9, 10, 59, 60, 65, 119, 600, 3599, 3600]) {
      expect(formatRulerElapsed(secs)).toBe(formatElapsed(secs * 1000));
    }
  });
});

describe('timelineRulerLabels', () => {
  it('returns an empty array for a non-finite or negative span', () => {
    const scale = createTimelineScale('default');
    const tempo = createTimelineTempo();
    expect(timelineRulerLabels(-1, scale, tempo)).toEqual([]);
    expect(timelineRulerLabels(NaN, scale, tempo)).toEqual([]);
    expect(timelineRulerLabels(Infinity, scale, tempo)).toEqual([]);
  });

  it('returns exactly one label at timeSecs 0 for a zero span', () => {
    const scale = createTimelineScale('default');
    const tempo = createTimelineTempo();
    const labels = timelineRulerLabels(0, scale, tempo);
    expect(labels).toHaveLength(1);
    expect(labels[0].timeSecs).toBe(0);
  });

  it('produces the mock cadence at the shipped default scale', () => {
    const scale = createTimelineScale('default');
    const tempo = createTimelineTempo();
    const labels = timelineRulerLabels(DAW_TIMELINE_SPAN_SECS, scale, tempo);
    expect(labels).toHaveLength(31);
    expect(labels[0]).toEqual({ timeSecs: 0, xPx: DAW_TIMELINE_ORIGIN_PX, bars: '1.1', elapsed: '0:00' });
    expect(labels[1]).toMatchObject({ timeSecs: 10, bars: '6.1', elapsed: '0:10' });
  });

  it('every label is aligned with the scale timeToX and derived strings, at every zoom state', () => {
    const states: readonly TimelineZoomState[] = ['fit', 'default', 'zoomed-in', 'zoomed-out'];
    const tempo = createTimelineTempo();
    for (const state of states) {
      const scale = state === 'fit'
        ? createTimelineScale('fit', { durationSecs: DAW_TIMELINE_SPAN_SECS, viewportWidthPx: 900 })
        : createTimelineScale(state);
      const labels = timelineRulerLabels(DAW_TIMELINE_SPAN_SECS, scale, tempo);
      for (const label of labels) {
        expect(label.xPx).toBe(scale.timeToX(label.timeSecs));
        expect(label.bars).toBe(barsBeatsAt(label.timeSecs, tempo.bpm));
        expect(label.elapsed).toBe(formatRulerElapsed(label.timeSecs));
      }
    }
  });

  it('every label sits at a ruler tick x at the shipped scale', () => {
    const scale = createTimelineScale('default');
    const tempo = createTimelineTempo();
    const labels = timelineRulerLabels(DAW_TIMELINE_SPAN_SECS, scale, tempo);
    const tickXs = new Set(dawRulerTicks(DAW_TIMELINE_SPAN_SECS, scale).map((t) => t.xPx));
    for (const label of labels) expect(tickXs.has(label.xPx)).toBe(true);
  });

  it('BPM never reaches geometry — xPx is identical across tempos while bars differ', () => {
    const scale = createTimelineScale('default');
    const slow = timelineRulerLabels(DAW_TIMELINE_SPAN_SECS, scale, createTimelineTempo(60));
    const fast = timelineRulerLabels(DAW_TIMELINE_SPAN_SECS, scale, createTimelineTempo(200));
    expect(slow.map((l) => l.xPx)).toEqual(fast.map((l) => l.xPx));
    expect(slow.map((l) => l.bars)).not.toEqual(fast.map((l) => l.bars));
  });

  it('is pure — equal inputs produce a deep-equal result', () => {
    const scale = createTimelineScale('default');
    const tempo = createTimelineTempo();
    expect(timelineRulerLabels(DAW_TIMELINE_SPAN_SECS, scale, tempo))
      .toEqual(timelineRulerLabels(DAW_TIMELINE_SPAN_SECS, scale, tempo));
  });
});
