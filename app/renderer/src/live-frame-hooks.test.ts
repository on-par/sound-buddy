// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import {
  registerLiveFrameHook,
  runLiveFrameHooks,
  isLiveFrameLoopActive,
  setLiveFrameLoopActive,
} from './live-frame-hooks';

// This module is a mutable singleton (mirroring session-timeline-scale.ts), so every
// test tracks and reverses its own registrations/flag flips rather than relying on
// vitest's module isolation.
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  setLiveFrameLoopActive(false);
});

describe('registerLiveFrameHook / runLiveFrameHooks', () => {
  it('runs a registered hook when the frame loop fires', () => {
    let calls = 0;
    cleanups.push(registerLiveFrameHook(() => { calls++; }));
    runLiveFrameHooks();
    expect(calls).toBe(1);
  });

  it('runs every registered hook, in registration order', () => {
    const order: string[] = [];
    cleanups.push(registerLiveFrameHook(() => order.push('a')));
    cleanups.push(registerLiveFrameHook(() => order.push('b')));
    runLiveFrameHooks();
    expect(order).toEqual(['a', 'b']);
  });

  it('runs a hook again on every subsequent call, not just once', () => {
    let calls = 0;
    cleanups.push(registerLiveFrameHook(() => { calls++; }));
    runLiveFrameHooks();
    runLiveFrameHooks();
    expect(calls).toBe(2);
  });

  it('the returned unregister function stops the hook from running', () => {
    let calls = 0;
    const unregister = registerLiveFrameHook(() => { calls++; });
    unregister();
    runLiveFrameHooks();
    expect(calls).toBe(0);
  });

  it('unregistering one hook leaves the others running', () => {
    let aCalls = 0;
    let bCalls = 0;
    const unregisterA = registerLiveFrameHook(() => { aCalls++; });
    cleanups.push(registerLiveFrameHook(() => { bCalls++; }));
    unregisterA();
    runLiveFrameHooks();
    expect(aCalls).toBe(0);
    expect(bCalls).toBe(1);
  });

  it('running with no hooks registered is a safe no-op', () => {
    expect(() => runLiveFrameHooks()).not.toThrow();
  });
});

describe('isLiveFrameLoopActive / setLiveFrameLoopActive', () => {
  it('defaults to inactive', () => {
    expect(isLiveFrameLoopActive()).toBe(false);
  });

  it('reflects the most recent value set', () => {
    setLiveFrameLoopActive(true);
    expect(isLiveFrameLoopActive()).toBe(true);
    setLiveFrameLoopActive(false);
    expect(isLiveFrameLoopActive()).toBe(false);
  });
});
