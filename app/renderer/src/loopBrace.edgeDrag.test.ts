// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import {
  beginLoopEdgeDrag,
  resizedLoopRegion,
  LOOP_EDGE_DRAG_THRESHOLD_PX,
  LOOP_HANDLE_START_SELECTOR,
  LOOP_HANDLE_END_SELECTOR,
  MIN_LOOP_LENGTH_SECS,
  type LoopEdgeDragInput,
  type LoopEdgeDragWindow,
} from './loopBrace.edgeDrag';
import { LOOP_HANDLE_START_CLASS, LOOP_HANDLE_END_CLASS, type LoopRegion } from './loopBrace.render';

function pointer(pointerId: number, clientX: number): PointerEvent {
  return { pointerId, clientX } as PointerEvent;
}

function fakeWindow(): LoopEdgeDragWindow & {
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

function baseInput(overrides: Partial<LoopEdgeDragInput> = {}): LoopEdgeDragInput {
  return {
    button: 0,
    clientX: 0,
    pxPerSecond: 8,
    edge: 'start',
    ...overrides,
  };
}

function baseRegion(overrides: Partial<LoopRegion> = {}): LoopRegion {
  return { startSecs: 0, endSecs: 10, ...overrides };
}

function makeDeps(windowTarget: LoopEdgeDragWindow, overrides: Record<string, unknown> = {}) {
  return {
    windowTarget,
    pointerId: 1,
    region: baseRegion(),
    previewRegion: vi.fn(),
    commitRegion: vi.fn(),
    ...overrides,
  };
}

describe('resizedLoopRegion', () => {
  it('start edge, positive delta: moves startSecs only', () => {
    const result = resizedLoopRegion({ startSecs: 0, endSecs: 10 }, 'start', 2);
    expect(result).toEqual({ startSecs: 2, endSecs: 10 });
  });

  it('start edge, negative delta: moves startSecs only', () => {
    const result = resizedLoopRegion({ startSecs: 4, endSecs: 10 }, 'start', -2);
    expect(result).toEqual({ startSecs: 2, endSecs: 10 });
  });

  it('end edge, positive delta: moves endSecs only', () => {
    const result = resizedLoopRegion({ startSecs: 0, endSecs: 10 }, 'end', 3);
    expect(result).toEqual({ startSecs: 0, endSecs: 13 });
  });

  it('end edge, negative delta: moves endSecs only', () => {
    const result = resizedLoopRegion({ startSecs: 0, endSecs: 10 }, 'end', -3);
    expect(result).toEqual({ startSecs: 0, endSecs: 7 });
  });

  it('start edge clamps at 0 for a large negative delta', () => {
    const result = resizedLoopRegion({ startSecs: 2, endSecs: 12 }, 'start', -30);
    expect(result).toEqual({ startSecs: 0, endSecs: 12 });
  });

  it('start edge clamps at endSecs - MIN_LOOP_LENGTH_SECS when dragged past the end', () => {
    const result = resizedLoopRegion({ startSecs: 0, endSecs: 10 }, 'start', 30);
    expect(result.startSecs).toBeLessThan(result.endSecs);
    expect(result).toEqual({ startSecs: 10 - MIN_LOOP_LENGTH_SECS, endSecs: 10 });
  });

  it('end edge clamps at startSecs + MIN_LOOP_LENGTH_SECS when dragged past the start', () => {
    const result = resizedLoopRegion({ startSecs: 0, endSecs: 10 }, 'end', -30);
    expect(result.startSecs).toBeLessThan(result.endSecs);
    expect(result).toEqual({ startSecs: 0, endSecs: MIN_LOOP_LENGTH_SECS });
  });

  it('end edge clamps at maxSecs', () => {
    const result = resizedLoopRegion({ startSecs: 0, endSecs: 10 }, 'end', 100, 15);
    expect(result).toEqual({ startSecs: 0, endSecs: 15 });
  });

  it('end edge ignores a non-finite maxSecs (behaves as unbounded)', () => {
    const result = resizedLoopRegion({ startSecs: 0, endSecs: 10 }, 'end', 5, Number.POSITIVE_INFINITY);
    expect(result).toEqual({ startSecs: 0, endSecs: 15 });
  });

  it('maxSecs is irrelevant to a start-edge drag', () => {
    const result = resizedLoopRegion({ startSecs: 5, endSecs: 10 }, 'start', -2, 6);
    expect(result).toEqual({ startSecs: 3, endSecs: 10 });
  });

  it('when maxSecs is below startSecs + MIN_LOOP_LENGTH_SECS, the minimum-length clamp wins', () => {
    const result = resizedLoopRegion({ startSecs: 5, endSecs: 10 }, 'end', -100, 5.1);
    expect(result).toEqual({ startSecs: 5, endSecs: 5 + MIN_LOOP_LENGTH_SECS });
  });

  it('returns the same region object for a non-finite delta (NaN)', () => {
    const region = baseRegion();
    expect(resizedLoopRegion(region, 'start', Number.NaN)).toBe(region);
  });

  it('returns the same region object for a non-finite delta (Infinity)', () => {
    const region = baseRegion();
    expect(resizedLoopRegion(region, 'end', Number.POSITIVE_INFINITY)).toBe(region);
  });

  it('returns the same region object for a non-finite endpoint', () => {
    const region = { startSecs: Number.NaN, endSecs: 10 };
    expect(resizedLoopRegion(region, 'start', 2)).toBe(region);
  });

  it('returns the same region object for a zero-width anchor', () => {
    const region = { startSecs: 5, endSecs: 5 };
    expect(resizedLoopRegion(region, 'start', 2)).toBe(region);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(resizedLoopRegion({ startSecs: 0, endSecs: 10 }, 'start', 2))).toBe(true);
  });
});

