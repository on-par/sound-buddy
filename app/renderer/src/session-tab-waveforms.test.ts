// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { DAW_TIMELINE_PX_PER_SECOND, dawTimelineX } from './daw-shell-runtime';
import { paintSessionTabWaveformClips, sessionTabWaveformView } from './session-tab-waveforms';
import { createTimelineScale } from './timeline-scale';
import { waveformColumns } from './soundcheck-waveform';
import type { SessionPeaksDto } from '../../electron/ipc/api';
import type { SessionManifest } from './soundcheck-panel';
import type { StripConfig } from './live-capture-panel';

const pairData = btoa(String.fromCharCode(0, 255, 64, 192));

function manifest(): SessionManifest {
  return {
    tracks: [
      { kind: 'mono', sourceChannels: [4] },
      { kind: 'stereo', sourceChannels: [1, 2] },
    ],
  };
}

function peaks(): SessionPeaksDto {
  return {
    bucketsPerSecond: 2,
    tracks: [
      { index: 0, label: 'Vocal', kind: 'mono', bucketCount: 2, data: pairData },
      { index: 1, label: 'Keys', kind: 'stereo', bucketCount: 2, data: pairData },
    ],
  };
}

const config: StripConfig[] = [
  { kind: 'stereo', a: 1, b: 2, armed: false },
  { kind: 'mono', a: 4, b: 5, armed: true },
  { kind: 'mono', a: 8, b: 9, armed: false },
];

