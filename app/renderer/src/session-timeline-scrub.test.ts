// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { beginSessionTimelineScrub, scrubTimelineLeftPx, type SessionTimelineScrubRoot, type SessionTimelineScrubWindow } from './session-timeline-scrub';

function pointer(pointerId: number, clientX: number): PointerEvent {
  return { pointerId, clientX } as PointerEvent;
}

function fakeWindow(): SessionTimelineScrubWindow & { move(event: PointerEvent): void; up(event: PointerEvent): void; cancel(): void } {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener as (...args: unknown[]) => void);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener as (...args: unknown[]) => void);
    },
    move(event) { listeners.get('pointermove')?.forEach((listener) => listener(event)); },
    up(event) { listeners.get('pointerup')?.forEach((listener) => listener(event)); },
    cancel() { listeners.get('pointercancel')?.forEach((listener) => listener()); },
  };
}

function fakeRoot(): SessionTimelineScrubRoot & { lost(): void; captured: Set<number> } {
  const listeners = new Set<() => void>();
  const captured = new Set<number>();
  return {
    captured,
    setPointerCapture(pointerId) { captured.add(pointerId); },
    hasPointerCapture(pointerId) { return captured.has(pointerId); },
    releasePointerCapture(pointerId) { captured.delete(pointerId); },
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    lost() { listeners.forEach((listener) => listener()); },
  };
}

describe('beginSessionTimelineScrub', () => {
  it('previews moves and commits one seek on matching pointer release', () => {
    const root = fakeRoot();
    const win = fakeWindow();
    const previews: number[] = [];
    const seeks: number[] = [];

    expect(beginSessionTimelineScrub({
      root,
      windowTarget: win,
      surface: { getBoundingClientRect: () => ({ left: 100 }) },
      scrollOffsetPx: 0,
      pointerId: 7,
      clientX: 100,
      getDurationSecs: () => 10,
      canCommitSeek: () => true,
      previewLeftPx: (leftPx) => previews.push(leftPx),
      seekTo: (elapsedSecs) => { seeks.push(elapsedSecs); },
    })).toBe(true);

    expect(previews).toEqual([208]);
    win.move(pointer(8, 132));
    expect(previews).toEqual([208]);
    win.move(pointer(7, 132));
    expect(previews).toEqual([208, 240]);
    win.up(pointer(7, 148));

    expect(previews).toEqual([208, 240, 256]);
    expect(seeks).toEqual([6]);
    expect(root.captured.has(7)).toBe(false);

    win.up(pointer(7, 180));
    expect(seeks).toEqual([6]);
  });

  it('does not start when duration is unavailable', () => {
    const root = fakeRoot();
    const win = fakeWindow();
    const previews: number[] = [];

    expect(beginSessionTimelineScrub({
      root,
      windowTarget: win,
      surface: { getBoundingClientRect: () => ({ left: 100 }) },
      scrollOffsetPx: 0,
      pointerId: 1,
      clientX: 100,
      getDurationSecs: () => undefined,
      canCommitSeek: () => true,
      previewLeftPx: (leftPx) => previews.push(leftPx),
      seekTo: () => { throw new Error('unexpected seek'); },
    })).toBe(false);

    expect(previews).toEqual([]);
    expect(root.captured.size).toBe(0);
  });

  it('cancels without seeking on a later release', () => {
    const root = fakeRoot();
    const win = fakeWindow();
    const seeks: number[] = [];

    expect(beginSessionTimelineScrub({
      root,
      windowTarget: win,
      surface: { getBoundingClientRect: () => ({ left: 100 }) },
      scrollOffsetPx: 0,
      pointerId: 3,
      clientX: 132,
      getDurationSecs: () => 10,
      canCommitSeek: () => true,
      previewLeftPx: () => undefined,
      seekTo: (elapsedSecs) => { seeks.push(elapsedSecs); },
    })).toBe(true);

    win.cancel();
    win.up(pointer(3, 148));
    expect(seeks).toEqual([]);
    expect(root.captured.has(3)).toBe(false);
  });

  it('commits a seek while playback is stopped when the zone allows it', () => {
    const root = fakeRoot();
    const win = fakeWindow();
    const seeks: number[] = [];

    expect(beginSessionTimelineScrub({
      root,
      windowTarget: win,
      surface: { getBoundingClientRect: () => ({ left: 100 }) },
      scrollOffsetPx: 0,
      pointerId: 5,
      clientX: 100,
      getDurationSecs: () => 10,
      canCommitSeek: () => true,
      previewLeftPx: () => undefined,
      seekTo: (elapsedSecs) => { seeks.push(elapsedSecs); },
    })).toBe(true);

    win.up(pointer(5, 148));
    expect(seeks).toEqual([6]);
  });

  it('does not commit when the zone refuses on release', () => {
    const root = fakeRoot();
    const win = fakeWindow();
    const seeks: number[] = [];
    const previews: number[] = [];

    expect(beginSessionTimelineScrub({
      root,
      windowTarget: win,
      surface: { getBoundingClientRect: () => ({ left: 100 }) },
      scrollOffsetPx: 0,
      pointerId: 9,
      clientX: 100,
      getDurationSecs: () => 10,
      canCommitSeek: () => false,
      previewLeftPx: (leftPx) => previews.push(leftPx),
      seekTo: (elapsedSecs) => { seeks.push(elapsedSecs); },
    })).toBe(true);

    win.move(pointer(9, 132));
    expect(previews).toEqual([208, 240]);

    win.up(pointer(9, 148));
    expect(seeks).toEqual([]);
    expect(root.captured.has(9)).toBe(false);
  });

  it('re-bases the preview and seek target by a nonzero scroll offset', () => {
    const root = fakeRoot();
    const win = fakeWindow();
    const previews: number[] = [];
    const seeks: number[] = [];

    expect(beginSessionTimelineScrub({
      root,
      windowTarget: win,
      surface: { getBoundingClientRect: () => ({ left: 100 }) },
      scrollOffsetPx: 40,
      pointerId: 11,
      clientX: 140,
      getDurationSecs: () => 10,
      canCommitSeek: () => true,
      previewLeftPx: (leftPx) => previews.push(leftPx),
      seekTo: (elapsedSecs) => { seeks.push(elapsedSecs); },
    })).toBe(true);

    expect(previews).toEqual([288]);
    win.up(pointer(11, 140));
    expect(seeks).toEqual([10]);
  });
});

describe('scrubTimelineLeftPx', () => {
  it('re-bases the surface left edge by the scroll offset', () => {
    expect(scrubTimelineLeftPx(100, 40)).toBe(60);
  });

  it('leaves the surface left edge unchanged at zero offset', () => {
    expect(scrubTimelineLeftPx(100, 0)).toBe(100);
  });

  it('treats a non-finite offset as zero', () => {
    expect(scrubTimelineLeftPx(100, NaN)).toBe(100);
  });
});
