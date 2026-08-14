// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createSoundcheckTransportController, type SoundcheckTransportControllerDeps } from './soundcheck-transport-controller';
import type { SoundcheckMeterTrack } from './soundcheck-panel';

type ElapsedTick = { elapsed: number; duration: number };

function makeFakeDeps(overrides: Partial<SoundcheckTransportControllerDeps> = {}) {
  let queued: (() => void) | null = null;
  let nextHandle = 1;
  let lastElapsedTick: ElapsedTick | null = null;
  let lastMeterTick: SoundcheckMeterTrack[] | null = null;
  const listeners = new Set<() => void>();
  const patchElapsed = vi.fn();
  const patchPlayhead = vi.fn();
  const patchMeters = vi.fn();
  const cancelRaf = vi.fn();
  const raf = vi.fn((cb: () => void) => {
    queued = cb;
    return nextHandle++;
  });
  const deps: SoundcheckTransportControllerDeps = {
    subscribe: (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    getState: () => ({ lastElapsedTick, lastMeterTick }),
    raf,
    cancelRaf,
    patchElapsed,
    patchPlayhead,
    patchMeters,
    ...overrides,
  };
  return {
    deps,
    patchElapsed,
    patchPlayhead,
    patchMeters,
    raf,
    cancelRaf,
    notifyElapsed(tick: ElapsedTick) { lastElapsedTick = tick; listeners.forEach((l) => l()); },
    notifyMeters(tracks: SoundcheckMeterTrack[]) { lastMeterTick = tracks; listeners.forEach((l) => l()); },
    notifyUnrelated() { listeners.forEach((l) => l()); },
    flushRaf() { const cb = queued; queued = null; if (cb) cb(); },
    listenerCount: () => listeners.size,
  };
}

describe('createSoundcheckTransportController', () => {
  it('does nothing until start() is called', () => {
    const { deps, notifyElapsed, raf } = makeFakeDeps();
    createSoundcheckTransportController(deps);
    notifyElapsed({ elapsed: 1, duration: 10 });
    expect(raf).not.toHaveBeenCalled();
  });

  it('coalesces a burst of elapsed ticks into one rAF and one patch', () => {
    const { deps, notifyElapsed, raf, flushRaf, patchElapsed } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    notifyElapsed({ elapsed: 1, duration: 10 });
    notifyElapsed({ elapsed: 2, duration: 10 });
    notifyElapsed({ elapsed: 3, duration: 10 });
    expect(raf).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(patchElapsed).toHaveBeenCalledTimes(1);
    expect(patchElapsed).toHaveBeenCalledWith({ elapsed: 3, duration: 10 });
  });

  it('flushes elapsed and meter ticks independently within the same frame', () => {
    const { deps, notifyElapsed, notifyMeters, raf, flushRaf, patchElapsed, patchMeters } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    const tracks: SoundcheckMeterTrack[] = [{ label: 'Vocal', rms: -20, peak: -10, clipping: false }];
    notifyElapsed({ elapsed: 1, duration: 10 });
    notifyMeters(tracks);
    // One coalesced burst still schedules only one rAF, even though it carries two independent tick kinds.
    expect(raf).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(patchElapsed).toHaveBeenCalledWith({ elapsed: 1, duration: 10 });
    expect(patchMeters).toHaveBeenCalledWith(tracks);
  });

  it('patches the playhead on the same coalesced elapsed tick as the readout', () => {
    const { deps, notifyElapsed, raf, flushRaf, patchElapsed, patchPlayhead } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    notifyElapsed({ elapsed: 1, duration: 10 });
    notifyElapsed({ elapsed: 2, duration: 10 });
    notifyElapsed({ elapsed: 3, duration: 10 });
    expect(raf).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(patchElapsed).toHaveBeenCalledTimes(1);
    expect(patchElapsed).toHaveBeenCalledWith({ elapsed: 3, duration: 10 });
    expect(patchPlayhead).toHaveBeenCalledTimes(1);
    expect(patchPlayhead).toHaveBeenCalledWith({ elapsed: 3, duration: 10 });
  });

  it('does not patch the playhead on a meter-only tick', () => {
    const { deps, notifyMeters, flushRaf, patchMeters, patchPlayhead } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    notifyMeters([{ rms: -10, peak: -5, clipping: false }]);
    flushRaf();
    expect(patchMeters).toHaveBeenCalledTimes(1);
    expect(patchPlayhead).not.toHaveBeenCalled();
  });

  it('patches only the tick kind that changed', () => {
    const { deps, notifyMeters, flushRaf, patchElapsed, patchMeters } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    notifyMeters([{ rms: -10, peak: -5, clipping: false }]);
    flushRaf();
    expect(patchMeters).toHaveBeenCalledTimes(1);
    expect(patchElapsed).not.toHaveBeenCalled();
  });

  it('does not schedule on a store notification with neither tick present', () => {
    const { deps, raf, notifyUnrelated } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    notifyUnrelated();
    expect(raf).not.toHaveBeenCalled();
  });

  it('start() is idempotent — a second call does not double-subscribe', () => {
    const { deps, listenerCount } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    controller.start();
    expect(listenerCount()).toBe(1);
  });

  it('stop() unsubscribes and cancels a pending rAF without patching', () => {
    const { deps, notifyElapsed, raf, cancelRaf, patchElapsed, listenerCount, flushRaf } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    notifyElapsed({ elapsed: 1, duration: 10 });
    expect(raf).toHaveBeenCalledTimes(1);
    controller.stop();
    expect(cancelRaf).toHaveBeenCalledWith(1);
    expect(listenerCount()).toBe(0);
    flushRaf();
    expect(patchElapsed).not.toHaveBeenCalled();
  });

  it('stop() before start() is a safe no-op', () => {
    const { deps, cancelRaf } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    expect(() => controller.stop()).not.toThrow();
    expect(cancelRaf).not.toHaveBeenCalled();
  });

  it('restarting after stop() resubscribes and resumes coalescing', () => {
    const { deps, notifyElapsed, raf, flushRaf, patchElapsed, listenerCount } = makeFakeDeps();
    const controller = createSoundcheckTransportController(deps);
    controller.start();
    controller.stop();
    expect(listenerCount()).toBe(0);
    controller.start();
    expect(listenerCount()).toBe(1);
    notifyElapsed({ elapsed: 9, duration: 10 });
    flushRaf();
    expect(patchElapsed).toHaveBeenCalledWith({ elapsed: 9, duration: 10 });
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
