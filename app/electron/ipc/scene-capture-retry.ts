// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Scene capture retry policy (#1490): the 2103-path walk in
// console-scene-capture.ts used to throw on the very first `/node` that
// missed its retry budget, wasting the whole ~23s walk on one flaky reply.
// This module owns the defer-and-sweep policy as pure functions — no
// sockets, no Electron, no timers — so the walk can defer a miss, keep
// going, and give the console one settled second chance at the end instead
// of aborting at query 2 of 2103.
//
// Root-cause theory (docs/discovery/1490-m32r-node-walk-timeout.md): the
// desk silently refuses a 5th concurrent client (ADR-0063/0079) rather than
// erroring, which is indistinguishable from a genuinely dropped `/node`
// reply. A single miss is deferred rather than fatal; a run of misses (or
// too many scattered ones) still fails fast rather than walking a dead
// console for the full ~23s.

/** Walk-phase budget: raised from the connection-lifecycle default (350ms x3) per #1490. */
export const WALK_QUERY_TIMEOUT_MS = 500;
export const WALK_QUERY_MAX_RETRIES = 4;

/** Sweep-phase budget: escalated further, since only the walk's leftover gaps reach it. */
export const SWEEP_QUERY_TIMEOUT_MS = 1000;
export const SWEEP_QUERY_MAX_RETRIES = 3;

// 4 consecutive misses at the walk budget (500ms x5 attempts = 2.5s each) is
// ~10s — a bound on how long a genuinely dead/refusing console can hang the
// walk before the operator sees an error, rather than the ~87 minutes a full
// 2103-path exhaustion would take.
export const CONSECUTIVE_FAILURE_BREAKER_LIMIT = 4;

// Caps the sweep's worst case for a console that fails scattered (not
// consecutive) paths instead of a solid run — 12 gaps is already an unusual
// desk, and sweeping hundreds one by one is not a "transient miss" anymore.
export const DEFERRED_PATH_CAP = 12;

// Gives a console that is silently refusing a 5th client (ADR-0063/0079) a
// moment for another client's poll cycle to release a slot before the sweep
// re-queries the gaps — tunable; see docs/discovery/1490-m32r-node-walk-timeout.md.
export const SWEEP_SETTLE_PAUSE_MS = 1000;

export interface SceneCaptureWalkState {
  readonly deferred: string[];
  consecutiveFailures: number;
}

export function createSceneCaptureWalkState(): SceneCaptureWalkState {
  return { deferred: [], consecutiveFailures: 0 };
}

export function recordWalkSuccess(state: SceneCaptureWalkState): void {
  state.consecutiveFailures = 0;
}

export function recordWalkFailure(state: SceneCaptureWalkState, path: string): void {
  state.deferred.push(path);
  state.consecutiveFailures += 1;
}

/** True once the walk should stop deferring and fail fast instead of finishing the table. */
export function isWalkBreakerTripped(state: SceneCaptureWalkState): boolean {
  return (
    state.consecutiveFailures >= CONSECUTIVE_FAILURE_BREAKER_LIMIT ||
    state.deferred.length >= DEFERRED_PATH_CAP
  );
}

// The exact wording console-scene-capture.ts threw before #1490 — preserved
// here as the one place that builds it, so the walk-abort path (breaker
// tripped) and the post-sweep failure path read identically to the operator.
export function buildSceneCaptureFailureMessage(
  ip: string,
  path: string,
  capturedCount: number,
  totalCount: number,
  err: unknown
): string {
  return (
    `Scene capture failed: the console at ${ip} did not answer "${path}" ` +
    `(${capturedCount} of ${totalCount} paths captured). Nothing was saved — ` +
    `check the console is still powered on and reachable, then run the capture again. ` +
    `(${String(err)})`
  );
}
