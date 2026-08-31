// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { loopBraceVisible, defaultLoopRegionFor, seedLoopRegionOnToggle } from './loopToggle';
import { createLoopRegionModel } from './loopBrace.render';

describe('loopBraceVisible', () => {
  it('is true when available and looping are both true', () => {
    expect(loopBraceVisible({ available: true, looping: true })).toBe(true);
  });

  it('is false when looping is false', () => {
    expect(loopBraceVisible({ available: true, looping: false })).toBe(false);
  });

  it('is false when available is false', () => {
    expect(loopBraceVisible({ available: false, looping: true })).toBe(false);
  });

  it('is false for null', () => {
    expect(loopBraceVisible(null)).toBe(false);
  });

  it('is false for undefined', () => {
    expect(loopBraceVisible(undefined)).toBe(false);
  });
});

describe('defaultLoopRegionFor', () => {
  it.each([null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    '%p yields {0, 10}',
    (durationSecs) => {
      expect(defaultLoopRegionFor(durationSecs)).toEqual({ startSecs: 0, endSecs: 10 });
    },
  );

  it('a take shorter than 10s clamps the default to the take duration', () => {
    expect(defaultLoopRegionFor(4)).toEqual({ startSecs: 0, endSecs: 4 });
  });

  it('a take longer than 10s still yields {0, 10}', () => {
    expect(defaultLoopRegionFor(25)).toEqual({ startSecs: 0, endSecs: 10 });
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(defaultLoopRegionFor(4))).toBe(true);
  });
});

describe('seedLoopRegionOnToggle', () => {
  it('a press with looping:false on a fresh model seeds the default for the given duration', () => {
    const model = createLoopRegionModel();
    seedLoopRegionOnToggle(model, { available: true, looping: false }, 4);
    expect(model.getRegion()).toEqual({ startSecs: 0, endSecs: 4 });
  });

  it('a second press leaves the seeded range in place regardless of the new duration', () => {
    const model = createLoopRegionModel();
    seedLoopRegionOnToggle(model, { available: true, looping: false }, 4);
    seedLoopRegionOnToggle(model, { available: true, looping: false }, 30);
    expect(model.getRegion()).toEqual({ startSecs: 0, endSecs: 4 });
  });

  it('a press with looping:true (turning looping OFF) changes nothing', () => {
    const model = createLoopRegionModel();
    const before = model.getRegion();
    seedLoopRegionOnToggle(model, { available: true, looping: true }, 4);
    expect(model.getRegion()).toEqual(before);
  });

  it('a press with available:false changes nothing', () => {
    const model = createLoopRegionModel();
    const before = model.getRegion();
    seedLoopRegionOnToggle(model, { available: false, looping: false }, 4);
    expect(model.getRegion()).toEqual(before);
  });

  it('a model whose setRegion was already called keeps its user-set range', () => {
    const model = createLoopRegionModel();
    model.setRegion(20, 30);
    seedLoopRegionOnToggle(model, { available: true, looping: false }, 4);
    expect(model.getRegion()).toEqual({ startSecs: 20, endSecs: 30 });
  });
});
