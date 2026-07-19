// Pure, dependency-free EQ-band presentation + rolling-average helpers for
// Browser Lite (#299). Matches the desktop analyzer's equal-width hardware-
// graphic-EQ layout (app/renderer/src/spectrum-display.ts's EQ_COLS/DB
// window/thresholds) as parameters only — no code is shared across the
// MIT/proprietary boundary (see that module's own header). Everything here
// is testable without a browser: no DOM, no AudioContext, and time is
// injected via `nowMs` params rather than read from a clock.

export type BandKey = 'sub' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'presence' | 'brilliance';

export interface EqBandDef {
  key: BandKey;
  label: string;
  rangeLabel: string;
  lo: number;
  hi: number;
  /** Representative frequency (Hz) used for the spectral-centroid weighting. */
  center: number;
}

/** Compact frequency-range label, e.g. "60–250 Hz" — derived from lo/hi so the two can never drift apart. */
export function formatEqRangeLabel(lo: number, hi: number): string {
  return `${lo}–${hi} Hz`;
}

// 7-band metadata mirroring packages/audio-engine/src/bands.ts's BAND_METADATA
// (the MIT source of truth for band names/ranges), with two deliberate
// alignments vs. the browser component's prior inline copy: "Sub" -> "Sub-bass",
// and brilliance's top extended 16000 -> 20000 Hz to match the desktop's
// display window. Brilliance's center is recomputed as the new range's
// midpoint (13000) rather than its old hand-tuned value.
export const EQ_BAND_DEFS: EqBandDef[] = (
  [
    { key: 'sub', label: 'Sub-bass', lo: 20, hi: 60, center: 40 },
    { key: 'bass', label: 'Bass', lo: 60, hi: 250, center: 155 },
    { key: 'lowMid', label: 'Low-mid', lo: 250, hi: 500, center: 375 },
    { key: 'mid', label: 'Mid', lo: 500, hi: 2000, center: 1200 },
    { key: 'highMid', label: 'High-mid', lo: 2000, hi: 4000, center: 3000 },
    { key: 'presence', label: 'Presence', lo: 4000, hi: 6000, center: 5000 },
    { key: 'brilliance', label: 'Brilliance', lo: 6000, hi: 20000, center: 13000 },
  ] as const
).map((b) => ({ ...b, rangeLabel: formatEqRangeLabel(b.lo, b.hi) }));

/* ── Bar geometry: 7 equal-width columns, like a hardware graphic EQ ── */
export const EQ_BAR_GAP_PCT = 1.4; // % inset per side, mirrors the desktop's EQ_GAP

export interface EqBarColumn {
  key: BandKey;
  label: string;
  leftPct: number;
  widthPct: number;
  centerPct: number;
}

export function eqBarColumns(): EqBarColumn[] {
  const w = 100 / EQ_BAND_DEFS.length;
  return EQ_BAND_DEFS.map((band, i) => ({
    key: band.key,
    label: band.label,
    leftPct: i * w + EQ_BAR_GAP_PCT,
    widthPct: w - 2 * EQ_BAR_GAP_PCT,
    centerPct: i * w + w / 2,
  }));
}

/* ── Display window: matches the desktop analyzer's dB range/thresholds ── */
export const EQ_DB_MIN = -72;
export const EQ_DB_MAX = -3;
export const EQ_DIM_DB = -60; // at/below: band is idle -> dimmed, never "loudest"
export const EQ_HOT_DB = -24; // above: numeric readout emphasized as running hot
export const EQ_GRID_DB = [-60, -48, -36, -24, -12, -6];

// Silence floor used whenever a level is non-finite (e.g. getFloatFrequencyData
// on an empty/idle analyser returns -Infinity).
const SILENCE_FLOOR_DB = -120;

/** Clamp a dB value into [EQ_DB_MIN, EQ_DB_MAX] and map it linearly to 0-100. */
export function eqBarPercent(db: number): number {
  const clamped = Math.max(EQ_DB_MIN, Math.min(EQ_DB_MAX, db));
  return ((clamped - EQ_DB_MIN) / (EQ_DB_MAX - EQ_DB_MIN)) * 100;
}

export interface BandView {
  pct: number;
  dim: boolean;
  hot: boolean;
  val: string;
}

