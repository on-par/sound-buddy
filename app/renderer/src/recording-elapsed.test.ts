// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { renderStableElapsedMs, RENDER_STABLE_ELAPSED_QUANTUM_MS } from './recording-elapsed';

describe('renderStableElapsedMs', () => {
  it('floors a mid-second value down to the whole second', () => {
    expect(renderStableElapsedMs(61_800)).toBe(61_000);
  });

  it('is exact on a second boundary', () => {
    expect(renderStableElapsedMs(61_000)).toBe(61_000);
  });

  it('collapses two sub-second reads within the same second to one value', () => {
    expect(renderStableElapsedMs(61_200)).toBe(renderStableElapsedMs(61_800));
  });

  it('changes once a second rolls over', () => {
    expect(renderStableElapsedMs(62_200)).toBe(62_000);
    expect(renderStableElapsedMs(62_200)).not.toBe(61_000);
  });

  it('guards zero, negative, NaN, and Infinity to 0', () => {
    expect(renderStableElapsedMs(0)).toBe(0);
    expect(renderStableElapsedMs(-5)).toBe(0);
    expect(renderStableElapsedMs(NaN)).toBe(0);
    expect(renderStableElapsedMs(Infinity)).toBe(0);
  });

  it('exposes the quantum as a named 1000ms constant', () => {
    expect(RENDER_STABLE_ELAPSED_QUANTUM_MS).toBe(1000);
  });
});
