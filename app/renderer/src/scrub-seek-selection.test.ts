// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Composition test for #1305: proves a scrub/seek gesture never mutates the
// arrangement's clip or time selection. Wires the REAL beginTimeSelectionDrag
// and beginSessionTimelineScrub gestures against the REAL shared
// sessionClipSelection / sessionTimeSelection singletons, in the same order
// LiveCapturePanel.onBoardPointerDown arms them (drag first, then scrub) —
// see that function's #1302/#1303/#1304 comments.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { beginSessionTimelineScrub, type SessionTimelineScrubRoot, type SessionTimelineScrubSurface } from './session-timeline-scrub';
import { beginTimeSelectionDrag, type TimeSelectionDragWindow } from './time-selection-drag';
import { sessionClipSelection } from './clip-selection';
import { sessionTimeSelection } from './time-selection';

const SURFACE_LEFT_PX = 100;
const PX_PER_SECOND = 8;
const DURATION_SECS = 60;

function pointer(pointerId: number, clientX: number): PointerEvent {
  return { pointerId, clientX } as PointerEvent;
}

function fakeWindow(): TimeSelectionDragWindow & {
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel(): void;
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener as (...args: unknown[]) => void);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener as (...args: unknown[]) => void);
    },
    move(event) { [...(listeners.get('pointermove') ?? [])].forEach((listener) => listener(event)); },
    up(event) { [...(listeners.get('pointerup') ?? [])].forEach((listener) => listener(event)); },
    cancel() { [...(listeners.get('pointercancel') ?? [])].forEach((listener) => listener()); },
  };
}

const root: SessionTimelineScrubRoot = {
  setPointerCapture: vi.fn(),
  hasPointerCapture: () => false,
  releasePointerCapture: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

const surface: SessionTimelineScrubSurface = {
  getBoundingClientRect: () => ({ left: SURFACE_LEFT_PX }),
};

function arm(downX: number) {
  const win = fakeWindow();
  const seekTo = vi.fn();
  const previewLeftPx = vi.fn();
  const handle = beginTimeSelectionDrag(
    { button: 0, clientX: downX, laneLeftPx: SURFACE_LEFT_PX, scrollOffsetPx: 0, pxPerSecond: PX_PER_SECOND },
    {
      windowTarget: win,
      pointerId: 1,
      setSelection: (r) => {
        sessionTimeSelection.setSelection(r.startSecs, r.endSecs);
        sessionClipSelection.clearSelection();
      },
      clearSelection: () => { sessionTimeSelection.clearSelection(); },
      repaint: () => {},
      onDragEnd: () => {},
    },
  );
  beginSessionTimelineScrub({
    root,
    surface,
    scrollOffsetPx: 0,
    windowTarget: win,
    pointerId: 1,
    clientX: downX,
    getDurationSecs: () => DURATION_SECS,
    canCommitSeek: () => !(handle?.hasDragged() ?? false),
    previewLeftPx,
    seekTo,
  });
  return { win, seekTo, previewLeftPx, handle };
}

function pressAndRelease(downX: number, moves: number[], upX: number) {
  const { win, seekTo, previewLeftPx } = arm(downX);
  for (const moveX of moves) win.move(pointer(1, moveX));
  win.up(pointer(1, upX));
  return { seekTo, previewLeftPx };
}

describe('scrub/seek preserves clip and time selection (#1305)', () => {
  beforeEach(() => {
    sessionClipSelection.clearSelection();
    sessionTimeSelection.clearSelection();
  });

  it('a ruler click-seek leaves a pre-existing clip selection untouched (#1305 AC1)', () => {
    sessionClipSelection.selectClip(3);
    const { seekTo } = pressAndRelease(180, [], 180);
    expect(seekTo).toHaveBeenCalledTimes(1);
    expect(seekTo.mock.calls[0][0]).toBeCloseTo(10);
    expect(sessionClipSelection.getSelectedChannel()).toBe(3);
  });

  it('a ruler click-seek leaves a pre-existing time selection untouched (#1305 AC2)', () => {
    sessionTimeSelection.setSelection(1, 3);
    const { seekTo } = pressAndRelease(180, [], 180);
    expect(seekTo).toHaveBeenCalledTimes(1);
    expect(seekTo.mock.calls[0][0]).toBeCloseTo(10);
    expect(sessionTimeSelection.getSelection()).toEqual({ startSecs: 1, endSecs: 3 });
  });

  it('a sub-threshold scrub still commits its seek and preserves both selections', () => {
    sessionClipSelection.selectClip(2);
    sessionTimeSelection.setSelection(4, 6);
    const { seekTo } = pressAndRelease(180, [182], 182);
    expect(seekTo).toHaveBeenCalledTimes(1);
    expect(sessionClipSelection.getSelectedChannel()).toBe(2);
    expect(sessionTimeSelection.getSelection()).toEqual({ startSecs: 4, endSecs: 6 });
  });

  it('the scrub\'s preview during the press touches neither selection', () => {
    sessionClipSelection.selectClip(2);
    sessionTimeSelection.setSelection(4, 6);
    const { win, previewLeftPx } = arm(180);
    win.move(pointer(1, 182));
    expect(previewLeftPx).toHaveBeenCalled();
    expect(sessionClipSelection.getSelectedChannel()).toBe(2);
    expect(sessionTimeSelection.getSelection()).toEqual({ startSecs: 4, endSecs: 6 });
  });

  it('an interrupted press (pointercancel) before the threshold preserves both selections', () => {
    sessionClipSelection.selectClip(2);
    sessionTimeSelection.setSelection(4, 6);
    const { win } = arm(180);
    win.cancel();
    expect(sessionClipSelection.getSelectedChannel()).toBe(2);
    expect(sessionTimeSelection.getSelection()).toEqual({ startSecs: 4, endSecs: 6 });
  });

  it('a real drag still replaces the time selection and suppresses the seek (#1304 regression fence)', () => {
    sessionTimeSelection.setSelection(1, 3);
    const { seekTo } = pressAndRelease(180, [260], 260);
    expect(seekTo).not.toHaveBeenCalled();
    expect(sessionTimeSelection.getSelection()).toEqual({ startSecs: 10, endSecs: 20 });
  });
});
