// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import { applyClipClick, clipClickDecision, type ClipClickDeps, type ClipClickInput } from './clip-click';
import { timelineSpanSecsAt } from './timeline-scale';

function baseInput(overrides: Partial<ClipClickInput> = {}): ClipClickInput {
  return {
    button: 0,
    clientX: 120,
    laneLeftPx: 100,
    scrollOffsetPx: 0,
    pxPerSecond: 8,
    channelIndex: 2,
    clipRects: [{ left: 100, right: 200 }],
    overrideHeld: false,
    canSeek: true,
    ...overrides,
  };
}

function makeDeps(): ClipClickDeps & { selectClip: ReturnType<typeof vi.fn>; repaintClipSelection: ReturnType<typeof vi.fn>; seekTo: ReturnType<typeof vi.fn> } {
  return {
    selectClip: vi.fn(),
    repaintClipSelection: vi.fn(),
    seekTo: vi.fn(),
  };
}

describe('clipClickDecision', () => {
  it("is 'none' for a non-primary button", () => {
    expect(clipClickDecision(baseInput({ button: 2 }))).toEqual({ kind: 'none' });
  });

  it("is 'none' for a non-finite clientX", () => {
    expect(clipClickDecision(baseInput({ clientX: Number.NaN }))).toEqual({ kind: 'none' });
  });

  it("is 'none' for a non-finite laneLeftPx", () => {
    expect(clipClickDecision(baseInput({ laneLeftPx: Number.POSITIVE_INFINITY }))).toEqual({ kind: 'none' });
  });

  it("is 'none' for a non-integer channelIndex", () => {
    expect(clipClickDecision(baseInput({ channelIndex: Number.NaN }))).toEqual({ kind: 'none' });
  });

  it("is 'none' for a negative channelIndex", () => {
    expect(clipClickDecision(baseInput({ channelIndex: -1 }))).toEqual({ kind: 'none' });
  });

  it("is 'none' when clipRects is empty (the press misses every clip)", () => {
    expect(clipClickDecision(baseInput({ clipRects: [] }))).toEqual({ kind: 'none' });
  });

  it("is 'none' when clientX sits at a clip's exclusive right edge (half-open, same rule laneClipHitAt enforces)", () => {
    expect(clipClickDecision(baseInput({ clientX: 200 }))).toEqual({ kind: 'none' });
  });

  it("is 'select' with the channel index for a plain in-clip press", () => {
    expect(clipClickDecision(baseInput())).toEqual({ kind: 'select', channelIndex: 2 });
  });

  it("is 'select' — not 'select-and-seek' — when overrideHeld is true but canSeek is false", () => {
    expect(clipClickDecision(baseInput({ overrideHeld: true, canSeek: false }))).toEqual({ kind: 'select', channelIndex: 2 });
  });

  it("is 'select-and-seek' with secs from timelineSpanSecsAt when the override is held and canSeek is true", () => {
    const decision = clipClickDecision(baseInput({ overrideHeld: true, canSeek: true }));
    expect(decision.kind).toBe('select-and-seek');
    if (decision.kind === 'select-and-seek') {
      expect(decision.channelIndex).toBe(2);
      expect(decision.secs).toBeCloseTo(timelineSpanSecsAt(8, 120 - 100 + 0));
    }
  });

  it('adds a non-zero scrollOffsetPx into the resolved secs', () => {
    const decision = clipClickDecision(baseInput({ overrideHeld: true, canSeek: true, scrollOffsetPx: 40 }));
    expect(decision.kind).toBe('select-and-seek');
    if (decision.kind === 'select-and-seek') {
      expect(decision.secs).toBeCloseTo(timelineSpanSecsAt(8, 120 - 100 + 40));
    }
  });

  it('clamps secs to 0 for a press left of the lane edge', () => {
    const decision = clipClickDecision(baseInput({
      overrideHeld: true,
      canSeek: true,
      clientX: 50,
      laneLeftPx: 100,
      clipRects: [{ left: 0, right: 200 }],
    }));
    expect(decision.kind).toBe('select-and-seek');
    if (decision.kind === 'select-and-seek') {
      expect(decision.secs).toBe(0);
    }
  });

  it('treats a non-finite scrollOffsetPx as 0', () => {
    const decision = clipClickDecision(baseInput({ overrideHeld: true, canSeek: true, scrollOffsetPx: Number.NaN }));
    expect(decision.kind).toBe('select-and-seek');
    if (decision.kind === 'select-and-seek') {
      expect(decision.secs).toBeCloseTo(timelineSpanSecsAt(8, 120 - 100));
    }
  });
});

describe('applyClipClick', () => {
  it('calls none of the three deps on a none decision', () => {
    const deps = makeDeps();
    const decision = applyClipClick(baseInput({ button: 2 }), deps);
    expect(decision).toEqual({ kind: 'none' });
    expect(deps.selectClip).not.toHaveBeenCalled();
    expect(deps.repaintClipSelection).not.toHaveBeenCalled();
    expect(deps.seekTo).not.toHaveBeenCalled();
  });

  it('calls selectClip and repaintClipSelection (but not seekTo) on a select decision', () => {
    const deps = makeDeps();
    const decision = applyClipClick(baseInput(), deps);
    expect(decision).toEqual({ kind: 'select', channelIndex: 2 });
    expect(deps.selectClip).toHaveBeenCalledWith(2);
    expect(deps.repaintClipSelection).toHaveBeenCalledTimes(1);
    expect(deps.seekTo).not.toHaveBeenCalled();
  });

  it('calls all three deps on a select-and-seek decision, seekTo with the resolved secs', () => {
    const deps = makeDeps();
    const decision = applyClipClick(baseInput({ overrideHeld: true, canSeek: true }), deps);
    expect(decision.kind).toBe('select-and-seek');
    if (decision.kind === 'select-and-seek') {
      expect(deps.selectClip).toHaveBeenCalledWith(2);
      expect(deps.repaintClipSelection).toHaveBeenCalledTimes(1);
      expect(deps.seekTo).toHaveBeenCalledWith(decision.secs);
    }
  });
});

describe('ClipClickDeps shape', () => {
  it('accepts exactly the three known keys — the runtime companion to "no insert-marker member"', () => {
    const deps: ClipClickDeps = {
      selectClip: () => {},
      repaintClipSelection: () => {},
      seekTo: () => {},
    };
    expect(Object.keys(deps).sort()).toEqual(['repaintClipSelection', 'seekTo', 'selectClip']);
  });
});
