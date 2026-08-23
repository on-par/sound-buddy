// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Live-meter per-tick patch controller (TD-001 slice 6c, #701): a factory
// mirroring spectrum-transport.ts's
// createSpectrumTransport — injected deps so the rAF-coalescing math is
// unit-tested without a DOM or a real requestAnimationFrame. Ports inline-app.js's
// old scheduleLiveMeters/pendingLiveWin/liveRenderScheduled coalescing (meter
// ticks arrive up to ~20/s; the board only needs to repaint once per animation
// frame), now driven by liveCaptureStore. It coalesces ANY store change into
// one patch per animation frame, read via getState() on every notification;
// liveCaptureStore.bindIpcEvents() already owns tick ingestion
// (single source of truth, ADR-0005: per-tick values never round-trip through
// the store's own React subscribers — this controller reads the store directly
// and patches the DOM itself, bypassing React state).

import type { LiveEvent, ChannelWindowData } from './live-capture-panel';

// The full store slice an animation-rate live DOM surface needs, resolved by
// the consumer's getState() on every store notification. Everything the board
// repaint (lastTick) and the header readout (capture state + Room source)
// read rides the same coalesced patch.
export interface LiveMeterSnapshot {
  lastTick: LiveEvent | null;
  isCapturing: boolean;
  measurementSource: number | null;
  lastMeasurementChannels: ChannelWindowData[] | null;
  secondaryActive: boolean;
}

export interface LiveMeterControllerDeps {
  /** store.subscribe — notified on every store change; the controller reads getState() itself to find the latest snapshot. */
  subscribe(onChange: () => void): () => void;
  getState(): LiveMeterSnapshot;
  raf(cb: () => void): number;
  cancelRaf(handle: number): void;
  /** Applies one coalesced store snapshot straight to the DOM (never through React/the store). */
  patch(state: LiveMeterSnapshot): void;
}

export interface LiveMeterController {
  start(): void;
  stop(): void;
}

export function createLiveMeterController(deps: LiveMeterControllerDeps): LiveMeterController {
  let pending: LiveMeterSnapshot | null = null;
  let scheduled = false;
  let rafHandle: number | null = null;
  let unsubscribe: (() => void) | null = null;

  function flush(): void {
    scheduled = false;
    rafHandle = null;
    const snap = pending;
    pending = null;
    if (snap) deps.patch(snap);
  }

  function schedule(snap: LiveMeterSnapshot): void {
    pending = snap;
    if (scheduled) return;
    scheduled = true;
    rafHandle = deps.raf(flush);
  }

  // Every store change is scheduled. Consumers gate their own DOM writes on
  // the snapshot (the board repaint stays gated on isCapturing && lastTick,
  // mirroring renderWorkspace's own guard).
  function onStoreChange(): void {
    schedule(deps.getState());
  }

  function start(): void {
    if (unsubscribe) return;
    unsubscribe = deps.subscribe(onStoreChange);
  }

  function stop(): void {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (rafHandle != null) { deps.cancelRaf(rafHandle); rafHandle = null; }
    scheduled = false;
    pending = null;
  }

  return { start, stop };
}