describe('beginLoopEdgeDrag', () => {
  it('returns null and registers no listener for a non-primary button', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    expect(beginLoopEdgeDrag(baseInput({ button: 1 }), deps)).toBeNull();
    win.move(pointer(1, 200));
    expect(deps.previewRegion).not.toHaveBeenCalled();
  });

  it('returns null for a non-finite clientX', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    expect(beginLoopEdgeDrag(baseInput({ clientX: Number.NaN }), deps)).toBeNull();
  });

  it('a 2px move (below threshold) calls neither dep; hasDragged() is false', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    const handle = beginLoopEdgeDrag(baseInput({ clientX: 0 }), deps);
    win.move(pointer(1, 2));
    expect(deps.previewRegion).not.toHaveBeenCalled();
    expect(deps.commitRegion).not.toHaveBeenCalled();
    expect(handle!.hasDragged()).toBe(false);
  });

  it('a move past the threshold calls previewRegion with the resized range (start edge) and not commitRegion', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 10 } });
    const handle = beginLoopEdgeDrag(baseInput({ clientX: 0, pxPerSecond: 8, edge: 'start' }), deps);
    win.move(pointer(1, 80));
    expect(deps.previewRegion).toHaveBeenCalledWith({ startSecs: 10 - MIN_LOOP_LENGTH_SECS, endSecs: 10 });
    expect(deps.commitRegion).not.toHaveBeenCalled();
    expect(handle!.hasDragged()).toBe(true);
  });

  it('a move past the threshold calls previewRegion with the resized range (end edge) and not commitRegion', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 10 } });
    const handle = beginLoopEdgeDrag(baseInput({ clientX: 0, pxPerSecond: 8, edge: 'end' }), deps);
    win.move(pointer(1, 80));
    expect(deps.previewRegion).toHaveBeenCalledWith({ startSecs: 0, endSecs: 20 });
    expect(deps.commitRegion).not.toHaveBeenCalled();
    expect(handle!.hasDragged()).toBe(true);
  });

  it('successive moves preview from the anchor, not cumulatively', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 100 } });
    beginLoopEdgeDrag(baseInput({ clientX: 0, pxPerSecond: 8, edge: 'end' }), deps);
    win.move(pointer(1, 80));
    expect(deps.previewRegion).toHaveBeenLastCalledWith({ startSecs: 0, endSecs: 110 });
    win.move(pointer(1, 160));
    expect(deps.previewRegion).toHaveBeenLastCalledWith({ startSecs: 0, endSecs: 120 });
  });

  it('ignores a pointermove with a mismatched pointerId', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { pointerId: 1 });
    beginLoopEdgeDrag(baseInput({ clientX: 0 }), deps);
    win.move(pointer(2, 200));
    expect(deps.previewRegion).not.toHaveBeenCalled();
  });

  it('ignores a pointerup with a mismatched pointerId', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { pointerId: 1 });
    beginLoopEdgeDrag(baseInput({ clientX: 0 }), deps);
    win.up(pointer(2, 200));
    expect(deps.commitRegion).not.toHaveBeenCalled();
  });

  it('pointerup after a real drag calls commitRegion exactly once with the final range and removes all three listeners', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 100 } });
    beginLoopEdgeDrag(baseInput({ clientX: 0, pxPerSecond: 8, edge: 'end' }), deps);
    win.move(pointer(1, 80));
    win.up(pointer(1, 80));
    expect(deps.commitRegion).toHaveBeenCalledTimes(1);
    expect(deps.commitRegion).toHaveBeenCalledWith({ startSecs: 0, endSecs: 110 });
    expect(win.removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
  });

  it('pointerup without crossing the threshold calls neither dep', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    beginLoopEdgeDrag(baseInput({ clientX: 0 }), deps);
    win.up(pointer(1, 2));
    expect(deps.previewRegion).not.toHaveBeenCalled();
    expect(deps.commitRegion).not.toHaveBeenCalled();
  });

  it('pointercancel after a drag previews the anchor region back and never commits', () => {
    const win = fakeWindow();
    const anchorRegion = { startSecs: 0, endSecs: 100 };
    const deps = makeDeps(win, { region: anchorRegion });
    beginLoopEdgeDrag(baseInput({ clientX: 0, pxPerSecond: 8, edge: 'end' }), deps);
    win.move(pointer(1, 80));
    win.cancel();
    expect(deps.previewRegion).toHaveBeenLastCalledWith(anchorRegion);
    expect(deps.commitRegion).not.toHaveBeenCalled();
    expect(win.removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
  });

  it('pointercancel before the threshold calls neither dep', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    beginLoopEdgeDrag(baseInput({ clientX: 0 }), deps);
    win.cancel();
    expect(deps.previewRegion).not.toHaveBeenCalled();
    expect(deps.commitRegion).not.toHaveBeenCalled();
  });

  it('a start-edge drag past the end previews and commits the clamped range (end unchanged)', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 10 } });
    beginLoopEdgeDrag(baseInput({ clientX: 0, pxPerSecond: 8, edge: 'start' }), deps);
    win.move(pointer(1, 800));
    const expected = { startSecs: 10 - MIN_LOOP_LENGTH_SECS, endSecs: 10 };
    expect(deps.previewRegion).toHaveBeenCalledWith(expected);
    win.up(pointer(1, 800));
    expect(deps.commitRegion).toHaveBeenCalledWith(expected);
  });

  it('a maxSecs-bounded end-edge drag previews and commits at the bound', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { region: { startSecs: 0, endSecs: 10 } });
    beginLoopEdgeDrag(baseInput({ clientX: 0, pxPerSecond: 8, edge: 'end', maxSecs: 15 }), deps);
    win.move(pointer(1, 800));
    expect(deps.previewRegion).toHaveBeenCalledWith({ startSecs: 0, endSecs: 15 });
    win.up(pointer(1, 800));
    expect(deps.commitRegion).toHaveBeenCalledWith({ startSecs: 0, endSecs: 15 });
  });
});

describe('LOOP_EDGE_DRAG_THRESHOLD_PX', () => {
  it('is 4', () => {
    expect(LOOP_EDGE_DRAG_THRESHOLD_PX).toBe(4);
  });
});

describe('MIN_LOOP_LENGTH_SECS', () => {
  it('is 0.25', () => {
    expect(MIN_LOOP_LENGTH_SECS).toBe(0.25);
  });
});

describe('LOOP_HANDLE_START_SELECTOR / LOOP_HANDLE_END_SELECTOR', () => {
  it('are pinned to the shipped class constants', () => {
    expect(LOOP_HANDLE_START_SELECTOR).toBe(`.${LOOP_HANDLE_START_CLASS}`);
    expect(LOOP_HANDLE_END_SELECTOR).toBe(`.${LOOP_HANDLE_END_CLASS}`);
  });
});
