// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import {
  beginLoopBodyDrag,
  movedLoopRegion,
  LOOP_BODY_DRAG_THRESHOLD_PX,
  LOOP_BRACE_BODY_SELECTOR,
  type LoopBodyDragInput,
  type LoopBodyDragWindow,
} from './loopBrace.bodyDrag';
import type { LoopRegion } from './loopBrace.render';

function pointer(pointerId: number, clientX: number): PointerEvent {
  return { pointerId, clientX } as PointerEvent;
}

function fakeWindow(): LoopBodyDragWindow & {
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel(): void;
  removed: string[];
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const removed: string[] = [];
  return {
    removed,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener as (...args: unknown[]) => void);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener as (...args: unknown[]) => void);
      removed.push(type);
    },
    move(event) { listeners.get('pointermove')?.forEach((listener) => listener(event)); },
    up(event) { listeners.get('pointerup')?.forEach((listener) => listener(event)); },
    cancel() { listeners.get('pointercancel')?.forEach((listener) => listener()); },
  };
}

function baseInput(overrides: Partial<LoopBodyDragInput> = {}): LoopBodyDragInput {
  return {
    button: 0,
    clientX: 0,
    pxPerSecond: 8,
    ...overrides,
  };
}

function baseRegion(overrides: Partial<LoopRegion> = {}): LoopRegion {
  return { startSecs: 0, endSecs: 10, ...overrides };
}

function makeDeps(windowTarget: LoopBodyDragWindow, overrides: Record<string, unknown> = {}) {
  return {
    windowTarget,
    pointerId: 1,
    region: baseRegion(),
    previewRegion: vi.fn(),
    commitRegion: vi.fn(),
    ...overrides,
  };
}

describe('movedLoopRegion', () => {
  it('translates both endpoints by the delta and preserves length', () => {
    const result = movedLoopRegion({ startSecs: 10, endSecs: 20 }, 5);
    expect(result).toEqual({ startSecs: 15, endSecs: 25 });
    expect(result.endSecs - result.startSecs).toBe(10);
  });

  it('moves left for a negative delta', () => {
    expect(movedLoopRegion({ startSecs: 10, endSecs: 20 }, -4)).toEqual({ startSecs: 6, endSecs: 16 });
  });

  it('clamps startSecs to 0 (min clamp)', () => {
    const result = movedLoopRegion({ startSecs: 2, endSecs: 12 }, -30);
    expect(result).toEqual({ startSecs: 0, endSecs: 10 });
  });

  it('clamps endSecs to maxSecs (max clamp)', () => {
    // Length-preserving: startSecs pins to maxSecs - lengthSecs (60 - 10 = 50), not
    // maxSecs - (region length before the drag started at a different offset).
    const result = movedLoopRegion({ startSecs: 10, endSecs: 20 }, 100, 60);
    expect(result).toEqual({ startSecs: 50, endSecs: 60 });
    expect(result.endSecs - result.startSecs).toBe(10);
  });

  it('the max clamp is a no-op when the range already fits', () => {
    expect(movedLoopRegion({ startSecs: 10, endSecs: 20 }, 5, 1000)).toEqual({ startSecs: 15, endSecs: 25 });
  });

  it('the min clamp wins over the max clamp when maxSecs is shorter than the loop length', () => {
    expect(movedLoopRegion({ startSecs: 0, endSecs: 30 }, 5, 10)).toEqual({ startSecs: 0, endSecs: 30 });
  });

  it('returns the same region object for a non-finite delta (NaN)', () => {
    const region = baseRegion();
    expect(movedLoopRegion(region, Number.NaN)).toBe(region);
  });

  it('returns the same region object for a non-finite delta (Infinity)', () => {
    const region = baseRegion();
    expect(movedLoopRegion(region, Number.POSITIVE_INFINITY)).toBe(region);
  });

  it('returns the same region object for a zero-width anchor', () => {
    const region = { startSecs: 5, endSecs: 5 };
    expect(movedLoopRegion(region, 5)).toBe(region);
  });

  it('ignores a non-finite maxSecs (behaves as unbounded)', () => {
    expect(movedLoopRegion({ startSecs: 10, endSecs: 20 }, 100, Number.POSITIVE_INFINITY)).toEqual({
      startSecs: 110,
      endSecs: 120,
    });
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(movedLoopRegion({ startSecs: 10, endSecs: 20 }, 5))).toBe(true);
  });
});

