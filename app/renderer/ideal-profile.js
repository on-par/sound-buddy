// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the user-defined ideal EQ curve ("Use this file as my ideal").
//
// The built-in IP_PROFILES live inline in index.html; this module owns only the
// new custom-curve construction so it can be unit-tested without a DOM. The
// authoritative grid/comparator is packages/audio-engine/src/profiles/index.ts;
// GRID_POINTS mirrors GRID_POINTS there and IP_GRID_POINTS in the renderer, kept
// in sync by hand (see the e2-10 spike re: drift).
(function (root) {
  'use strict';

  /** Fixed log-frequency grid length (20 Hz–20 kHz), matching the audio-engine. */
  const GRID_POINTS = 48;

  /**
   * Build a level-invariant custom ideal profile from a measured reference curve.
   * The comparator (ipCompare / compareToProfile) mean-subtracts both sides, so
   * only the *shape* matters — we store the curve mean-subtracted, with silent
   * (non-finite) bins filled to 0 (= the mean) so they contribute neutrally
   * instead of poisoning the score with ±Infinity deviations.
   *
   * @param {{ db: number[], freqs?: number[] } | null | undefined} curve The
   *   good-sounding reference file's measured spectrum curve.
   * @param {string} label Human-readable label for the saved curve.
   * @returns {{ id: string, label: string, description: string, dbOffsets: number[] } | null}
   *   Null when there is no usable curve (absent, wrong grid, or too silent to
   *   describe a shape). `freqs` is added by the caller from the shared grid.
   */
  function customProfileFromCurve(curve, label) {
    if (!curve || !Array.isArray(curve.db) || curve.db.length !== GRID_POINTS) return null;
    const finite = curve.db.filter((db) => Number.isFinite(db));
    if (finite.length < 2) return null; // silence / noise floor — no shape to target
    const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
    const dbOffsets = curve.db.map((db) =>
      Number.isFinite(db) ? Math.round((db - mean) * 100) / 100 : 0
    );
    const trimmed = typeof label === 'string' ? label.trim() : '';
    return {
      id: '__custom',
      label: trimmed || 'Custom',
      description: 'From your reference file',
      dbOffsets,
    };
  }

  const api = { GRID_POINTS, customProfileFromCurve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.idealProfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);