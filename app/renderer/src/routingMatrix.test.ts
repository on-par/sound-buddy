// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import type { StripConfig } from './live-capture-panel';
import { routingMatrixView } from './routingMatrix';
import type { RouteState } from './stores/routeStore';

function routeState(outputChannels: number[][]): RouteState {
  return {
    tracks: outputChannels.map((channels) => ({ inputChannels: [], outputChannels: channels })),
    savedBuses: [],
    masterMixdown: false,
  };
}

describe('routingMatrixView', () => {
  it('enumerates bounded mono outputs and preserves track metadata', () => {
    const tracks: StripConfig[] = [
      { kind: 'mono', a: 0, b: 0, label: 'Lead Vocal' },
      { kind: 'mono', a: 1, b: 1 },
    ];

    const view = routingMatrixView(tracks, routeState([[2]]), 4);

    expect(view).toEqual([
      {
        trackIndex: 0,
        label: 'Lead Vocal',
        kind: 'mono',
        outputChannels: [2],
        outputChoices: [
          { channels: [0], label: 'Ch 1', selected: false },
          { channels: [1], label: 'Ch 2', selected: false },
          { channels: [2], label: 'Ch 3', selected: true },
          { channels: [3], label: 'Ch 4', selected: false },
        ],
      },
      {
        trackIndex: 1,
        label: 'Track 2',
        kind: 'mono',
        outputChannels: [],
        outputChoices: expect.any(Array),
      },
    ]);
    expect(view[1].outputChoices.map((choice) => choice.channels)).toEqual([[0], [1], [2], [3]]);
  });

  it('enumerates only adjacent stereo output pairs and selects the exact pair', () => {
    const view = routingMatrixView(
      [{ kind: 'stereo', a: 0, b: 1, label: 'Keys' }],
      routeState([[1, 2]]),
      4,
    );

    expect(view[0].outputChoices).toEqual([
      { channels: [0, 1], label: 'Ch 1-2', selected: false },
      { channels: [1, 2], label: 'Ch 2-3', selected: true },
      { channels: [2, 3], label: 'Ch 3-4', selected: false },
    ]);
    expect(view[0].outputChoices.every((choice) => choice.channels.length === 2)).toBe(true);
  });

  it('does not offer stereo output when the device has one channel', () => {
    const view = routingMatrixView(
      [{ kind: 'stereo', a: 0, b: 1 }],
      routeState([[0, 1]]),
      1,
    );

    expect(view[0].outputChoices).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    'offers no outputs for invalid device channel count %p',
    (deviceChannelCount) => {
      const view = routingMatrixView(
        [{ kind: 'mono', a: 0, b: 0 }, { kind: 'stereo', a: 1, b: 2 }],
        routeState([[0], [1, 2]]),
        deviceChannelCount,
      );

      expect(view.map((track) => track.outputChoices)).toEqual([[], []]);
    },
  );

  it('leaves malformed and out-of-range saved assignments unselected without mutating them', () => {
    const incomplete = [1];
    const malformed = [1, 3];
    const outOfRange = [4];
    const state = routeState([incomplete, malformed, outOfRange]);
    const view = routingMatrixView(
      [
        { kind: 'stereo', a: 0, b: 1 },
        { kind: 'stereo', a: 2, b: 3 },
        { kind: 'mono', a: 4, b: 4 },
      ],
      state,
      4,
    );

    expect(view[0].outputChannels).toEqual([1]);
    expect(view[1].outputChannels).toEqual([1, 3]);
    expect(view[2].outputChannels).toEqual([4]);
    expect(view.flatMap((track) => track.outputChoices).some((choice) => choice.selected)).toBe(false);
    expect(view.flatMap((track) => track.outputChoices).flatMap((choice) => choice.channels)).toEqual([
      0, 1, 1, 2, 2, 3, 0, 1, 1, 2, 2, 3, 0, 1, 2, 3,
    ]);
    expect(state.tracks[0].outputChannels).toBe(incomplete);
    expect(state.tracks[1].outputChannels).toBe(malformed);
    expect(state.tracks[2].outputChannels).toBe(outOfRange);
  });
});