export function bandView(db: number): BandView {
  const value = Number.isFinite(db) ? db : SILENCE_FLOOR_DB;
  return {
    pct: eqBarPercent(value),
    dim: value <= EQ_DIM_DB,
    hot: value > EQ_HOT_DB,
    val: value.toFixed(1),
  };
}

/** Index of the loudest band, or -1 if every band is idle (no glow during silence). */
export function loudestBandIndex(dbs: number[]): number {
  let maxIdx = -1;
  let maxVal = -Infinity;
  for (let i = 0; i < dbs.length; i += 1) {
    if (dbs[i] > maxVal) {
      maxVal = dbs[i];
      maxIdx = i;
    }
  }
  return maxVal <= EQ_DIM_DB ? -1 : maxIdx;
}

/** The per-band dB readout rides the bar top, capped so it never runs off-plot. */
export function barReadoutBottomPct(pct: number): number {
  return Math.min(pct, 90);
}

/**
 * Linear-weighted spectral centroid from per-band dB levels, in EQ_BAND_DEFS
 * order. Shared by file mode (instantaneous per-band levels) and live mode
 * (averaged per-band levels) so there is one centroid formula, not two.
 */
export function centroidFromBandDbs(bandDbs: number[]): number {
  let numerator = 0;
  let denominator = 0;
  EQ_BAND_DEFS.forEach((band, i) => {
    const linear = Math.pow(10, (bandDbs[i] ?? SILENCE_FLOOR_DB) / 20);
    numerator += linear * band.center;
    denominator += linear;
  });
  return denominator > 0 ? numerator / denominator : 0;
}

/* ── Rolling average / peak-hold: smooths live analyzer values over a window ── */
export const LIVE_AVG_WINDOW_MS = 3000;

interface TimestampedSample {
  t: number;
  values: number[];
}

/** Drop samples timestamped further back than `windowMs` from `nowMs`. Shared by the averager and peak-hold below. */
function evictOlderThan<T extends { t: number }>(samples: T[], nowMs: number, windowMs: number): T[] {
  return samples.filter((s) => nowMs - s.t <= windowMs);
}

export type AverageDomain = 'db' | 'linear';

export interface RollingAverager {
  update(values: number[], nowMs: number): number[];
  coverageMs(nowMs: number): number;
  reset(): void;
}

/**
 * Windowed mean of timestamped sample vectors. `'db'` averages in power
 * (10^(db/10) -> mean -> 10*log10) so it composes correctly with dB inputs;
 * `'linear'` is a plain arithmetic mean (correlation/balance/centroid).
 * Timestamps are injected via `nowMs` — no clock read inside this module —
 * so a backgrounded-tab's rAF pause (a large `nowMs` jump on resume) evicts
 * the whole stale window naturally on the next `update`.
 */
export function createRollingAverager(windowMs: number, domain: AverageDomain): RollingAverager {
  let samples: TimestampedSample[] = [];

  return {
    update(values: number[], nowMs: number): number[] {
      const prepared = domain === 'db'
        ? values.map((v) => (Number.isFinite(v) ? v : SILENCE_FLOOR_DB))
        : values.slice();
      samples.push({ t: nowMs, values: prepared });
      samples = evictOlderThan(samples, nowMs, windowMs);

      const n = prepared.length;
      const sums = new Array(n).fill(0) as number[];
      for (const sample of samples) {
        for (let i = 0; i < n; i += 1) {
          sums[i] += domain === 'db' ? Math.pow(10, sample.values[i] / 10) : sample.values[i];
        }
      }
      const count = samples.length;
      return sums.map((sum) => {
        const mean = sum / count;
        return domain === 'db' ? 10 * Math.log10(mean) : mean;
      });
    },
    coverageMs(nowMs: number): number {
      if (samples.length === 0) return 0;
      return Math.min(windowMs, nowMs - samples[0].t);
    },
    reset(): void {
      samples = [];
    },
  };
}

export interface RollingMax {
  update(value: number, nowMs: number): number;
  reset(): void;
}

/** Windowed peak-hold: the max of all values timestamped within the last `windowMs`. */
export function createRollingMax(windowMs: number): RollingMax {
  let samples: Array<{ t: number; value: number }> = [];

  return {
    update(value: number, nowMs: number): number {
      samples.push({ t: nowMs, value });
      samples = evictOlderThan(samples, nowMs, windowMs);
      return samples.reduce((max, s) => Math.max(max, s.value), -Infinity);
    },
    reset(): void {
      samples = [];
    },
  };
}