describe('sessionTabWaveformView', () => {
  it('maps reordered captured stems to matching configured strips at the shared origin and scale', () => {
    const cachedPeaks = peaks();
    const view = sessionTabWaveformView(
      manifest(),
      { ...cachedPeaks, tracks: [cachedPeaks.tracks[1], cachedPeaks.tracks[0]] },
      'ready',
      config,
    );

    expect(view.generating).toBe(false);
    expect(view.clips).toEqual([
      expect.objectContaining({ stripIndex: 1, trackIndex: 0, leftPx: dawTimelineX(0), widthPx: DAW_TIMELINE_PX_PER_SECOND }),
      expect.objectContaining({ stripIndex: 0, trackIndex: 1, leftPx: dawTimelineX(0), widthPx: DAW_TIMELINE_PX_PER_SECOND }),
    ]);
  });

  it('shows the generation state without clips while cached peaks are pending', () => {
    expect(sessionTabWaveformView(manifest(), null, 'generating', config)).toEqual({ generating: true, clips: [] });
  });

  it('returns an empty non-generating view without a loaded manifest or usable cache envelope', () => {
    expect(sessionTabWaveformView(null, peaks(), 'ready', config)).toEqual({ generating: false, clips: [] });
    expect(sessionTabWaveformView(manifest(), { ...peaks(), tracks: undefined as unknown as SessionPeaksDto['tracks'] }, 'ready', config)).toEqual({ generating: false, clips: [] });
    expect(sessionTabWaveformView(manifest(), { ...peaks(), bucketsPerSecond: Number.POSITIVE_INFINITY }, 'ready', config)).toEqual({ generating: false, clips: [] });
  });

  it('skips missing, malformed, non-positive-rate, unmatched, and ambiguous provenance rather than guessing', () => {
    expect(sessionTabWaveformView({ tracks: [{ kind: 'mono' }] }, peaks(), 'ready', config).clips).toEqual([]);
    expect(sessionTabWaveformView(manifest(), { ...peaks(), bucketsPerSecond: 0 }, 'ready', config).clips).toEqual([]);
    expect(sessionTabWaveformView(manifest(), { ...peaks(), tracks: [{ ...peaks().tracks[0], data: 'bad!' }] }, 'ready', config).clips).toEqual([]);
    expect(sessionTabWaveformView(manifest(), { ...peaks(), tracks: [null] as unknown as SessionPeaksDto['tracks'] }, 'ready', config).clips).toEqual([]);
    expect(sessionTabWaveformView({ tracks: [null] as unknown as SessionManifest['tracks'] }, peaks(), 'ready', config).clips).toEqual([]);
    expect(sessionTabWaveformView({ tracks: [{ kind: 'mono', sourceChannels: [99] }] }, peaks(), 'ready', config).clips).toEqual([]);
    expect(sessionTabWaveformView(
      { tracks: [{ kind: 'mono', sourceChannels: [4] }] },
      peaks(),
      'ready',
      [...config, { kind: 'mono', a: 4, b: 7 }],
    ).clips).toEqual([]);
  });

  it('rejects duplicate, out-of-range, and malformed cache indices before joining peak tracks', () => {
    const cachedPeaks = peaks();
    expect(sessionTabWaveformView(
      manifest(),
      { ...cachedPeaks, tracks: [{ ...cachedPeaks.tracks[0] }, { ...cachedPeaks.tracks[1], index: 0 }] },
      'ready',
      config,
    ).clips).toEqual([]);
    expect(sessionTabWaveformView(
      manifest(),
      { ...cachedPeaks, tracks: [{ ...cachedPeaks.tracks[0], index: 2 }] },
      'ready',
      config,
    ).clips).toEqual([]);
    expect(sessionTabWaveformView(
      manifest(),
      { ...cachedPeaks, tracks: [{ ...cachedPeaks.tracks[0], index: 0.5 }] },
      'ready',
      config,
    ).clips).toEqual([]);
    expect(sessionTabWaveformView(
      manifest(),
      { ...cachedPeaks, tracks: [cachedPeaks.tracks[0]] },
      'ready',
      config,
    ).clips).toEqual([
      expect.objectContaining({ trackIndex: 0, stripIndex: 1 }),
    ]);
  });

  it('skips cache tracks whose declared bucket count is invalid or disagrees with decoded pairs', () => {
    const cachedPeaks = peaks();
    for (const bucketCount of [undefined, -1, 1.5, 3]) {
      expect(sessionTabWaveformView(
        manifest(),
        { ...cachedPeaks, tracks: [{ ...cachedPeaks.tracks[0], bucketCount }] as unknown as SessionPeaksDto['tracks'] },
        'ready',
        config,
      ).clips).toEqual([]);
    }
  });

  it('rejects every clip that competes for the same configured strip', () => {
    const cachedPeaks = peaks();
    const duplicateManifest: SessionManifest = {
      tracks: [
        { kind: 'mono', sourceChannels: [4] },
        { kind: 'mono', sourceChannels: [4] },
      ],
    };
    const duplicatePeaks: SessionPeaksDto = {
      ...cachedPeaks,
      tracks: [
        cachedPeaks.tracks[0],
        { ...cachedPeaks.tracks[0], index: 1 },
      ],
    };

    expect(sessionTabWaveformView(duplicateManifest, duplicatePeaks, 'ready', config).clips).toEqual([]);
  });

  it('derives clip width and left from the injected shared scale at every zoom state', () => {
    const cases = [
      createTimelineScale('fit', { durationSecs: 1, viewportWidthPx: 20 }),
      createTimelineScale('default'),
      createTimelineScale('zoomed-in'),
      createTimelineScale('zoomed-out'),
    ];
    const widths: number[] = [];
    for (const scale of cases) {
      const [clip] = sessionTabWaveformView(manifest(), peaks(), 'ready', config, scale).clips;
      const endSecs = clip.pairs.length / clip.bucketsPerSecond;
      expect(clip.leftPx).toBe(scale.timeToX(0));
      expect(clip.widthPx).toBeCloseTo(scale.timeToX(endSecs) - scale.timeToX(0));
      expect(clip.pxPerSecond).toBe(scale.pxPerSecond);
      widths.push(clip.widthPx);
    }
    expect(new Set(widths).size).toBe(4);
  });

  it('defaults to the fixed scale so pre-existing callers get byte-identical geometry', () => {
    expect(sessionTabWaveformView(manifest(), peaks(), 'ready', config, createTimelineScale('default')))
      .toEqual(sessionTabWaveformView(manifest(), peaks(), 'ready', config));

    const [clip] = sessionTabWaveformView(manifest(), peaks(), 'ready', config).clips;
    expect(clip.leftPx).toBe(dawTimelineX(0));
    expect(clip.widthPx).toBe(DAW_TIMELINE_PX_PER_SECOND);
    expect(clip.pxPerSecond).toBe(DAW_TIMELINE_PX_PER_SECOND);
  });
});