describe('beginLoopBodyDrag', () => {
  it('returns null and registers no listener for a non-primary button', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    expect(beginLoopBodyDrag(baseInput({ button: 1 }), deps)).toBeNull();
    win.move(pointer(1, 200));
    expect(deps.previewRegion).not.toHaveBeenCalled();
  });

  it('returns null for a non-finite clientX', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    expect(beginLoopBodyDrag(baseInput({ clientX: Number.NaN }), deps)).toBeNull();
  });

  it('a pointermove of 2px (below threshold) calls neither previewRegion nor commitRegion; hasDragged() is false', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    const handle = beginLoopBodyDrag(baseInput({ clientX: 0 }), deps);
    win.move(pointer(1, 2));
    expect(deps.previewRegion).not.toHaveBeenCalled();
    expect(deps.commitRegion).not.toHaveBeenCalled();
    expect(handle!.hasDragged()).toBe(false);
  });

  it('a pointermove past the threshold calls previewRegion with the shifted range and not commitRegion', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 10 } });
    const handle = beginLoopBodyDrag(baseInput({ clientX: 0, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 80));
    expect(deps.previewRegion).toHaveBeenCalledWith({ startSecs: 10, endSecs: 20 });
    expect(deps.commitRegion).not.toHaveBeenCalled();
    expect(handle!.hasDragged()).toBe(true);
  });

  it('successive moves preview from the anchor, not cumulatively', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 10 } });
    beginLoopBodyDrag(baseInput({ clientX: 0, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 80));
    expect(deps.previewRegion).toHaveBeenLastCalledWith({ startSecs: 10, endSecs: 20 });
    win.move(pointer(1, 160));
    expect(deps.previewRegion).toHaveBeenLastCalledWith({ startSecs: 20, endSecs: 30 });
  });

  it('ignores a pointermove with a mismatched pointerId', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { pointerId: 1 });
    beginLoopBodyDrag(baseInput({ clientX: 0 }), deps);
    win.move(pointer(2, 200));
    expect(deps.previewRegion).not.toHaveBeenCalled();
  });

  it('ignores a pointerup with a mismatched pointerId', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { pointerId: 1 });
    beginLoopBodyDrag(baseInput({ clientX: 0 }), deps);
    win.up(pointer(2, 200));
    expect(deps.commitRegion).not.toHaveBeenCalled();
  });

  it('pointerup after a real drag calls commitRegion exactly once with the final range and removes all three listeners', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 10 } });
    beginLoopBodyDrag(baseInput({ clientX: 0, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 80));
    win.up(pointer(1, 80));
    expect(deps.commitRegion).toHaveBeenCalledTimes(1);
    expect(deps.commitRegion).toHaveBeenCalledWith({ startSecs: 10, endSecs: 20 });
    expect(win.removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
  });

  it('pointerup without crossing the threshold calls neither dep (a click on the brace is inert)', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    beginLoopBodyDrag(baseInput({ clientX: 0 }), deps);
    win.up(pointer(1, 2));
    expect(deps.previewRegion).not.toHaveBeenCalled();
    expect(deps.commitRegion).not.toHaveBeenCalled();
  });

  it('pointercancel after a drag calls previewRegion with the original anchor region and never calls commitRegion', () => {
    const win = fakeWindow();
    const anchorRegion = { startSecs: 0, endSecs: 10 };
    const deps = makeDeps(win, { region: anchorRegion });
    beginLoopBodyDrag(baseInput({ clientX: 0, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 80));
    win.cancel();
    expect(deps.previewRegion).toHaveBeenLastCalledWith(anchorRegion);
    expect(deps.commitRegion).not.toHaveBeenCalled();
    expect(win.removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
  });

  it('pointercancel before the threshold calls neither dep', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    beginLoopBodyDrag(baseInput({ clientX: 0 }), deps);
    win.cancel();
    expect(deps.previewRegion).not.toHaveBeenCalled();
    expect(deps.commitRegion).not.toHaveBeenCalled();
  });

  it('a drag with maxSecs set clamps the previewed and committed range at the bound', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 10 } });
    beginLoopBodyDrag(baseInput({ clientX: 0, pxPerSecond: 8, maxSecs: 15 }), deps);
    win.move(pointer(1, 80));
    expect(deps.previewRegion).toHaveBeenCalledWith({ startSecs: 5, endSecs: 15 });
    win.up(pointer(1, 80));
    expect(deps.commitRegion).toHaveBeenCalledWith({ startSecs: 5, endSecs: 15 });
  });
});

describe('LOOP_BODY_DRAG_THRESHOLD_PX', () => {
  it('is 4', () => {
    expect(LOOP_BODY_DRAG_THRESHOLD_PX).toBe(4);
  });
});

describe('LOOP_BRACE_BODY_SELECTOR', () => {
  it('is .daw-loop-brace', () => {
    expect(LOOP_BRACE_BODY_SELECTOR).toBe('.daw-loop-brace');
  });
});
