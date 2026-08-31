// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import {
  createLoopRegionModel,
  normalizeLoopRegion,
  sessionLoopRegion,
  DEFAULT_LOOP_START_SECS,
  DEFAULT_LOOP_LENGTH_SECS,
} from './loopBrace.render';

describe('normalizeLoopRegion', () => {
  it('returns an ascending pair as-is', () => {
    expect(normalizeLoopRegion(2, 6)).toEqual({ startSecs: 2, endSecs: 6 });
  });

  it('orders a right-to-left pair', () => {
    expect(normalizeLoopRegion(8, 4)).toEqual({ startSecs: 4, endSecs: 8 });
  });

  it('clamps a negative endpoint to 0', () => {
    expect(normalizeLoopRegion(-5, 4)).toEqual({ startSecs: 0, endSecs: 4 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns null when one endpoint is %p',
    (bad) => {
      expect(normalizeLoopRegion(bad, 4)).toBeNull();
      expect(normalizeLoopRegion(4, bad)).toBeNull();
    },
  );

  it('returns null for an equal pair', () => {
    expect(normalizeLoopRegion(5, 5)).toBeNull();
  });

  it('returns null for (-3, -1) — both clamp to 0, a degenerate range', () => {
    expect(normalizeLoopRegion(-3, -1)).toBeNull();
  });

  it('returns a frozen object', () => {
    const region = normalizeLoopRegion(1, 2);
    expect(region).not.toBeNull();
    expect(Object.isFrozen(region)).toBe(true);
  });
});

describe('createLoopRegionModel', () => {
  it('getRegion() defaults to {0, 10}', () => {
    const model = createLoopRegionModel();
    expect(model.getRegion()).toEqual({ startSecs: DEFAULT_LOOP_START_SECS, endSecs: DEFAULT_LOOP_LENGTH_SECS });
  });

  it('setRegion(8, 4) stores {4, 8} and notifies once', () => {
    const model = createLoopRegionModel();
    const listener = vi.fn();
    model.subscribe(listener);
    expect(model.setRegion(8, 4)).toEqual({ startSecs: 4, endSecs: 8 });
    expect(model.getRegion()).toEqual({ startSecs: 4, endSecs: 8 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ startSecs: 4, endSecs: 8 });
  });

  it('a repeat setRegion with the same values notifies nothing', () => {
    const model = createLoopRegionModel();
    model.setRegion(4, 8);
    const listener = vi.fn();
    model.subscribe(listener);
    model.setRegion(4, 8);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setRegion(5, 5) leaves the region untouched and notifies nothing', () => {
    const model = createLoopRegionModel();
    const before = model.getRegion();
    const listener = vi.fn();
    model.subscribe(listener);
    expect(model.setRegion(5, 5)).toEqual(before);
    expect(model.getRegion()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setRegion(NaN, 3) leaves the region untouched and notifies nothing', () => {
    const model = createLoopRegionModel();
    const before = model.getRegion();
    const listener = vi.fn();
    model.subscribe(listener);
    expect(model.setRegion(Number.NaN, 3)).toEqual(before);
    expect(model.getRegion()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('resetForSession() restores the default and notifies', () => {
    const model = createLoopRegionModel();
    model.setRegion(20, 30);
    const listener = vi.fn();
    model.subscribe(listener);
    expect(model.resetForSession()).toEqual({ startSecs: DEFAULT_LOOP_START_SECS, endSecs: DEFAULT_LOOP_LENGTH_SECS });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resetForSession() notifies nothing when already at the default', () => {
    const model = createLoopRegionModel();
    const listener = vi.fn();
    model.subscribe(listener);
    model.resetForSession();
    expect(listener).not.toHaveBeenCalled();
  });

  it('the returned unsubscribe stops further notifications', () => {
    const model = createLoopRegionModel();
    const listener = vi.fn();
    const unsubscribe = model.subscribe(listener);
    unsubscribe();
    model.setRegion(2, 6);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('sessionLoopRegion', () => {
  it('is a shared LoopRegionModel instance exposing the default region', () => {
    expect(sessionLoopRegion.resetForSession()).toEqual({ startSecs: DEFAULT_LOOP_START_SECS, endSecs: DEFAULT_LOOP_LENGTH_SECS });
    expect(sessionLoopRegion.getRegion()).toEqual({ startSecs: DEFAULT_LOOP_START_SECS, endSecs: DEFAULT_LOOP_LENGTH_SECS });
  });
});
