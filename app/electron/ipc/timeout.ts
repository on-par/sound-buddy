// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Shared abort-detection predicate (#125) — the single source of truth for
// "was this rejection caused by an AbortSignal", reused by every caller that
// needs to tell a user cancellation apart from a genuine failure.
//
// This is a deliberate, drift-tested duplicate of
// packages/audio-engine/src/analyze/timeout.ts's isAbortError rather than a
// loadBundledCjs('engine', ...) call (#745): its only caller, run-analysis.ts,
// is documented as "Pure, Electron-free run orchestration... unit-testable
// without a fake Electron event.sender", and loadBundledCjs transitively
// imports Electron's `app` — routing this predicate through it would give
// run-analysis.ts an Electron/dist-cjs-build dependency it doesn't otherwise
// have. timeout.test.ts's drift guard asserts the two copies stay identical.
export function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string } | null | undefined;
  return e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
}
