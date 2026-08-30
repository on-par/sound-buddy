// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import {
  TIMELINE_DEFAULT_BPM,
  TIMELINE_MIN_BPM,
  TIMELINE_MAX_BPM,
  clampTimelineBpm,
  createTimelineTempo,
  withTimelineBpm,
} from './timeline-bpm';

describe('clampTimelineBpm', () => {
  it('returns an in-range value unchanged', () => {
    expect(clampTimelineBpm(90)).toBe(90);
  });

  it('returns an in-range fractional value unchanged', () => {
    expect(clampTimelineBpm(128.5)).toBe(128.5);
  });

  it('clamps an above-range request to TIMELINE_MAX_BPM', () => {
    expect(clampTimelineBpm(1000)).toBe(TIMELINE_MAX_BPM);
  });

  it('clamps a below-range request to TIMELINE_MIN_BPM', () => {
    expect(clampTimelineBpm(5)).toBe(TIMELINE_MIN_BPM);
  });

  it('clamps 0 to TIMELINE_MIN_BPM', () => {
    expect(clampTimelineBpm(0)).toBe(TIMELINE_MIN_BPM);
  });

  it('clamps a negative request to TIMELINE_MIN_BPM', () => {
    expect(clampTimelineBpm(-40)).toBe(TIMELINE_MIN_BPM);
  });

  it('returns TIMELINE_DEFAULT_BPM for NaN', () => {
    expect(clampTimelineBpm(NaN)).toBe(TIMELINE_DEFAULT_BPM);
  });

  it('returns TIMELINE_DEFAULT_BPM for Number.POSITIVE_INFINITY', () => {
    expect(clampTimelineBpm(Number.POSITIVE_INFINITY)).toBe(TIMELINE_DEFAULT_BPM);
  });

  it('returns TIMELINE_DEFAULT_BPM for Number.NEGATIVE_INFINITY', () => {
    expect(clampTimelineBpm(Number.NEGATIVE_INFINITY)).toBe(TIMELINE_DEFAULT_BPM);
  });

  it('returns the min bound unchanged', () => {
    expect(clampTimelineBpm(TIMELINE_MIN_BPM)).toBe(TIMELINE_MIN_BPM);
  });

  it('returns the max bound unchanged', () => {
    expect(clampTimelineBpm(TIMELINE_MAX_BPM)).toBe(TIMELINE_MAX_BPM);
  });

  it('keeps the default inside the bounds', () => {
    expect(TIMELINE_DEFAULT_BPM).toBeGreaterThanOrEqual(TIMELINE_MIN_BPM);
    expect(TIMELINE_DEFAULT_BPM).toBeLessThanOrEqual(TIMELINE_MAX_BPM);
  });
});

describe('createTimelineTempo', () => {
  it('defaults to TIMELINE_DEFAULT_BPM when called with no argument', () => {
    expect(createTimelineTempo().bpm).toBe(TIMELINE_DEFAULT_BPM);
  });

  it('defaults to TIMELINE_DEFAULT_BPM when explicitly passed undefined', () => {
    expect(createTimelineTempo(undefined).bpm).toBe(TIMELINE_DEFAULT_BPM);
  });

  it('stores an in-range argument as-is', () => {
    expect(createTimelineTempo(100).bpm).toBe(100);
  });

  it('clamps an out-of-range argument to the nearest bound', () => {
    expect(createTimelineTempo(9999).bpm).toBe(TIMELINE_MAX_BPM);
  });

  it('falls back to the default for NaN', () => {
    expect(createTimelineTempo(NaN).bpm).toBe(TIMELINE_DEFAULT_BPM);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(createTimelineTempo())).toBe(true);
  });
});

describe('withTimelineBpm', () => {
  it('stores an in-range set and returns a new object', () => {
    const tempo = createTimelineTempo();
    const next = withTimelineBpm(tempo, 140);
    expect(next.bpm).toBe(140);
    expect(next).not.toBe(tempo);
  });

  it('stores TIMELINE_MAX_BPM for an above-range set', () => {
    const tempo = createTimelineTempo();
    expect(withTimelineBpm(tempo, 9999).bpm).toBe(TIMELINE_MAX_BPM);
  });

  it('stores TIMELINE_MIN_BPM for a below-range set', () => {
    const tempo = createTimelineTempo();
    expect(withTimelineBpm(tempo, -10).bpm).toBe(TIMELINE_MIN_BPM);
  });

  it('resets to TIMELINE_DEFAULT_BPM for a NaN set', () => {
    const tempo = withTimelineBpm(createTimelineTempo(), 90);
    expect(withTimelineBpm(tempo, NaN).bpm).toBe(TIMELINE_DEFAULT_BPM);
  });

  it('returns the identical reference when setting the value already stored', () => {
    const tempo = createTimelineTempo();
    expect(withTimelineBpm(tempo, tempo.bpm)).toBe(tempo);
  });

  it('returns the identical reference when the clamped result equals the current bpm', () => {
    const tempo = createTimelineTempo(TIMELINE_MAX_BPM);
    expect(withTimelineBpm(tempo, 9999)).toBe(tempo);
  });

  it('returns a frozen object', () => {
    const tempo = createTimelineTempo();
    expect(Object.isFrozen(withTimelineBpm(tempo, 140))).toBe(true);
  });

  it('does not mutate the input tempo', () => {
    const tempo = createTimelineTempo();
    withTimelineBpm(tempo, 140);
    expect(tempo.bpm).toBe(TIMELINE_DEFAULT_BPM);
  });
});

describe('tempo is display-only', () => {
  it('does not import the timeline scale or shell geometry modules', () => {
    const source = fs.readFileSync(new URL('./timeline-bpm.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/(timeline-scale|daw-shell-runtime)'/);
  });
});
