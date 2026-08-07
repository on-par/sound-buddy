// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Soundcheck per-tick patch controller (TD-001 slice 6d, #702): a structural
// twin of live-meter-controller.ts, doubled — progress ('elapsed') and level
// ('meter') ticks arrive independently over sb.onPlaybackEvent at different
// rates, so each gets its own pending/scheduled coalescing slot, but both
// share one rAF-per-burst scheduling loop. Ports inline-app.js's direct
// #sc-elapsed textContent write and scRenderMeters, now driven by
// soundcheckStore's lastElapsedTick/lastMeterTick bypass fields instead of
// the raw IPC event (ADR-0005: per-tick values never round-trip through the
// store's own React subscribers — this controller reads the store directly
// and patches the DOM itself, bypassing React state).

import type { SoundcheckMeterTrack } from './soundcheck-panel';

export interface SoundcheckTransportControllerDeps {
  /** store.subscribe — notified on every store change; the controller reads getState() itself to find the latest ticks. */
  subscribe(onChange: () => void): () => void;
  getState(): {
    lastElapsedTick: { elapsed: number; duration: number } | null;
    lastMeterTick: SoundcheckMeterTrack[] | null;
  };
  raf(cb: () => void): number;
  cancelRaf(handle: number): void;
  /** Applies one coalesced elapsed/duration tick straight to the DOM. */
  patchElapsed(tick: { elapsed: number; duration: number }): void;
  /** Applies one coalesced set of per-track meter values straight to the DOM. */
  patchMeters(tracks: SoundcheckMeterTrack[]): void;
}

export interface SoundcheckTransportController {
  start(): void;
  stop(): void;
}

export function createSoundcheckTransportController(deps: SoundcheckTransportControllerDeps): SoundcheckTransportController {
  let pendingElapsed: { elapsed: number; duration: number } | null = null;
  let pendingMeters: SoundcheckMeterTrack[] | null = null;
  let scheduled = false;
  let rafHandle: number | null = null;
  let unsubscribe: (() => void) | null = null;

  function flush(): void {
    scheduled = false;
    rafHandle = null;
    const elapsed = pendingElapsed;
    pendingElapsed = null;
    const meters = pendingMeters;
    pendingMeters = null;
    if (elapsed) deps.patchElapsed(elapsed);
    if (meters) deps.patchMeters(meters);
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    rafHandle = deps.raf(flush);
  }

  function onStoreChange(): void {
    const state = deps.getState();
    if (state.lastElapsedTick) pendingElapsed = state.lastElapsedTick;
    if (state.lastMeterTick) pendingMeters = state.lastMeterTick;
    if (pendingElapsed || pendingMeters) schedule();
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
    pendingMeters = null;
  }

  return { start, stop };
}
