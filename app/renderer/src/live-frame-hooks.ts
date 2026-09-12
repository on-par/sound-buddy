// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Live tab's ONE per-frame hook registry (#1412): live-meter-controller.ts is the
// sole owner of the Live rAF loop — no other Live module may schedule its own
// requestAnimationFrame loop (this story's ADR-0134). A module that needs an
// every-frame callback while that loop is running (LiveCapturePanel's playhead ticker,
// daw-shell-runtime's waveform flush) registers a hook here instead; the controller's
// frame function runs every registered hook once per frame it fires. Mirrors
// session-timeline-scale.ts's shape — a small module-singleton with a handful of pure
// accessors — so a reader familiar with that module recognizes this one's pattern.

export type LiveFrameHook = () => void;

const hooks = new Set<LiveFrameHook>();
let frameLoopActive = false;

/** Registers a callback to run on every Live frame while the shared loop (owned by
 *  live-meter-controller.ts) fires. Returns the unregister function — callers hand it
 *  back as their effect's cleanup so a stale closure never outlives its component. */
export function registerLiveFrameHook(hook: LiveFrameHook): () => void {
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

/** Runs every currently registered hook once, in registration order. Called by
 *  live-meter-controller.ts's frame function — hooks never call this themselves. */
export function runLiveFrameHooks(): void {
  for (const hook of hooks) hook();
}

/** Whether the shared Live frame loop is currently scheduled/looping. Mirrored here by
 *  live-meter-controller.ts on every scheduling transition (setFrameLoopActive below),
 *  so a module with no direct reference to the controller instance — daw-shell-runtime's
 *  peaks ingest, wired up in App.tsx rather than LiveWorkspace.tsx, where the controller
 *  actually lives — can still tell whether to piggyback on this loop instead of
 *  scheduling a second one of its own. */
export function isLiveFrameLoopActive(): boolean {
  return frameLoopActive;
}

/** Sets the shared Live frame loop's active flag — called only by
 *  live-meter-controller.ts. */
export function setLiveFrameLoopActive(active: boolean): void {
  frameLoopActive = active;
}
