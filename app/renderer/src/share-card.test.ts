// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  SHARE_CARD_WIDTH,
  SHARE_CARD_HEIGHT,
  MAX_SHARE_METRICS,
  MAX_CHURCH_NAME_LEN,
  MIN_SCORE,
  MAX_SCORE,
  buildShareCardModel,
  shareCardDrawOps,
  renderShareCard,
  assertNoIdentifyingText,
  buildShareFilename,
  type ShareCardInput,
  type DrawOp,
  type CanvasLike,
} from './share-card';

const EPSILON = 0.001;

function baseInput(over: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    grade: 'A',
    score: 92,
    headline: 'Mix graded by Sound Buddy',
    metrics: [
      { label: 'Peak Level', value: '-3.2 dBFS' },
      { label: 'RMS Level', value: '-18.4 dBFS' },
      { label: 'Dynamic Range', value: '12.1 dB' },
    ],
    ...over,
  };
}

describe('buildShareCardModel', () => {
  it('clamps a score below MIN_SCORE', () => {
    expect(buildShareCardModel(baseInput({ score: -15 })).score).toBe(MIN_SCORE);
  });

  it('clamps a score above MAX_SCORE', () => {
    expect(buildShareCardModel(baseInput({ score: 250 })).score).toBe(MAX_SCORE);
  });

  it('rounds a fractional score', () => {
    expect(buildShareCardModel(baseInput({ score: 87.6 })).score).toBe(88);
  });

  it('truncates a church name longer than MAX_CHURCH_NAME_LEN', () => {
    const long = 'a'.repeat(MAX_CHURCH_NAME_LEN + 20);
    const model = buildShareCardModel(baseInput({ churchName: long }));
    expect(model.churchName).toBe('a'.repeat(MAX_CHURCH_NAME_LEN));
    expect(model.churchName?.length).toBe(MAX_CHURCH_NAME_LEN);
  });

  it('trims a church name with surrounding whitespace', () => {
    expect(buildShareCardModel(baseInput({ churchName: '  Grace Chapel  ' })).churchName).toBe('Grace Chapel');
  });

  it.each([undefined, null, '', '   '])('maps %j church name to null', (v) => {
    expect(buildShareCardModel(baseInput({ churchName: v })).churchName).toBeNull();
  });

  it('slices metrics down to MAX_SHARE_METRICS', () => {
    const metrics = Array.from({ length: MAX_SHARE_METRICS + 5 }, (_, i) => ({ label: `M${i}`, value: `${i}` }));
    const model = buildShareCardModel(baseInput({ metrics }));
    expect(model.metrics).toHaveLength(MAX_SHARE_METRICS);
    expect(model.metrics).toEqual(metrics.slice(0, MAX_SHARE_METRICS));
  });

  it.each([
    ['A', '#57D77C'],
    ['B+', '#9AD05A'],
    ['C', '#F3CA5E'],
    ['F', '#F26D71'],
  ])('maps grade %s to a distinct accent', (grade, expected) => {
    expect(buildShareCardModel(baseInput({ grade })).accent).toBe(expected);
  });

  it('maps D to the same attention-red accent as F', () => {
    const d = buildShareCardModel(baseInput({ grade: 'D' })).accent;
    const f = buildShareCardModel(baseInput({ grade: 'F' })).accent;
    expect(d).toBe(f);
  });

  it('falls back to DEFAULT_ACCENT for an unrecognized grade', () => {
    const known = new Set(['#57D77C', '#9AD05A', '#F3CA5E', '#F26D71']);
    expect(known.has(buildShareCardModel(baseInput({ grade: 'Z' })).accent)).toBe(false);
  });

  it('falls back to DEFAULT_ACCENT for an empty grade string', () => {
    const known = new Set(['#57D77C', '#9AD05A', '#F3CA5E', '#F26D71']);
    expect(known.has(buildShareCardModel(baseInput({ grade: '' })).accent)).toBe(false);
  });
});

