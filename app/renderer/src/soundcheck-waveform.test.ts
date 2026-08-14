// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Unit tests for soundcheck-waveform.ts (story 3, #735): the pure decoder,
// shared-timeline model, per-column aggregation, and canvas draw. Builds
// base64 vectors with Buffer (node env) and exercises the draw with a
// recording fake implementing WaveformCanvasLike — no DOM, no `any`.

import { describe, it, expect } from 'vitest';
import {
  decodePeaksPairs,
  sessionPeakTimeline,
  waveformColumns,
  drawSoundcheckWaveform,
  WAVEFORM_LANE_HEX,
  type WaveformCanvasLike,
} from './soundcheck-waveform';
import type { SessionPeaksDto } from '../../electron/ipc/api';

function b64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

function peaks(tracks: Array<{ index: number; label: string; kind: 'mono' | 'stereo'; data: string }>, bucketsPerSecond = 50): SessionPeaksDto {
  return {
    bucketsPerSecond,
    tracks: tracks.map((t) => ({ ...t, bucketCount: Buffer.from(t.data, 'base64').length / 2 })),
  };
}

class RecordingCtx implements WaveformCanvasLike {
  strokeStyle = '';
  lineWidth = 0;
  clearRectCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
  moves: Array<{ x: number; y: number }> = [];
  lines: Array<{ x: number; y: number }> = [];
  strokes = 0;

  clearRect(x: number, y: number, w: number, h: number): void {
    this.clearRectCalls.push({ x, y, w, h });
  }
  beginPath(): void {}
  moveTo(x: number, y: number): void {
    this.moves.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.lines.push({ x, y });
  }
  stroke(): void {
    this.strokes++;
  }
}

describe('decodePeaksPairs', () => {
  it('decodes a known vector into min/max pairs in [-1, 1]', () => {
    // bytes [0, 255] -> one pair {-1, 1}.
    expect(decodePeaksPairs(b64([0, 255]))).toEqual([{ min: -1, max: 1 }]);
  });

  it('decodes several pairs with exact integer-safe math', () => {
    // bytes [255, 0, 128, 128] -> pairs {1, -1} and {1/255, 1/255}.
    const pairs = decodePeaksPairs(b64([255, 0, 128, 128]))!;
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ min: 1, max: -1 });
    expect(pairs[1].min).toBeCloseTo((128 / 255) * 2 - 1, 10);
    expect(pairs[1].max).toBeCloseTo((128 / 255) * 2 - 1, 10);
  });

  it('returns null for an empty string', () => {
    expect(decodePeaksPairs('')).toBeNull();
  });

  it('returns null for non-base64 input', () => {
    expect(decodePeaksPairs('!!')).toBeNull();
  });

  it('returns null for an odd byte length (truncated pair)', () => {
    expect(decodePeaksPairs('AA==')).toBeNull();
  });

  it('returns null for a non-string value', () => {
    expect(decodePeaksPairs(123 as unknown as string)).toBeNull();
  });
});

