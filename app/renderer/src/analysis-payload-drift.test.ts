// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Boundary-relationship guard for the analyze-file seam (#748): shared's
// AnalysisPayload (the canonical contract) and api.ts's dependency-free
// AnalysisPayloadDto mirror must stay structurally identical. Lives under
// app/renderer/src because that is the only tree whose test files are compiled
// by a tsc gate (app/electron tests are excluded from app/tsconfig.json), so
// the type-level assertions below fail `cd app/renderer && npx tsc --noEmit`
// on drift — a change to one shape becomes a compile error here, not a silent
// regression. Same exception family as app/electron/parser-drift.test.ts.

import { describe, it, expect } from 'vitest';
import type { AnalysisPayload } from '@sound-buddy/shared';
import type { AnalysisPayloadDto } from '../../electron/ipc/api';

// One representative payload literal, the single source of truth for the
// runtime + both type-level assertions below.
const fixture = {
  filePath: '/tmp/take.wav',
  sox: {
    samplesRead: 441000,
    lengthSeconds: 10,
    scaledBy: 1,
    maximumAmplitude: 0.9,
    minimumAmplitude: -0.9,
    midlineAmplitude: 0,
    meanNorm: 0.2,
    meanAmplitude: 0.1,
    rmsAmplitude: 0.2,
    maximumDelta: 0.8,
    minimumDelta: 0,
    meanDelta: 0.1,
    rmsDelta: 0.15,
    roughFrequency: 440,
    volumeAdjustment: 0,
    rmsDbfs: -18,
    peakDbfs: -6,
    dynamicRangeDb: 12,
    clipping: false,
  },
  ffprobe: {
    format: {
      filename: '/tmp/take.wav',
      formatName: 'wav',
      formatLongName: 'WAV / WAVE (Waveform Audio)',
      durationSeconds: 10,
      sizeBytes: 441000,
      bitRate: 1411200,
      tags: {},
    },
    stream: {
      codecName: 'pcm_s16le',
      codecLongName: 'PCM signed 16-bit little-endian',
      channels: 1,
      channelLayout: 'mono',
      sampleRate: 44100,
      bitDepth: 16,
      bitRate: 705600,
      durationSeconds: 10,
    },
  },
  spectrum: {
    bands: {
      subBass: -30,
      bass: -22,
      lowMid: -18,
      mid: -16,
      highMid: -18,
      presence: -20,
      brilliance: -24,
    },
    spectralCentroid: 1200,
    spectralRolloff85: 4800,
    dynamicRange: 12,
  },
  loudness: { integratedLufs: -20, loudnessRange: 5, truePeakDbtp: -1 },
};

// The fixture must satisfy both shapes at compile time — a field added to one
// side and not the other fails here, before any test runs.
const shared: AnalysisPayload = fixture;
const dto: AnalysisPayloadDto = fixture;

// Bidirectional assignability (same idiom as api.contract.test.ts): `true`
// only when the extends-check holds, so a drift resolves these to `never` and
// breaks the `const ... = true` assignments.
type Forward = AnalysisPayload extends AnalysisPayloadDto ? true : never;
type Backward = AnalysisPayloadDto extends AnalysisPayload ? true : never;
const forward: Forward = true;
const backward: Backward = true;

describe('AnalysisPayload ↔ AnalysisPayloadDto drift guard (#748)', () => {
  it('the canonical shared contract and the api.ts DTO mirror are one wire shape', () => {
    expect(shared).toEqual(dto);
    expect(shared.filePath).toBe('/tmp/take.wav');
    expect(shared.spectrum.bands.subBass).toBe(-30);
    expect(shared.sox.rmsDbfs).toBe(-18);
    expect(shared.ffprobe.stream.channels).toBe(1);
    expect(shared.loudness?.integratedLufs).toBe(-20);
  });

  it('bidirectional type-level assignability holds (see compile-time assertions above)', () => {
    // The real assertion happened at compile time — a shape drift fails tsc
    // before the runner gets here. These values are only ever `true`.
    expect(forward).toBe(true);
    expect(backward).toBe(true);
  });
});