describe('paintSessionTabWaveformClips', () => {
  it('sizes emitted canvases and draws aggregated cached peaks through the canonical painter', () => {
    const ctx = {
      strokeStyle: '', lineWidth: 0,
      clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    };
    const canvas = {
      width: 0, height: 0,
      getBoundingClientRect: () => ({ width: 8, height: 24 }),
      getContext: () => ctx,
    };
    const root = { querySelector: () => canvas };
    const [clip] = sessionTabWaveformView(manifest(), peaks(), 'ready', config).clips;

    paintSessionTabWaveformClips(root as unknown as ParentNode, [clip]);

    expect(canvas.width).toBe(8);
    expect(canvas.height).toBe(24);
    expect(ctx.strokeStyle).toBe('#565D6B');
    expect(ctx.lineWidth).toBe(1);
  });

  it('ignores absent or non-canvas nodes and clamps non-positive canvas dimensions', () => {
    const [clip] = sessionTabWaveformView(manifest(), peaks(), 'ready', config).clips;
    const missingRoot = { querySelector: () => null };
    expect(() => paintSessionTabWaveformClips(missingRoot as unknown as ParentNode, [clip])).not.toThrow();

    const canvas = {
      width: 1, height: 1,
      getBoundingClientRect: () => ({ width: -1, height: 0 }),
      getContext: () => null,
    };
    const root = { querySelector: () => canvas };
    paintSessionTabWaveformClips(root as unknown as ParentNode, [clip]);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  function recordingCanvas(widthPx: number) {
    const strokes: Array<{ x: number; yTop: number; yBottom: number }> = [];
    let pending = { x: 0, yTop: 0 };
    const ctx = {
      strokeStyle: '', lineWidth: 0,
      clearRect: () => {}, beginPath: () => {},
      moveTo: (x: number, y: number) => { pending = { x, yTop: y }; },
      lineTo: (_x: number, y: number) => { strokes.push({ ...pending, yBottom: y }); },
      stroke: () => {},
    };
    return {
      strokes,
      canvas: { width: 0, height: 0, getBoundingClientRect: () => ({ width: widthPx, height: 24 }), getContext: () => ctx },
    };
  }

  it('aggregates painted columns at the clip\'s own carried scale, not a module constant', () => {
    const fourBucketManifest: SessionManifest = { tracks: [{ kind: 'mono', sourceChannels: [4] }] };
    const fourBucketData = btoa(String.fromCharCode(0, 255, 64, 192, 255, 0, 32, 96));
    const fourBucketPeaks: SessionPeaksDto = {
      bucketsPerSecond: 2,
      tracks: [{ index: 0, label: 'Vocal', kind: 'mono', bucketCount: 4, data: fourBucketData }],
    };

    const strokeCounts: number[] = [];
    for (const state of ['default', 'zoomed-out'] as const) {
      const scale = createTimelineScale(state);
      const [clip] = sessionTabWaveformView(fourBucketManifest, fourBucketPeaks, 'ready', config, scale).clips;
      const { strokes, canvas } = recordingCanvas(8);
      const root = { querySelector: () => canvas };

      paintSessionTabWaveformClips(root as unknown as ParentNode, [clip]);

      const expected = waveformColumns(clip.pairs, clip.bucketsPerSecond, clip.pxPerSecond, 8);
      expect(strokes.map((s) => s.x)).toEqual(expected.map((_, x) => x + 0.5));
      expected.forEach((column, x) => {
        expect(strokes[x].yTop).toBeCloseTo(12 - column.max * 12);
      });
      expect(strokes.length).toBeLessThanOrEqual(Math.ceil(clip.widthPx));
      strokeCounts.push(strokes.length);
    }
    expect(strokeCounts[0]).not.toBe(strokeCounts[1]);
  });
});
