// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createLiveMeterController, type LiveMeterControllerDeps, type LiveMeterSnapshot } from './live-meter-controller';
import type { LiveEvent } from './live-capture-panel';

function makeTick(window: number): LiveEvent {
  return { type: 'window', window, channels: [] } as unknown as LiveEvent;
}

function makeSnapshot(overrides: Partial<LiveMeterSnapshot> = {}): LiveMeterSnapshot {
  return {
    lastTick: null,
    isCapturing: false,
    measurementSource: null,
    lastMeasurementChannels: null,
    secondaryActive: false,
    ...overrides,
  };
}

// A fake raf that never auto-fires — tests flush it explicitly via `flushRaf()`
// so the coalescing behavior (one patch per animation frame) is deterministic.
// The store is faked as a mutable snapshot (`setState`) the controller reads
// via getState() on every notification, mirroring how liveCaptureStore
// publishes board shape + capture state + tick.
function makeFakeDeps(overrides: Partial<LiveMeterControllerDeps> = {}) {
  let queued: (() => void) | null = null;
  let nextHandle = 1;
  let state: LiveMeterSnapshot = makeSnapshot();
  const listeners = new Set<() => void>();
  const patch = vi.fn();
  const cancelRaf = vi.fn();
  const raf = vi.fn((cb: () => void) => {
    queued = cb;
    return nextHandle++;
  });
  const deps: LiveMeterControllerDeps = {
    subscribe: (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    getState: () => state,
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
    setState(next: LiveMeterSnapshot) { state = next; },
    notify() { listeners.forEach((l) => l()); },
    flushRaf() { const cb = queued; queued = null; if (cb) cb(); },
    listenerCount: () => listeners.size,
  };
}

describe('createLiveMeterController', () => {
  it('does nothing until start() is called', () => {
    const { deps, notify, raf } = makeFakeDeps();
    createLiveMeterController(deps);
    notify();
    expect(raf).not.toHaveBeenCalled();
  });

  it('schedules exactly one rAF per burst of store notifications', () => {
    const { deps, notify, setState, raf, flushRaf, patch } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ lastTick: makeTick(1) }));
    notify();
    setState(makeSnapshot({ lastTick: makeTick(2) }));
    notify();
    setState(makeSnapshot({ lastTick: makeTick(3) }));
    notify();
    expect(raf).toHaveBeenCalledTimes(1);
    flushRaf();
    // Only the latest snapshot of the coalesced burst is patched.
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(makeSnapshot({ lastTick: makeTick(3) }));
  });

  it('schedules a fresh rAF for the next burst after a flush', () => {
    const { deps, notify, setState, raf, flushRaf } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ lastTick: makeTick(1) }));
    notify();
    flushRaf();
    setState(makeSnapshot({ lastTick: makeTick(2) }));
    notify();
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('schedules a patch on a store notification with no tick yet (capture start/stop visibility flip)', () => {
    const { deps, notify, setState, raf, flushRaf, patch } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    // A store change that carries no tick (e.g. isCapturing flipping on start,
    // before any meter data has arrived) must still coalesce into a patch —
    // the header readout's visibility depends on it.
    setState(makeSnapshot({ isCapturing: true }));
    notify();
    expect(raf).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(patch).toHaveBeenCalledWith(makeSnapshot({ isCapturing: true }));
  });

  it('start() is idempotent — a second call does not double-subscribe', () => {
    const { deps, listenerCount } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    controller.start();
    expect(listenerCount()).toBe(1);
  });

  it('stop() unsubscribes and cancels a pending rAF without patching', () => {
    const { deps, notify, setState, raf, cancelRaf, patch, listenerCount, flushRaf } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ lastTick: makeTick(1) }));
    notify();
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
    const { deps, notify, setState, raf, flushRaf, patch, listenerCount } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    controller.stop();
    expect(listenerCount()).toBe(0);
    controller.start();
    expect(listenerCount()).toBe(1);
    setState(makeSnapshot({ lastTick: makeTick(9) }));
    notify();
    flushRaf();
    expect(patch).toHaveBeenCalledWith(makeSnapshot({ lastTick: makeTick(9) }));
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