describe('sessionPeakTimeline', () => {
  it('returns null when peaks is null', () => {
    expect(sessionPeakTimeline(null)).toBeNull();
  });

  it('returns null when tracks is empty', () => {
    expect(sessionPeakTimeline({ bucketsPerSecond: 50, tracks: [] })).toBeNull();
  });

  it('returns null when tracks is not an array', () => {
    expect(sessionPeakTimeline({ bucketsPerSecond: 50, tracks: undefined as unknown as SessionPeaksDto['tracks'] })).toBeNull();
  });

  it('returns null when bucketsPerSecond is zero', () => {
    expect(sessionPeakTimeline(peaks([{ index: 0, label: 'Kick', kind: 'mono', data: b64([0, 255]) }], 0))).toBeNull();
  });

  it('returns null when bucketsPerSecond is non-finite', () => {
    const doc = peaks([{ index: 0, label: 'Kick', kind: 'mono', data: b64([0, 255]) }]);
    expect(sessionPeakTimeline({ ...doc, bucketsPerSecond: NaN })).toBeNull();
    expect(sessionPeakTimeline({ ...doc, bucketsPerSecond: Infinity })).toBeNull();
  });

  it('builds one lane per track for a mono + stereo mix, preserving kind', () => {
    const doc = peaks([
      { index: 0, label: 'Kick', kind: 'mono', data: b64([0, 255, 64, 192]) },
      { index: 1, label: 'OH', kind: 'stereo', data: b64([32, 224]) },
    ]);
    const timeline = sessionPeakTimeline(doc)!;
    expect(timeline.lanes).toHaveLength(2);
    expect(timeline.lanes[0]).toEqual({ index: 0, label: 'Kick', kind: 'mono', pairs: [
      { min: -1, max: 1 },
      { min: (64 / 255) * 2 - 1, max: (192 / 255) * 2 - 1 },
    ] });
    expect(timeline.lanes[1]).toEqual({ index: 1, label: 'OH', kind: 'stereo', pairs: [
      { min: (32 / 255) * 2 - 1, max: (224 / 255) * 2 - 1 },
    ] });
    expect(timeline.bucketsPerSecond).toBe(50);
  });

  it('sessionDurationSecs is the longest decoded track over bucketsPerSecond', () => {
    const doc = peaks([
      { index: 0, label: 'Short', kind: 'mono', data: b64([0, 255]) },
      { index: 1, label: 'Long', kind: 'stereo', data: b64([0, 255, 64, 192, 32, 224]) },
    ]);
    const timeline = sessionPeakTimeline(doc)!;
    expect(timeline.lanes[1].pairs).toHaveLength(3);
    expect(timeline.sessionDurationSecs).toBeCloseTo(3 / 50, 10);
  });

  it('skips a malformed lane while keeping the other lanes', () => {
    const doc = peaks([
      { index: 0, label: 'Kick', kind: 'mono', data: b64([0, 255]) },
      { index: 1, label: 'Bad', kind: 'stereo', data: '!!' },
      { index: 2, label: 'OH', kind: 'stereo', data: b64([32, 224]) },
    ]);
    const timeline = sessionPeakTimeline(doc)!;
    expect(timeline.lanes).toHaveLength(2);
    expect(timeline.lanes.map((l) => l.label)).toEqual(['Kick', 'OH']);
  });

  it('returns null when every lane is malformed', () => {
    const doc = peaks([
      { index: 0, label: 'Bad', kind: 'mono', data: '!!' },
      { index: 1, label: 'Empty', kind: 'stereo', data: '' },
    ]);
    expect(sessionPeakTimeline(doc)).toBeNull();
  });
});

describe('waveformColumns', () => {
  it('returns [] for empty pairs', () => {
    expect(waveformColumns([], 50, 10, 400)).toEqual([]);
  });

  it('returns [] for a non-positive widthPx', () => {
    expect(waveformColumns([{ min: -1, max: 1 }], 50, 10, 0)).toEqual([]);
    expect(waveformColumns([{ min: -1, max: 1 }], 50, 10, -5)).toEqual([]);
  });

  it('returns [] for a non-positive pxPerSecond', () => {
    expect(waveformColumns([{ min: -1, max: 1 }], 50, 0, 400)).toEqual([]);
    expect(waveformColumns([{ min: -1, max: 1 }], 50, -2, 400)).toEqual([]);
  });

  it('aggregates min-of-mins / max-of-maxes across several buckets per column', () => {
    const pairs = [
      { min: 0.1, max: 0.2 },
      { min: -0.5, max: 0.05 },
      { min: 0.0, max: 0.9 },
      { min: -0.9, max: 0.0 },
    ];
    const cols = waveformColumns(pairs, 4, 1, 2);
    expect(cols).toHaveLength(1);
    expect(cols[0].min).toBeCloseTo(-0.9, 5);
    expect(cols[0].max).toBeCloseTo(0.9, 5);
  });

  it('bounds the column count by widthPx and ends early for a short track', () => {
    const pairs = [
      { min: -0.5, max: 0.5 },
      { min: -0.4, max: 0.4 },
      { min: -0.3, max: 0.3 },
    ];
    expect(waveformColumns(pairs, 1, 1, 10)).toEqual(pairs);
    expect(waveformColumns(pairs, 1, 1, 2)).toHaveLength(2);
  });

  it('aligns fractional bucket-per-px boundaries to the expected column extents', () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({ min: -i, max: i }));
    const cols = waveformColumns(pairs, 10, 7, 100);
    // bucketsPerPx = 10/7: column 0 covers buckets [0, 2), column 1 covers [1, 3).
    expect(cols[0]).toEqual({ min: -1, max: 1 });
    expect(cols[1]).toEqual({ min: -2, max: 2 });
    // Last column ends at the last bucket, not at the full width.
    expect(cols.length).toBeLessThan(100);
    expect(cols[cols.length - 1]).toEqual({ min: -9, max: 9 });
  });
});

