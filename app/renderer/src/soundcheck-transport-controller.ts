// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Soundcheck per-tick patch controller (TD-001 slice 6d, #702): a structural
// twin of live-meter-controller.ts, coalescing progress ('elapsed') ticks that
// arrive over sb.onPlaybackEvent into one rAF-per-burst patch. Ports
// inline-app.js's direct #sc-elapsed textContent write, now driven by
// soundcheckStore's lastElapsedTick bypass field instead of the raw IPC event
// (ADR-0005: per-tick values never round-trip through the store's own React
// subscribers — this controller reads the store directly and patches the DOM
// itself, bypassing React state). The per-track meter stream was dropped in
// #760 — the soundcheck playback view shows only tracks, waveform lanes, and
// the playhead, so only the elapsed tick is coalesced.

export interface SoundcheckTransportControllerDeps {
  /** store.subscribe — notified on every store change; the controller reads getState() itself to find the latest ticks. */
  subscribe(onChange: () => void): () => void;
  getState(): {
    lastElapsedTick: { elapsed: number; duration: number } | null;
  };
  raf(cb: () => void): number;
  cancelRaf(handle: number): void;
  /** Applies one coalesced elapsed/duration tick straight to the DOM. */
  patchElapsed(tick: { elapsed: number; duration: number }): void;
  /** Applies one coalesced elapsed/duration tick to the playhead DOM. */
  patchPlayhead(tick: { elapsed: number; duration: number }): void;
}

export interface SoundcheckTransportController {
  start(): void;
  stop(): void;
}

export function createSoundcheckTransportController(deps: SoundcheckTransportControllerDeps): SoundcheckTransportController {
  let pendingElapsed: { elapsed: number; duration: number } | null = null;
  let scheduled = false;
  let rafHandle: number | null = null;
  let unsubscribe: (() => void) | null = null;

  function flush(): void {
    scheduled = false;
    rafHandle = null;
    const elapsed = pendingElapsed;
    pendingElapsed = null;
    if (elapsed) deps.patchElapsed(elapsed);
    if (elapsed) deps.patchPlayhead(elapsed);
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    rafHandle = deps.raf(flush);
  }

  function onStoreChange(): void {
    const state = deps.getState();
    if (state.lastElapsedTick) {
      pendingElapsed = state.lastElapsedTick;
    } else {
      pendingElapsed = null;
      if (rafHandle != null) { deps.cancelRaf(rafHandle); rafHandle = null; }
      scheduled = false;
    }
    if (pendingElapsed) schedule();
  }

  function start(): void {
    if (unsubscribe) return;
    unsubscribe = deps.subscribe(onStoreChange);
  }

  function stop(): void {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (rafHandle != null) { deps.cancelRaf(rafHandle); rafHandle = null; }
    scheduled = false;
    pendingElapsed = null;
  }

  return { start, stop };
}
