// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Live/Session board's markup is a dangerouslySetInnerHTML string
// (LiveCapturePanel.tsx). Reading the raw wall-clock playhead at React
// render time and seeding it straight into that string rewrites the whole
// board — destroying and recreating every waveform canvas — on every render
// (#1376). Quantizing the value at the render boundary keeps the markup
// byte-identical across renders that fall inside the same whole second.

/** The board markup's coarsest displayed time resolution: the transport readout is M:SS and the
 *  overview total label is formatted from the same whole-second rule, so no rendered value can
 *  change faster than once per second. Quantizing to a finer step would buy nothing and would
 *  reintroduce per-render markup churn. */
export const RENDER_STABLE_ELAPSED_QUANTUM_MS = 1000;

/** The capture playhead's elapsed ms as the REACT RENDER path may read it: floored to
 *  RENDER_STABLE_ELAPSED_QUANTUM_MS so every render inside one second derives the same markup
 *  string, the same tracked zoom duration and the same paint scale. Non-finite or negative input
 *  resolves to 0 rather than NaN (same guard convention as daw-playhead-state.js's
 *  formatElapsed). Imperative animation-rate painters must NOT use this — they read the raw
 *  clock and stay smooth (ADR-0005). */
export function renderStableElapsedMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / RENDER_STABLE_ELAPSED_QUANTUM_MS) * RENDER_STABLE_ELAPSED_QUANTUM_MS;
}
