// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createLiveMeterController, type LiveMeterControllerDeps } from './live-meter-controller';
import type { LiveEvent } from './live-capture-panel';

function makeTick(window: number): LiveEvent {
  return { type: 'window', window, channels: [] } as unknown as LiveEvent;
}

// A fake raf that never auto-fires — tests flush it explicitly via `flushRaf()`
// so the coalescing behavior (one patch per animation frame) is deterministic.
function makeFakeDeps(overrides: Partial<LiveMeterControllerDeps> = {}) {
  let queued: (() => void) | null = null;
  let nextHandle = 1;
  let lastTick: LiveEvent | null = null;
  const listeners = new Set<() => void>();
  const patch = vi.fn();
  const cancelRaf = vi.fn();
  const raf = vi.fn((cb: () => void) => {
    queued = cb;
    return nextHandle++;
  });
  const deps: LiveMeterControllerDeps = {
    subscribe: (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    getState: () => ({ lastTick }),
    raf,
    cancelRaf,
    patch,
    ...overrides,
  };
  return {
    deps,
    patch,
    raf,
    cancelRaf,
    notify(tick: LiveEvent) { lastTick = tick; listeners.forEach((l) => l()); },
    notifyWithoutTick() { listeners.forEach((l) => l()); },
    flushRaf() { const cb = queued; queued = null; if (cb) cb(); },
    listenerCount: () => listeners.size,
  };
}

describe('createLiveMeterController', () => {
  it('does nothing until start() is called', () => {
    const { deps, notify, raf } = makeFakeDeps();
    createLiveMeterController(deps);
    notify(makeTick(1));
    expect(raf).not.toHaveBeenCalled();
  });

  it('schedules exactly one rAF per burst of store notifications', () => {
    const { deps, notify, raf, flushRaf, patch } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    notify(makeTick(1));
    notify(makeTick(2));
    notify(makeTick(3));
    expect(raf).toHaveBeenCalledTimes(1);
    flushRaf();
    // Only the latest tick of the coalesced burst is patched.
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(makeTick(3));
  });

  it('schedules a fresh rAF for the next burst after a flush', () => {
    const { deps, notify, raf, flushRaf } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    notify(makeTick(1));
    flushRaf();
    notify(makeTick(2));
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('does not schedule when the store notifies with no tick yet', () => {
    const { deps, raf, notifyWithoutTick } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    // A store change unrelated to lastTick (e.g. a shape-only update) fires
    // the subscriber while getState().lastTick is still null.
    notifyWithoutTick();
    expect(raf).not.toHaveBeenCalled();
  });

  it('start() is idempotent — a second call does not double-subscribe', () => {
    const { deps, listenerCount } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    controller.start();
    expect(listenerCount()).toBe(1);
  });

  it('stop() unsubscribes and cancels a pending rAF without patching', () => {
    const { deps, notify, raf, cancelRaf, patch, listenerCount, flushRaf } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    notify(makeTick(1));
    expect(raf).toHaveBeenCalledTimes(1);
    controller.stop();
    expect(cancelRaf).toHaveBeenCalledWith(1);
    expect(listenerCount()).toBe(0);
    // A queued rAF callback that fires after stop() (can't actually happen
    // once cancelRaf ran on a real browser, but guards the fake here too) —
    // flushing it must not resurrect a patch call.
    flushRaf();
    expect(patch).not.toHaveBeenCalled();
  });

  it('stop() before start() is a safe no-op', () => {
    const { deps, cancelRaf } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    expect(() => controller.stop()).not.toThrow();
    expect(cancelRaf).not.toHaveBeenCalled();
  });

  it('restarting after stop() resubscribes and resumes coalescing', () => {
    const { deps, notify, raf, flushRaf, patch, listenerCount } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    controller.stop();
    expect(listenerCount()).toBe(0);
    controller.start();
    expect(listenerCount()).toBe(1);
    notify(makeTick(9));
    flushRaf();
    expect(patch).toHaveBeenCalledWith(makeTick(9));
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