describe('drawSoundcheckWaveform', () => {
  it('sets stroke style/line width and draws one vertical line per column', () => {
    const ctx = new RecordingCtx();
    drawSoundcheckWaveform(ctx, [
      { min: -0.5, max: 0.5 },
      { min: -0.2, max: 0.8 },
    ], 1, 1, 2, 100);
    expect(ctx.strokeStyle).toBe(WAVEFORM_LANE_HEX);
    expect(ctx.lineWidth).toBe(1);
    expect(ctx.clearRectCalls).toEqual([{ x: 0, y: 0, w: 2, h: 100 }]);
    expect(ctx.strokes).toBe(2);
    expect(ctx.moves).toHaveLength(2);
    expect(ctx.lines).toHaveLength(2);
    // Column x is stroked at x + 0.5 so the 1px line lands on the pixel.
    expect(ctx.moves[0].x).toBeCloseTo(0.5, 5);
    expect(ctx.lines[0].x).toBeCloseTo(0.5, 5);
    expect(ctx.moves[1].x).toBeCloseTo(1.5, 5);
    // midY = 50; col0 {min:-0.5,max:0.5} -> yTop=25, yBottom=75.
    expect(ctx.moves[0].y).toBeCloseTo(25, 5);
    expect(ctx.lines[0].y).toBeCloseTo(75, 5);
  });

  it('draws a min 1px-tall hairline for an all-silence lane', () => {
    const ctx = new RecordingCtx();
    const pairs = Array.from({ length: 4 }, () => ({ min: 0, max: 0 }));
    drawSoundcheckWaveform(ctx, pairs, 2, 2, 2, 100);
    expect(ctx.strokes).toBe(2);
    for (let i = 0; i < ctx.moves.length; i++) {
      expect(ctx.lines[i].y - ctx.moves[i].y).toBeGreaterThanOrEqual(1);
    }
  });

  it('clearRects but draws nothing for a zero-width canvas', () => {
    const ctx = new RecordingCtx();
    drawSoundcheckWaveform(ctx, [{ min: -1, max: 1 }], 1, 1, 0, 100);
    expect(ctx.clearRectCalls).toHaveLength(1);
    expect(ctx.strokes).toBe(0);
  });

  it('clearRects but draws nothing for a zero-height canvas', () => {
    const ctx = new RecordingCtx();
    drawSoundcheckWaveform(ctx, [{ min: -1, max: 1 }], 1, 1, 100, 0);
    expect(ctx.clearRectCalls).toHaveLength(1);
    expect(ctx.strokes).toBe(0);
  });

  it('clearRects but draws nothing for empty pairs', () => {
    const ctx = new RecordingCtx();
    drawSoundcheckWaveform(ctx, [], 1, 1, 100, 100);
    expect(ctx.clearRectCalls).toHaveLength(1);
    expect(ctx.strokes).toBe(0);
  });
});