describe('shareCardDrawOps', () => {
  it('never emits an op containing the church name when the model omits it', () => {
    const model = buildShareCardModel(baseInput({ churchName: '' }));
    const ops = shareCardDrawOps(model);
    for (const op of ops) {
      if (op.kind === 'text') expect(op.text).not.toMatch(/church/i);
    }
  });

  it('includes the church name as its own text op when present', () => {
    const model = buildShareCardModel(baseInput({ churchName: 'Grace Chapel' }));
    const ops = shareCardDrawOps(model);
    expect(ops.some((op) => op.kind === 'text' && op.text === 'Grace Chapel')).toBe(true);
  });

  it('emits the wordmark op', () => {
    const model = buildShareCardModel(baseInput());
    const ops = shareCardDrawOps(model);
    expect(ops.some((op) => op.kind === 'text' && op.text === 'SOUND BUDDY')).toBe(true);
    expect(ops.some((op) => op.kind === 'text' && op.text === 'soundbuddy.app')).toBe(true);
  });

  it('produces a stable op count and order (with church name)', () => {
    const model = buildShareCardModel(baseInput({ churchName: 'Grace Chapel' }));
    const ops = shareCardDrawOps(model);
    // background rect, accent rect, grade circle, grade text, score text,
    // headline, 3 metrics, church name, wordmark, product line = 12
    expect(ops).toHaveLength(12);
    expect(ops.map((op) => op.kind)).toEqual([
      'rect', 'rect', 'circle', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
    ]);
  });

  it('produces one fewer op when the church name is omitted', () => {
    const model = buildShareCardModel(baseInput({ churchName: null }));
    expect(shareCardDrawOps(model)).toHaveLength(11);
  });

  it('keeps every coordinate within the card bounds', () => {
    const model = buildShareCardModel(baseInput({ churchName: 'Grace Chapel' }));
    const ops = shareCardDrawOps(model);
    for (const op of ops) {
      expect(op.x).toBeGreaterThanOrEqual(0 - EPSILON);
      expect(op.x).toBeLessThanOrEqual(SHARE_CARD_WIDTH + EPSILON);
      expect(op.y).toBeGreaterThanOrEqual(0 - EPSILON);
      expect(op.y).toBeLessThanOrEqual(SHARE_CARD_HEIGHT + EPSILON);
      if (op.kind === 'rect') {
        expect(op.x + op.w).toBeLessThanOrEqual(SHARE_CARD_WIDTH + EPSILON);
        expect(op.y + op.h).toBeLessThanOrEqual(SHARE_CARD_HEIGHT + EPSILON);
      }
      if (op.kind === 'circle') {
        expect(op.x - op.r).toBeGreaterThanOrEqual(0 - EPSILON);
        expect(op.x + op.r).toBeLessThanOrEqual(SHARE_CARD_WIDTH + EPSILON);
        expect(op.y - op.r).toBeGreaterThanOrEqual(0 - EPSILON);
        expect(op.y + op.r).toBeLessThanOrEqual(SHARE_CARD_HEIGHT + EPSILON);
      }
    }
  });

  it('stacks metric rows top to bottom with no duplicated y', () => {
    const model = buildShareCardModel(baseInput());
    const ops = shareCardDrawOps(model);
    const metricYs = ops
      .filter((op): op is Extract<DrawOp, { kind: 'text' }> => op.kind === 'text' && /dBFS|dB$/.test(op.text))
      .map((op) => op.y);
    expect(metricYs).toEqual([...metricYs].sort((a, b) => a - b));
    expect(new Set(metricYs).size).toBe(metricYs.length);
  });
});

// A recording fake satisfying CanvasLike — no `any`, no DOM.
function createRecordingCanvas() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const propWritesBeforeCall: Array<{ fillStyle: string; strokeStyle: string; font: string; textAlign: string }> = [];
  const ctx: CanvasLike = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    fillRect(x, y, w, h) {
      calls.push({ method: 'fillRect', args: [x, y, w, h] });
      propWritesBeforeCall.push({ fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, font: ctx.font, textAlign: ctx.textAlign });
    },
    fillText(text, x, y) {
      calls.push({ method: 'fillText', args: [text, x, y] });
      propWritesBeforeCall.push({ fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, font: ctx.font, textAlign: ctx.textAlign });
    },
    beginPath() {
      calls.push({ method: 'beginPath', args: [] });
    },
    arc(x, y, r, start, end) {
      calls.push({ method: 'arc', args: [x, y, r, start, end] });
    },
    stroke() {
      calls.push({ method: 'stroke', args: [] });
      propWritesBeforeCall.push({ fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, font: ctx.font, textAlign: ctx.textAlign });
    },
  };
  return { ctx, calls, propWritesBeforeCall };
}

