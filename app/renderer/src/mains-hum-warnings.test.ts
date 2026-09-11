// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  createMainsHumTracker,
  advanceMainsHumTracker,
  mainsHumBadgeText,
  mainsHumWarningText,
  type MainsHumTracker,
} from './mains-hum-warnings';
import type { ChannelWindowData } from './live-capture-panel';
import { GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';

function nearestGridIndexToFrequency(targetHz: number): number {
  let bestIndex = 0;
  let bestDiff = Infinity;
  GRID_FREQS.forEach((f, i) => {
    const diff = Math.abs(f - targetHz);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  });
  return bestIndex;
}

const GRID_INDEX_NEAREST_50HZ = nearestGridIndexToFrequency(50);
const GRID_INDEX_NEAREST_60HZ = nearestGridIndexToFrequency(60);

function curveWithPeakAt(index: number): number[] {
  const db = new Array(GRID_FREQS.length).fill(-60);
  db[index] = -48;
  return db;
}

function channel(overrides: Partial<ChannelWindowData> & { index: number; name: string }): ChannelWindowData {
  return {
    bands: {},
    rms: -70,
    peak: -40,
    clipping: false,
    centroid: 0,
    rolloff: 0,
    ...overrides,
  };
}

describe('createMainsHumTracker', () => {
  it('returns an empty tracker', () => {
    expect(createMainsHumTracker()).toEqual({ eligibility: {}, warnings: {} });
  });
});

describe('advanceMainsHumTracker', () => {
  it('publishes a warning only for the qualifying channel after 3 consecutive windows (60 Hz)', () => {
    let tracker = createMainsHumTracker();
    for (let i = 0; i < 2; i++) {
      const channels = [
        channel({ index: 0, name: 'Ch 0', rms: -70 }),
        channel({ index: 1, name: 'Bass DI', rms: -70, curve: curveWithPeakAt(GRID_INDEX_NEAREST_60HZ) }),
      ];
      tracker = advanceMainsHumTracker(tracker, channels);
      expect(tracker.warnings).toEqual({});
    }

    const channels = [
      channel({ index: 0, name: 'Ch 0', rms: -70 }),
      channel({ index: 1, name: 'Bass DI', rms: -70, curve: curveWithPeakAt(GRID_INDEX_NEAREST_60HZ) }),
    ];
    tracker = advanceMainsHumTracker(tracker, channels);

    expect(tracker.warnings).toEqual({
      1: { channelIndex: 1, channelName: 'Bass DI', frequencyHz: 60 },
    });
  });

  it('publishes frequencyHz 50 for a 50 Hz peak', () => {
    let tracker = createMainsHumTracker();
    for (let i = 0; i < 3; i++) {
      const channels = [
        channel({ index: 0, name: 'Bass DI', rms: -70, curve: curveWithPeakAt(GRID_INDEX_NEAREST_50HZ) }),
      ];
      tracker = advanceMainsHumTracker(tracker, channels);
    }
    expect(tracker.warnings).toEqual({
      0: { channelIndex: 0, channelName: 'Bass DI', frequencyHz: 50 },
    });
  });

  it('clears the warning and resets eligibility once the channel carries program material', () => {
    let tracker = createMainsHumTracker();
    for (let i = 0; i < 3; i++) {
      const channels = [
        channel({ index: 0, name: 'Ch 0', rms: -70 }),
        channel({ index: 1, name: 'Bass DI', rms: -70, curve: curveWithPeakAt(GRID_INDEX_NEAREST_60HZ) }),
      ];
      tracker = advanceMainsHumTracker(tracker, channels);
    }
    expect(tracker.warnings[1]).toBeDefined();

    tracker = advanceMainsHumTracker(tracker, [
      channel({ index: 0, name: 'Ch 0', rms: -70 }),
      channel({ index: 1, name: 'Bass DI', rms: -20, curve: curveWithPeakAt(GRID_INDEX_NEAREST_60HZ) }),
    ]);

    expect(tracker.warnings[1]).toBeUndefined();
    expect(tracker.eligibility[1].consecutiveQualifyingWindows).toBe(0);
  });

  it('drops a channel entirely (eligibility and warning) once it is absent from a tick', () => {
    let tracker = createMainsHumTracker();
    for (let i = 0; i < 3; i++) {
      const channels = [
        channel({ index: 0, name: 'Ch 0', rms: -70 }),
        channel({ index: 1, name: 'Bass DI', rms: -70, curve: curveWithPeakAt(GRID_INDEX_NEAREST_60HZ) }),
      ];
      tracker = advanceMainsHumTracker(tracker, channels);
    }
    expect(tracker.warnings[1]).toBeDefined();

    tracker = advanceMainsHumTracker(tracker, [channel({ index: 0, name: 'Ch 0', rms: -70 })]);

    expect(tracker.warnings[1]).toBeUndefined();
    expect(tracker.eligibility[1]).toBeUndefined();
  });

  it('does not mutate the previous tracker', () => {
    const prev: MainsHumTracker = createMainsHumTracker();
    const snapshot = JSON.parse(JSON.stringify(prev));
    advanceMainsHumTracker(prev, [
      channel({ index: 0, name: 'Bass DI', rms: -70, curve: curveWithPeakAt(GRID_INDEX_NEAREST_60HZ) }),
    ]);
    expect(prev).toEqual(snapshot);
  });
});

describe('mainsHumBadgeText', () => {
  it('formats the frequency badge', () => {
    expect(mainsHumBadgeText(60)).toBe('60 Hz hum');
    expect(mainsHumBadgeText(50)).toBe('50 Hz hum');
  });
});

describe('mainsHumWarningText', () => {
  it('names the channel, the frequency, and tells the engineer what to check', () => {
    const text = mainsHumWarningText('Kick', 50);
    expect(text).toContain('Kick');
    expect(text).toContain('50 Hz');
    expect(text).toContain('check');
  });
});
