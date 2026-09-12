// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  createLiveMeterController,
  liveMeterSnapshotChanged,
  type LiveMeterControllerDeps,
  type LiveMeterSnapshot,
} from './live-meter-controller';
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
  const runFrameHooks = vi.fn();
  const setFrameLoopActive = vi.fn();
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
    runFrameHooks,
    setFrameLoopActive,
    ...overrides,
  };
  return {
    deps,
    patch,
    raf,
    cancelRaf,
    runFrameHooks,
    setFrameLoopActive,
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

  // #1412 AC3: an idle board (not capturing, no live/playback loop needing frames)
  // must arm no rAF when an unrelated store mutation fires — only a change to a
  // meter-visible field schedules a frame.
  it('does not arm a frame for a store notification that changes nothing meter-visible (AC3)', () => {
    const { deps, notify, setState, raf, flushRaf } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    // First notification establishes a baseline (lastSeen was unset) — always arms.
    setState(makeSnapshot());
    notify();
    expect(raf).toHaveBeenCalledTimes(1);
    flushRaf();
    // A second notification carrying the exact same snapshot moves nothing.
    setState(makeSnapshot());
    notify();
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('arms a frame when only a non-tick meter-visible field changes (e.g. secondaryActive)', () => {
    const { deps, notify, setState, raf, flushRaf } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot());
    notify();
    flushRaf();
    setState(makeSnapshot({ secondaryActive: true }));
    notify();
    expect(raf).toHaveBeenCalledTimes(2);
  });

  // #1412 AC2: the loop stays free-running (self-re-arming) while isCapturing is
  // true, so the playhead keeps advancing every frame even when nothing further
  // notifies the store (a stalled meter tick).
  it('keeps re-arming itself every frame while isCapturing is true, with no further store notifications', () => {
    const { deps, notify, setState, raf, flushRaf, patch } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ isCapturing: true }));
    notify();
    flushRaf(); // frame 1: patches, then self-re-arms because isCapturing is true
    flushRaf(); // frame 2: fires with no intervening notify() at all
    flushRaf(); // frame 3
    expect(patch).toHaveBeenCalledTimes(3);
    // One initial arm from notify() plus one self-re-arm after each of the 3 frames.
    expect(raf).toHaveBeenCalledTimes(4);
  });

  it('stops re-arming once isCapturing flips back to false', () => {
    const { deps, notify, setState, raf, flushRaf } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ isCapturing: true }));
    notify();
    flushRaf(); // self-re-arms
    setState(makeSnapshot({ isCapturing: false }));
    flushRaf(); // reads the now-idle state, does not re-arm
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('runs every registered per-frame hook once per frame fired', () => {
    const { deps, notify, setState, flushRaf, runFrameHooks } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ lastTick: makeTick(1) }));
    notify();
    flushRaf();
    expect(runFrameHooks).toHaveBeenCalledTimes(1);
  });

  it('does not run frame hooks or patch for a frame that fires after stop()', () => {
    const { deps, notify, setState, flushRaf, runFrameHooks, patch } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ lastTick: makeTick(1) }));
    notify();
    controller.stop();
    flushRaf();
    expect(runFrameHooks).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('reports the loop becoming active when a frame is armed and inactive once it settles idle', () => {
    const { deps, notify, setState, flushRaf, setFrameLoopActive } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ lastTick: makeTick(1) }));
    notify();
    expect(setFrameLoopActive).toHaveBeenLastCalledWith(true);
    flushRaf(); // isCapturing false, so this frame does not re-arm
    expect(setFrameLoopActive).toHaveBeenLastCalledWith(false);
  });

  it('reports the loop inactive on stop() even mid-flight', () => {
    const { deps, notify, setState, setFrameLoopActive } = makeFakeDeps();
    const controller = createLiveMeterController(deps);
    controller.start();
    setState(makeSnapshot({ lastTick: makeTick(1) }));
    notify();
    controller.stop();
    expect(setFrameLoopActive).toHaveBeenLastCalledWith(false);
  });

  // Before #1412 the meter patch and the playhead ticker were two independent rAF
  // loops, so a throw in one could never stop the other. Consolidating them into one
  // frame() must not accidentally couple their failure modes back together.
  describe('resilience to a throwing patch or frame hook (#1412)', () => {
    it('a throwing patch does not prevent the registered frame hooks from running the same frame', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { deps, notify, setState, flushRaf, runFrameHooks } = makeFakeDeps({
        patch: vi.fn(() => { throw new Error('boom'); }),
      });
      const controller = createLiveMeterController(deps);
      controller.start();
      setState(makeSnapshot({ lastTick: makeTick(1) }));
      notify();
      flushRaf();
      expect(runFrameHooks).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it('a throwing patch does not stop the loop from self-re-arming while isCapturing', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { deps, notify, setState, flushRaf, raf } = makeFakeDeps({
        patch: vi.fn(() => { throw new Error('boom'); }),
      });
      const controller = createLiveMeterController(deps);
      controller.start();
      setState(makeSnapshot({ isCapturing: true }));
      notify();
      flushRaf(); // throws inside patch, but must still self-re-arm
      expect(raf).toHaveBeenCalledTimes(2);
      errorSpy.mockRestore();
    });

    it('a throwing frame hook does not stop the loop from self-re-arming while isCapturing', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { deps, notify, setState, flushRaf, raf } = makeFakeDeps({
        runFrameHooks: vi.fn(() => { throw new Error('boom'); }),
      });
      const controller = createLiveMeterController(deps);
      controller.start();
      setState(makeSnapshot({ isCapturing: true }));
      notify();
      flushRaf();
      expect(raf).toHaveBeenCalledTimes(2);
      errorSpy.mockRestore();
    });

    it('logs a throwing patch instead of letting it propagate out of the rAF callback', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { deps, notify, setState, flushRaf } = makeFakeDeps({
        patch: vi.fn(() => { throw new Error('boom'); }),
      });
      const controller = createLiveMeterController(deps);
      controller.start();
      setState(makeSnapshot({ lastTick: makeTick(1) }));
      notify();
      expect(() => flushRaf()).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});

describe('liveMeterSnapshotChanged', () => {
  it('is false for two snapshots with identical field values', () => {
    expect(liveMeterSnapshotChanged(makeSnapshot(), makeSnapshot())).toBe(false);
  });

  it('is true when lastTick differs', () => {
    expect(liveMeterSnapshotChanged(makeSnapshot(), makeSnapshot({ lastTick: makeTick(1) }))).toBe(true);
  });

  it('is true when isCapturing differs', () => {
    expect(liveMeterSnapshotChanged(makeSnapshot(), makeSnapshot({ isCapturing: true }))).toBe(true);
  });

  it('is true when measurementSource differs', () => {
    expect(liveMeterSnapshotChanged(makeSnapshot(), makeSnapshot({ measurementSource: 2 }))).toBe(true);
  });

  it('is true when lastMeasurementChannels differs', () => {
    expect(liveMeterSnapshotChanged(makeSnapshot(), makeSnapshot({ lastMeasurementChannels: [] }))).toBe(true);
  });

  it('is true when secondaryActive differs', () => {
    expect(liveMeterSnapshotChanged(makeSnapshot(), makeSnapshot({ secondaryActive: true }))).toBe(true);
  });
});