describe('renderShareCard', () => {
  it('draws a rect op with fillRect, setting fillStyle first', () => {
    const { ctx, calls, propWritesBeforeCall } = createRecordingCanvas();
    const ops: DrawOp[] = [{ kind: 'rect', x: 1, y: 2, w: 3, h: 4, fill: '#111111' }];
    renderShareCard(ctx, ops);
    expect(calls).toEqual([{ method: 'fillRect', args: [1, 2, 3, 4] }]);
    expect(propWritesBeforeCall[0].fillStyle).toBe('#111111');
  });

  it('draws a text op with fillText, setting fillStyle/font/textAlign first', () => {
    const { ctx, calls, propWritesBeforeCall } = createRecordingCanvas();
    const ops: DrawOp[] = [{ kind: 'text', x: 5, y: 6, text: 'Hello', font: '10px sans', fill: '#abcabc', align: 'center' }];
    renderShareCard(ctx, ops);
    expect(calls).toEqual([{ method: 'fillText', args: ['Hello', 5, 6] }]);
    expect(propWritesBeforeCall[0]).toMatchObject({ fillStyle: '#abcabc', font: '10px sans', textAlign: 'center' });
  });

  it('draws a circle op with beginPath/arc/stroke, setting strokeStyle/lineWidth first', () => {
    const { ctx, calls, propWritesBeforeCall } = createRecordingCanvas();
    const ops: DrawOp[] = [{ kind: 'circle', x: 10, y: 20, r: 30, stroke: '#00ff00', lineWidth: 5 }];
    renderShareCard(ctx, ops);
    expect(calls.map((c) => c.method)).toEqual(['beginPath', 'arc', 'stroke']);
    expect(calls[1].args).toEqual([10, 20, 30, 0, Math.PI * 2]);
    // strokeStyle/lineWidth are set before beginPath/arc/stroke run, so the
    // recording made at stroke() time reflects them.
    expect(propWritesBeforeCall[0]).toMatchObject({ strokeStyle: '#00ff00' });
    expect(ctx.lineWidth).toBe(5);
  });

  it('renders a full op list end to end, covering every DrawOp kind', () => {
    const model = buildShareCardModel(baseInput({ churchName: 'Grace Chapel' }));
    const ops = shareCardDrawOps(model);
    const { ctx, calls } = createRecordingCanvas();
    renderShareCard(ctx, ops);
    expect(calls.some((c) => c.method === 'fillRect')).toBe(true);
    expect(calls.some((c) => c.method === 'fillText')).toBe(true);
    expect(calls.some((c) => c.method === 'arc')).toBe(true);
  });
});

describe('assertNoIdentifyingText', () => {
  const cleanOps: DrawOp[] = [
    { kind: 'text', x: 0, y: 0, text: 'A', font: '', fill: '', align: 'left' },
    { kind: 'text', x: 0, y: 0, text: '92/100', font: '', fill: '', align: 'left' },
  ];

  it('does not throw on a clean op list', () => {
    expect(() => assertNoIdentifyingText(cleanOps, ['My Mix.wav', '/Users/pat/My Mix.wav', ''])).not.toThrow();
  });

  it('throws when a text op leaks the source basename', () => {
    const ops: DrawOp[] = [...cleanOps, { kind: 'text', x: 0, y: 0, text: 'My Mix.wav', font: '', fill: '', align: 'left' }];
    expect(() => assertNoIdentifyingText(ops, ['My Mix.wav', '', ''])).toThrow(
      'Share export aborted: the image would contain "My Mix.wav". Clear the church name in Settings or report this as a bug.'
    );
  });

  it('throws when a text op leaks the full source path', () => {
    const ops: DrawOp[] = [...cleanOps, { kind: 'text', x: 0, y: 0, text: '/Users/pat/My Mix.wav', font: '', fill: '', align: 'left' }];
    expect(() => assertNoIdentifyingText(ops, ['', '/Users/pat/My Mix.wav', ''])).toThrow(/Share export aborted/);
  });

  it('matches case-insensitively', () => {
    const ops: DrawOp[] = [...cleanOps, { kind: 'text', x: 0, y: 0, text: 'GRACE CHAPEL', font: '', fill: '', align: 'left' }];
    expect(() => assertNoIdentifyingText(ops, ['grace chapel'])).toThrow(/Share export aborted/);
  });

  it('ignores empty and blank forbidden entries', () => {
    expect(() => assertNoIdentifyingText(cleanOps, ['', '   '])).not.toThrow();
  });
});

describe('buildShareFilename', () => {
  it('is deterministic for a given dateText', () => {
    expect(buildShareFilename('Jul 14, 2026')).toBe(buildShareFilename('Jul 14, 2026'));
    expect(buildShareFilename('Jul 14, 2026')).toBe('sound-buddy-grade-jul-14-2026.png');
  });

  it('falls back to a generic name for an empty dateText', () => {
    expect(buildShareFilename('')).toBe('sound-buddy-grade.png');
  });

  it('falls back to a generic name for punctuation-only input', () => {
    expect(buildShareFilename('!!! --- ???')).toBe('sound-buddy-grade.png');
  });

  it('never contains a path separator', () => {
    expect(buildShareFilename('a/b\\c')).not.toMatch(/[\\/]/);
  });
});
