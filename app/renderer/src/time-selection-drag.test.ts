// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import {
  beginTimeSelectionDrag,
  timeSelectionSecsAt,
  TIME_SELECTION_DRAG_THRESHOLD_PX,
  type TimeSelectionDragInput,
  type TimeSelectionDragWindow,
} from './time-selection-drag';

function pointer(pointerId: number, clientX: number): PointerEvent {
  return { pointerId, clientX } as PointerEvent;
}

function fakeWindow(): TimeSelectionDragWindow & {
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

function baseInput(overrides: Partial<TimeSelectionDragInput> = {}): TimeSelectionDragInput {
  return {
    button: 0,
    clientX: 100,
    laneLeftPx: 100,
    scrollOffsetPx: 0,
    pxPerSecond: 8,
    ...overrides,
  };
}

function makeDeps(windowTarget: TimeSelectionDragWindow, overrides: Record<string, unknown> = {}) {
  return {
    windowTarget,
    pointerId: 1,
    setSelection: vi.fn(),
    clearSelection: vi.fn(),
    repaint: vi.fn(),
    onDragEnd: vi.fn(),
    ...overrides,
  };
}

describe('timeSelectionSecsAt', () => {
  it('converts clientX to seconds at the given scale', () => {
    const input = baseInput({ laneLeftPx: 100, scrollOffsetPx: 0, pxPerSecond: 8 });
    expect(timeSelectionSecsAt(input, 180)).toBe(10);
  });

  it('accounts for a scroll offset', () => {
    const input = baseInput({ laneLeftPx: 100, scrollOffsetPx: 80, pxPerSecond: 8 });
    expect(timeSelectionSecsAt(input, 180)).toBe(20);
  });

  it('clamps a clientX left of the lane edge to 0', () => {
    const input = baseInput({ laneLeftPx: 100, scrollOffsetPx: 0, pxPerSecond: 8 });
    expect(timeSelectionSecsAt(input, 50)).toBe(0);
  });

  it('treats a non-finite scrollOffsetPx as 0', () => {
    const input = baseInput({ laneLeftPx: 100, scrollOffsetPx: Number.NaN, pxPerSecond: 8 });
    expect(timeSelectionSecsAt(input, 180)).toBe(10);
  });

  it('returns 0 for a non-finite clientX', () => {
    const input = baseInput({ laneLeftPx: 100, scrollOffsetPx: 0, pxPerSecond: 8 });
    expect(timeSelectionSecsAt(input, Number.NaN)).toBe(0);
  });
});

describe('beginTimeSelectionDrag', () => {
  it('returns null and registers no listener for a non-primary button', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    expect(beginTimeSelectionDrag(baseInput({ button: 2 }), deps)).toBeNull();
    expect(deps.setSelection).not.toHaveBeenCalled();
    win.move(pointer(1, 200));
    expect(deps.setSelection).not.toHaveBeenCalled();
  });

  it('returns null for a non-finite clientX', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    expect(beginTimeSelectionDrag(baseInput({ clientX: Number.NaN }), deps)).toBeNull();
  });

  it('returns null for a non-finite laneLeftPx', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    expect(beginTimeSelectionDrag(baseInput({ laneLeftPx: Number.NaN }), deps)).toBeNull();
  });

  it('a pointermove of 2px calls neither setSelection nor repaint, and hasDragged() is false', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    const handle = beginTimeSelectionDrag(baseInput({ clientX: 100 }), deps);
    expect(handle).not.toBeNull();
    win.move(pointer(1, 102));
    expect(deps.setSelection).not.toHaveBeenCalled();
    expect(deps.repaint).not.toHaveBeenCalled();
    expect(handle!.hasDragged()).toBe(false);
  });

  it('a pointermove of 40px calls setSelection with the normalized range and repaint; hasDragged() is true', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    const handle = beginTimeSelectionDrag(baseInput({ clientX: 100, laneLeftPx: 100, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 140));
    expect(deps.setSelection).toHaveBeenCalledWith({ startSecs: 0, endSecs: 5 });
    expect(deps.repaint).toHaveBeenCalledTimes(1);
    expect(handle!.hasDragged()).toBe(true);
  });

  it('a leftward 40px drag produces startSecs < endSecs', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    beginTimeSelectionDrag(baseInput({ clientX: 200, laneLeftPx: 100, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 160));
    expect(deps.setSelection).toHaveBeenCalledWith({ startSecs: 7.5, endSecs: 12.5 });
  });

  it('once dragged, a subsequent move back inside the threshold still updates the selection, hasDragged() stays true', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    const handle = beginTimeSelectionDrag(baseInput({ clientX: 100, laneLeftPx: 100, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 140));
    expect(handle!.hasDragged()).toBe(true);
    win.move(pointer(1, 101));
    expect(handle!.hasDragged()).toBe(true);
    expect(deps.setSelection).toHaveBeenCalledTimes(2);
  });

  it('once dragged, a move back to exactly the anchor clears the selection (a degenerate range) but keeps the gesture a drag', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    const handle = beginTimeSelectionDrag(baseInput({ clientX: 100, laneLeftPx: 100, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 140));
    win.move(pointer(1, 100));
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
    expect(deps.repaint).toHaveBeenCalledTimes(2);
    expect(handle!.hasDragged()).toBe(true);
  });

  it('ignores a pointermove with a mismatched pointerId', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { pointerId: 1 });
    beginTimeSelectionDrag(baseInput({ clientX: 100 }), deps);
    win.move(pointer(2, 200));
    expect(deps.setSelection).not.toHaveBeenCalled();
  });

  it('pointerup without ever crossing the threshold calls clearSelection + repaint, and onDragEnd(false)', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    beginTimeSelectionDrag(baseInput({ clientX: 100 }), deps);
    win.up(pointer(1, 101));
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
    expect(deps.repaint).toHaveBeenCalledTimes(1);
    expect(deps.onDragEnd).toHaveBeenCalledWith(false);
  });

  it('pointerup after a drag calls onDragEnd(true), does not call clearSelection, and removes all three listeners', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    beginTimeSelectionDrag(baseInput({ clientX: 100, laneLeftPx: 100, pxPerSecond: 8 }), deps);
    win.move(pointer(1, 140));
    win.up(pointer(1, 180));
    expect(deps.onDragEnd).toHaveBeenCalledWith(true);
    expect(deps.clearSelection).not.toHaveBeenCalled();
    expect(win.removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
  });

  it('ignores a pointerup with a mismatched pointerId', () => {
    const win = fakeWindow();
    const deps = makeDeps(win, { pointerId: 1 });
    beginTimeSelectionDrag(baseInput({ clientX: 100 }), deps);
    win.up(pointer(2, 200));
    expect(deps.onDragEnd).not.toHaveBeenCalled();
  });

  it('pointercancel clears the selection, repaints and calls onDragEnd once; a pointerup arriving after cleanup does not fire onDragEnd again', () => {
    const win = fakeWindow();
    const deps = makeDeps(win);
    beginTimeSelectionDrag(baseInput({ clientX: 100 }), deps);
    win.cancel();
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
    expect(deps.repaint).toHaveBeenCalledTimes(1);
    expect(deps.onDragEnd).toHaveBeenCalledTimes(1);
    win.up(pointer(1, 101));
    expect(deps.onDragEnd).toHaveBeenCalledTimes(1);
  });
});

describe('TIME_SELECTION_DRAG_THRESHOLD_PX', () => {
  it('is 4', () => {
    expect(TIME_SELECTION_DRAG_THRESHOLD_PX).toBe(4);
  });
});
