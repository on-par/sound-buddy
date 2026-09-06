// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { resolvePlayheadInstant } from './playhead-instant';

describe('resolvePlayheadInstant', () => {
  it('an advancing record clock wins over an ACTIVE playback position', () => {
    expect(
      resolvePlayheadInstant({
        playbackPosition: { elapsed: 3, duration: 60 },
        playbackActive: true,
        recordAdvancing: true,
        recordElapsedMs: 10_000,
      })
    ).toEqual({ elapsedMs: 10_000, advancing: true, source: 'record' });
  });

  it('an advancing record clock wins over a FROZEN, just-loaded take position', () => {
    expect(
      resolvePlayheadInstant({
        playbackPosition: { elapsed: 0, duration: 0 },
        playbackActive: false,
        recordAdvancing: true,
        recordElapsedMs: 7_500,
      })
    ).toEqual({ elapsedMs: 7_500, advancing: true, source: 'record' });
  });

  it('with no recording advancing, an active playback position wins and converts seconds to ms', () => {
    expect(
      resolvePlayheadInstant({
        playbackPosition: { elapsed: 12.5, duration: 60 },
        playbackActive: true,
        recordAdvancing: false,
        recordElapsedMs: 10_000,
      })
    ).toEqual({ elapsedMs: 12_500, advancing: true, source: 'playback' });
  });

  it('with no recording advancing, an inactive playback position still wins but is not advancing', () => {
    expect(
      resolvePlayheadInstant({
        playbackPosition: { elapsed: 12.5, duration: 60 },
        playbackActive: false,
        recordAdvancing: false,
        recordElapsedMs: 10_000,
      })
    ).toEqual({ elapsedMs: 12_500, advancing: false, source: 'playback' });
  });

  it('with no playback position and no recording advancing, the frozen wall clock is returned and is not advancing', () => {
    expect(
      resolvePlayheadInstant({
        playbackPosition: null,
        playbackActive: false,
        recordAdvancing: false,
        recordElapsedMs: 4_000,
      })
    ).toEqual({ elapsedMs: 4_000, advancing: false, source: 'record' });
  });

  it('a non-finite recordElapsedMs resolves to 0ms, not NaN', () => {
    expect(
      resolvePlayheadInstant({
        playbackPosition: null,
        playbackActive: false,
        recordAdvancing: true,
        recordElapsedMs: Number.NaN,
      })
    ).toEqual({ elapsedMs: 0, advancing: true, source: 'record' });
  });

  it('a non-finite playbackPosition.elapsed resolves to 0ms, not NaN or Infinity', () => {
    expect(
      resolvePlayheadInstant({
        playbackPosition: { elapsed: Number.POSITIVE_INFINITY, duration: 60 },
        playbackActive: true,
        recordAdvancing: false,
        recordElapsedMs: 10_000,
      })
    ).toEqual({ elapsedMs: 0, advancing: true, source: 'playback' });
  });
});
