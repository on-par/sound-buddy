// Pure, dependency-free DSP helpers for Browser Lite's live decibel meter
// (#298). Everything here is testable without a browser: no AudioContext,
// no DOM. The component wires these into the live-input tick loop.

// IEC 61672 analytic A/C-weighting pole frequencies and normalization
// offsets (the standard's reference constants, not arbitrary magic
// numbers).
const F1 = 20.598997;
const F2 = 107.65265;
const F3 = 737.86223;
const F4 = 12194.217;
const A_WEIGHT_NORMALIZATION_DB = 2.0;
const C_WEIGHT_NORMALIZATION_DB = 0.06;

// Bins at or below this frequency (near-DC) carry no perceptually relevant
// energy and are excluded from the weighting correction so a stray DC/hum
// bin can't skew the differential correction.
const MIN_WEIGHTED_HZ = 20;

export const SLOW_TIME_CONSTANT_MS = 1000;
export const FAST_TIME_CONSTANT_MS = 125;

export const LIVE_METER_MIN_DB = -60;
export const LIVE_METER_MAX_DB = 0;

export type Weighting = 'A' | 'C' | 'Z';
export type MeterResponse = 'slow' | 'fast';
export type RangeStatus = 'below' | 'inside' | 'above';

/** Narrows a <select> option's raw string value to a Weighting. */
export function isWeighting(value: string): value is Weighting {
  return value === 'A' || value === 'C' || value === 'Z';
}

/** Narrows a <select> option's raw string value to a MeterResponse. */
export function isMeterResponse(value: string): value is MeterResponse {
  return value === 'slow' || value === 'fast';
}

export interface TargetRange {
  minDb: number;
  maxDb: number;
}

/** IEC 61672 A-weighting curve, in dB relative to 1 kHz. */
export function aWeightingDb(hz: number): number {
  if (hz <= 0) return -Infinity;
  const f2 = hz * hz;
  const numerator = F4 * F4 * f2 * f2;
  const denominator =
    (f2 + F1 * F1) * Math.sqrt((f2 + F2 * F2) * (f2 + F3 * F3)) * (f2 + F4 * F4);
  return 20 * Math.log10(numerator / denominator) + A_WEIGHT_NORMALIZATION_DB;
}

/** IEC 61672 C-weighting curve, in dB relative to 1 kHz. */
export function cWeightingDb(hz: number): number {
  if (hz <= 0) return -Infinity;
  const f2 = hz * hz;
  const numerator = F4 * F4 * f2;
  const denominator = (f2 + F1 * F1) * (f2 + F4 * F4);
  return 20 * Math.log10(numerator / denominator) + C_WEIGHT_NORMALIZATION_DB;
}

/** Weighting curve value in dB for the given mode; Z (unweighted) is always 0. */
export function weightingDb(hz: number, mode: Weighting): number {
  if (mode === 'Z') return 0;
  return mode === 'A' ? aWeightingDb(hz) : cWeightingDb(hz);
}

/**
 * Differential weighting correction: how much A/C-weighting would shift the
 * already-computed time-domain RMS dB, derived from the relative power
 * distribution across FFT bins rather than trusted as an absolute level in
 * its own right. Returns 0 for Z-weighting or when the spectrum carries no
 * power in the weighted passband (>= MIN_WEIGHTED_HZ).
 */
export function weightingCorrectionDb(
  freqDb: ArrayLike<number>,
  binHz: number,
  mode: Weighting,
): number {
  if (mode === 'Z') return 0;

  let weightedPower = 0;
  let rawPower = 0;
  for (let i = 0; i < freqDb.length; i += 1) {
    const hz = i * binHz;
    if (hz < MIN_WEIGHTED_HZ) continue;
    const db = freqDb[i];
    const w = weightingDb(hz, mode);
    weightedPower += Math.pow(10, (db + w) / 10);
    rawPower += Math.pow(10, db / 10);
  }

  if (rawPower <= 0) return 0;
  return 10 * Math.log10(weightedPower) - 10 * Math.log10(rawPower);
}

export interface LevelSmoother {
  update(levelDb: number, dtMs: number): number;
  reset(): void;
}

/**
 * Handheld-SPL-meter-style ballistics: smoothing runs in the power domain
 * (dB -> linear power -> exponential approach -> back to dB) so slow/fast
 * response matches how real meters integrate energy, not perceived dB.
 */
export function createLevelSmoother(timeConstantMs: number): LevelSmoother {
  let state: number | null = null;

  return {
    update(levelDb: number, dtMs: number): number {
      if (state === null) {
        state = levelDb;
        return state;
      }
      if (dtMs <= 0) return state;

      const x = Math.pow(10, levelDb / 10);
      const y = Math.pow(10, state / 10);
      const alpha = 1 - Math.exp(-dtMs / timeConstantMs);
      const next = y + (x - y) * alpha;
      state = 10 * Math.log10(next);
      return state;
    },
    reset(): void {
      state = null;
    },
  };
}

/** Boundaries count as inside — a level exactly at minDb/maxDb is on-target. */
export function evaluateRange(levelDb: number, range: TargetRange): RangeStatus {
  if (levelDb < range.minDb) return 'below';
  if (levelDb > range.maxDb) return 'above';
  return 'inside';
}

/** Clamped 0-100 position of valueDb on a [minDb, maxDb] gauge scale. */
export function meterPercent(valueDb: number, minDb: number, maxDb: number): number {
  const percent = ((valueDb - minDb) / (maxDb - minDb)) * 100;
  return Math.min(100, Math.max(0, percent));
}
