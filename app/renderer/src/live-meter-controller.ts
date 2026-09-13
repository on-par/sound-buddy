// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Live-meter per-tick patch controller (TD-001 slice 6c, #701; consolidated into the
// Live tab's ONE rAF loop, #1412 — this story's ADR-0134): a factory mirroring
// spectrum-transport.ts's createSpectrumTransport — injected deps so the
// rAF-coalescing math is unit-tested without a DOM or a real requestAnimationFrame.
// Ports inline-app.js's old scheduleLiveMeters/pendingLiveWin/liveRenderScheduled
// coalescing (meter ticks arrive up to ~20/s; the board only needs to repaint once per
// animation frame), now driven by liveCaptureStore. liveCaptureStore.bindIpcEvents()
// already owns tick ingestion (single source of truth, ADR-0005: per-tick values never
// round-trip through the store's own React subscribers — this controller reads the
// store directly and patches the DOM itself, bypassing React state).
//
// #1412 folded two other Live rAF loops into this one instead of leaving each to
// schedule its own frame: LiveCapturePanel's playhead ticker and
// daw-shell-runtime's waveform-peaks repaint now register a per-frame hook
// (live-frame-hooks.ts) that this controller's frame() runs on every frame it fires,
// rather than each owning a competing requestAnimationFrame loop. The frame loop has
// two halves: a one-shot half (onStoreChange) that arms a frame only when a
// meter-visible field actually changed (AC3 — an idle board with no capture/playback
// arms nothing), and a free-running half (frame() re-arming itself while
// snapshot.isCapturing) that keeps the playhead advancing through a stalled meter tick
// (AC2) without waiting for another store notification to wake it back up.

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

/** True when a field an animation-rate Live surface reads has moved between two
 *  snapshots — the pure predicate #1412's one-shot scheduling gates on (AC3: a store
 *  notification that changes none of these fields arms no frame). Pure and exported so
 *  it is unit-tested on its own, independent of the rAF-coalescing machinery around it. */
export function liveMeterSnapshotChanged(prev: LiveMeterSnapshot, next: LiveMeterSnapshot): boolean {
  return (
    prev.lastTick !== next.lastTick ||
    prev.isCapturing !== next.isCapturing ||
    prev.measurementSource !== next.measurementSource ||
    prev.lastMeasurementChannels !== next.lastMeasurementChannels ||
    prev.secondaryActive !== next.secondaryActive
  );
}

export interface LiveMeterControllerDeps {
  /** store.subscribe — notified on every store change; the controller reads getState() itself to find the latest snapshot. */
  subscribe(onChange: () => void): () => void;
  getState(): LiveMeterSnapshot;
  raf(cb: () => void): number;
  cancelRaf(handle: number): void;
  /** Applies one coalesced store snapshot straight to the DOM (never through React/the store). */
  patch(state: LiveMeterSnapshot): void;
  /** Runs every hook registered on live-frame-hooks.ts, once per frame this loop
   *  fires — the mechanism by which this controller stays the Live tab's one rAF
   *  owner while still driving other modules' per-frame work (the playhead ticker,
   *  the waveform flush). Optional: there is currently exactly one controller
   *  instance (LiveWorkspace.tsx's) that needs to drive it. */
  runFrameHooks?(): void;
  /** Mirrors this controller's scheduled/looping state out to live-frame-hooks.ts on
   *  every transition, so a module with no reference to this controller instance
   *  (daw-shell-runtime's peaks ingest, wired up in App.tsx) can tell whether to
   *  piggyback on this loop instead of scheduling its own. Optional for the same
   *  reason as runFrameHooks. */
  setFrameLoopActive?(active: boolean): void;
}

export interface LiveMeterController {
  start(): void;
  stop(): void;
}

export function createLiveMeterController(deps: LiveMeterControllerDeps): LiveMeterController {
  let scheduled = false;
  let rafHandle: number | null = null;
  let unsubscribe: (() => void) | null = null;
  let active = false;
  let lastSeen: LiveMeterSnapshot | null = null;

  function setScheduled(next: boolean): void {
    if (scheduled === next) return;
    scheduled = next;
    deps.setFrameLoopActive?.(next);
  }

  // A throwing patch or per-frame hook must not break anything else this frame is
  // responsible for: not the other of the two, and not the loop's own re-arm below.
  // This is exactly why consolidating three independent rAF loops into one is safe —
  // before #1412, a throw in the meter patch and a throw in the playhead ticker were
  // two different callbacks on two different frames and could never affect each
  // other; folding them into one function must not accidentally couple their
  // failure modes. Logged, not silently swallowed, so a real consumer bug stays
  // visible.
  function runSafely(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`live-meter-controller: ${label} threw`, err);
    }
  }

  // The loop's one frame body: reads getState() fresh (never a cached "pending"
  // snapshot from schedule time, so a snapshot that changed again between arming and
  // firing is never patched stale), patches it, runs every registered per-frame hook,
  // then re-arms itself while isCapturing — the free-running half of the loop (see
  // module comment above).
  function frame(): void {
    setScheduled(false);
    rafHandle = null;
    if (!active) return;
    const snap = deps.getState();
    lastSeen = snap;
    runSafely('patch', () => deps.patch(snap));
    runSafely('a frame hook', () => deps.runFrameHooks?.());
    if (snap.isCapturing) arm();
  }

  // Both call sites (onStoreChange and frame() below) only ever call this when
  // scheduled is already false, so it needs no re-entrancy guard of its own.
  function arm(): void {
    setScheduled(true);
    rafHandle = deps.raf(frame);
  }

  // The one-shot half of the loop: a store notification arms a frame only when a
  // meter-visible field actually moved (AC3) or on the very first notification ever
  // seen (lastSeen unset). While a frame is already scheduled — armed here or
  // self-armed by frame() above — this is a no-op: frame() always reads getState()
  // fresh, so the pending frame already covers whatever just changed.
  function onStoreChange(): void {
    if (scheduled) return;
    const snap = deps.getState();
    if (lastSeen === null || liveMeterSnapshotChanged(lastSeen, snap)) arm();
  }

  function start(): void {
    if (unsubscribe) return;
    active = true;
    unsubscribe = deps.subscribe(onStoreChange);
  }

  function stop(): void {
    active = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (rafHandle != null) { deps.cancelRaf(rafHandle); rafHandle = null; }
    setScheduled(false);
  }

  return { start, stop };
}
