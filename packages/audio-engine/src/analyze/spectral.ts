// Shared spectral-analysis core (dedupe #2/#15 FFT work). The FFT itself is
// already shared upstream in spectrum.py (one STFT feeding the fixed
// log-grid SpectrumCurve); these primitives operate on that curve.
// `findSpectralPeaks` serves #15 feedback ring-out peak-picking, `bandEnergy`
// serves #2 harshness band-energy comparison. Both are grid-agnostic — a
// finer curve later needs no API change.

import type { SpectrumCurve } from "../types.js";

/** A peak must stand at least this many dB above its local envelope. */
const DEFAULT_MIN_PROMINENCE_DB = 6;
/** Half-width (grid points) of the envelope moving average. */
const DEFAULT_ENVELOPE_HALF_WINDOW = 3;
/** Cap on the number of peaks returned. */
const DEFAULT_MAX_PEAKS = 8;

export interface SpectralPeak {
  /** Index into the curve's freqs/db arrays. */
  index: number;
  /** Center frequency of the peak (Hz). */
  freq: number;
  /** Level at the peak (dB). */
  db: number;
  /** dB the peak stands above the local spectral envelope (its "narrowness"). */
  prominence: number;
}

export interface FindPeaksOptions {
  /** Min dB above the local envelope to count as a peak. Default 6. */
  minProminenceDb?: number;
  /** Half-width (grid points) of the envelope moving average. Default 3. */
  envelopeHalfWindow?: number;
  /** Max peaks returned. Default 8. */
  maxPeaks?: number;
  /** Ignore peaks whose absolute level is below this (dB). Default -Infinity (off). */
  minDb?: number;
}

/** Mean of the finite entries of `xs` (ignores −inf/NaN silence floors); -Infinity if none. */
function finiteMean(xs: number[]): number {
  let sum = 0;
  let n = 0;
  for (const x of xs) {
    if (Number.isFinite(x)) {
      sum += x;
      n += 1;
    }
  }
  return n > 0 ? sum / n : -Infinity;
}

/**
 * Smoothed baseline that a resonant peak stands proud of. For each index `i`,
 * the mean of the finite entries in `db[i-halfWindow .. i+halfWindow]` (window
 * clamped at the array ends). An all-non-finite window yields -Infinity, so a
 * lone finite bin still reads as a peak against silence.
 */
export function localEnvelope(db: number[], halfWindow: number): number[] {
  const last = db.length - 1;
  return db.map((_, i) => {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(last, i + halfWindow);
    return finiteMean(db.slice(lo, hi + 1));
  });
}

/**
 * Find resonant peaks in a spectrum curve: local maxima that stand at least
 * `minProminenceDb` above their local envelope. Returns [] for invalid input
 * (missing/malformed curve, mismatched array lengths, or an empty curve).
 */
export function findSpectralPeaks(curve: SpectrumCurve, opts?: FindPeaksOptions): SpectralPeak[] {
  if (
    !curve ||
    !Array.isArray(curve.freqs) ||
    !Array.isArray(curve.db) ||
    curve.freqs.length !== curve.db.length ||
    curve.freqs.length === 0
  ) {
    return [];
  }

  const { freqs, db } = curve;
  const minProminenceDb = opts?.minProminenceDb ?? DEFAULT_MIN_PROMINENCE_DB;
  const envelopeHalfWindow = opts?.envelopeHalfWindow ?? DEFAULT_ENVELOPE_HALF_WINDOW;
  const maxPeaks = opts?.maxPeaks ?? DEFAULT_MAX_PEAKS;
  const minDb = opts?.minDb ?? -Infinity;

  const env = localEnvelope(db, envelopeHalfWindow);
  const last = db.length - 1;
  // Non-finite neighbors read as -Infinity for the local-maximum comparison,
  // so a peak beside silence still qualifies.
  const at = (i: number) => (Number.isFinite(db[i]) ? db[i] : -Infinity);

  const peaks: SpectralPeak[] = [];
  for (let i = 0; i < db.length; i++) {
    if (!Number.isFinite(db[i]) || db[i] < minDb) continue;
    // Asymmetric >/>= breaks plateaus toward the left edge so a flat run
    // yields one peak, not several.
    const leftOk = i === 0 || db[i] > at(i - 1);
    const rightOk = i === last || db[i] >= at(i + 1);
    if (!leftOk || !rightOk) continue;

    const prominence = db[i] - env[i];
    if (!Number.isFinite(prominence) || prominence < minProminenceDb) continue;

    peaks.push({ index: i, freq: freqs[i], db: db[i], prominence });
  }

  // Stable sort by prominence descending — Array#sort is stable in modern JS
  // engines, so ties keep ascending index order.
  peaks.sort((a, b) => b.prominence - a.prominence);
  return peaks.slice(0, maxPeaks);
}

/**
 * Mean level (dB) over grid points whose frequency falls in the half-open
 * band `[lowHz, highHz)` — matches the existing band convention in
 * profiles/index.ts and spectrum.py. Ignores non-finite bins. Returns
 * -Infinity if the band has no finite bins, or the curve is invalid.
 */
export function bandEnergy(curve: SpectrumCurve, lowHz: number, highHz: number): number {
  if (
    !curve ||
    !Array.isArray(curve.freqs) ||
    !Array.isArray(curve.db) ||
    curve.freqs.length !== curve.db.length ||
    curve.freqs.length === 0
  ) {
    return -Infinity;
  }

  const inBand: number[] = [];
  curve.freqs.forEach((f, i) => {
    if (f >= lowHz && f < highHz) inBand.push(curve.db[i]);
  });
  return finiteMean(inBand);
}
