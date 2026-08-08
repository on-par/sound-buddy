// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePhaseDoublingStore } from './phaseDoublingStore';

let clampIndex: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clampIndex = vi.fn((i: number) => Math.max(0, Math.min(5, i)));
  (globalThis as { window?: unknown }).window = { phaseDoublingState: { clampIndex } };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  usePhaseDoublingStore.setState({ dialogOpen: false, step: 0, context: null });
});

describe('usePhaseDoublingStore', () => {
  it('starts closed at step 0 with no context', () => {
    expect(usePhaseDoublingStore.getState().dialogOpen).toBe(false);
    expect(usePhaseDoublingStore.getState().step).toBe(0);
    expect(usePhaseDoublingStore.getState().context).toBeNull();
  });

  describe('open', () => {
    it('opens the dialog, resets to step 0, and stores the context', () => {
      usePhaseDoublingStore.setState({ step: 3 });

      usePhaseDoublingStore.getState().open({ filename: 'sunday.wav', detected: true });

      expect(usePhaseDoublingStore.getState().dialogOpen).toBe(true);
      expect(usePhaseDoublingStore.getState().step).toBe(0);
      expect(usePhaseDoublingStore.getState().context).toEqual({ filename: 'sunday.wav', detected: true });
    });

    it('accepts a null context (no report card on screen)', () => {
      usePhaseDoublingStore.getState().open(null);

      expect(usePhaseDoublingStore.getState().dialogOpen).toBe(true);
      expect(usePhaseDoublingStore.getState().context).toBeNull();
    });
  });

  it('close hides the dialog', () => {
    usePhaseDoublingStore.getState().open({ filename: 'x.wav', detected: false });

    usePhaseDoublingStore.getState().close();

    expect(usePhaseDoublingStore.getState().dialogOpen).toBe(false);
  });

  it('next clamps through window.phaseDoublingState.clampIndex', () => {
    usePhaseDoublingStore.setState({ step: 1 });

    usePhaseDoublingStore.getState().next();

    expect(clampIndex).toHaveBeenCalledWith(2);
    expect(usePhaseDoublingStore.getState().step).toBe(2);
  });

  it('prev clamps through window.phaseDoublingState.clampIndex', () => {
    usePhaseDoublingStore.setState({ step: 1 });

    usePhaseDoublingStore.getState().prev();

    expect(clampIndex).toHaveBeenCalledWith(0);
    expect(usePhaseDoublingStore.getState().step).toBe(0);
  });

  it('prev is clamped at the floor by the classic-script helper', () => {
    usePhaseDoublingStore.setState({ step: 0 });

    usePhaseDoublingStore.getState().prev();

    expect(clampIndex).toHaveBeenCalledWith(-1);
    expect(usePhaseDoublingStore.getState().step).toBe(0);
  });
});
