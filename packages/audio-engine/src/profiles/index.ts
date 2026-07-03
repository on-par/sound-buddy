// Ideal EQ profiles + level-invariant comparison (PRD 05).
//
// A profile is a *relative* target shape on the same fixed log-frequency grid as
// {@link SpectrumCurve} (48 points, 20 Hz–20 kHz). `dbOffsets` encodes tilt/shape
// only — never absolute level. Comparison level-matches the measured curve to the
// target (mean-subtraction) before taking the per-point deviation, so raising a
// mix's overall gain leaves the deviation shape and match score unchanged.
//
// Shipped here as a typed module rather than raw JSON: ESM (`module: Node16`) JSON
// imports need per-Node import attributes plus a dist-copy step, which is brittle.
// The data is still static and versioned in packages/audio-engine/src/profiles/,
// and is the single source of truth mirrored by the renderer's inline copy.

import type { ContentType } from "../types.js";

export interface IdealProfile {
  id: string;
  label: string;
  /** One-line description surfaced in the UI. */
  description: string;
  /** Center frequency per grid point (Hz); equals {@link GRID_FREQS}. */
  freqs: number[];
  /** Relative target shape (dB), level-invariant. Same length as `freqs`. */
  dbOffsets: number[];
}

/** Named 7-band region of the spectrum, matching the legacy meter bands. */
export interface BandDeviation {
  band: string;
  label: string;
  /** Mean deviation (measured − target, dB) across the band's grid points. */
  deviation: number;
}

export interface ProfileComparison {
  profileId: string;
  /** Per-grid-point deviation (measured − target, dB) after level-matching. */
  deviation: number[];
  /** 0–100; 100 = perfect match. `100 − PENALTY_PER_DB × weighted-RMS deviation`. */
  matchScore: number;
  /** Mean deviation per named band (for the report card). */
  bands: BandDeviation[];
  /** Most over-target band (largest positive mean deviation), or null if none. */
  topOver: BandDeviation | null;
  /** Most under-target band (largest negative mean deviation), or null if none. */
  topUnder: BandDeviation | null;
}

/** Number of grid points — matches spectrum.py's GRID_POINTS. */
export const GRID_POINTS = 48;

/**
 * Fixed log-spaced grid, 20 Hz → 20 kHz. Mirrors `np.geomspace(20, 20000, 48)`
 * in packages/audio-engine/scripts/spectrum.py — `freq[i] = 20 · 1000^(i/47)`.
 */
export const GRID_FREQS: number[] = Array.from(
  { length: GRID_POINTS },
  (_, i) => 20 * Math.pow(1000, i / (GRID_POINTS - 1)),
);

// ── Named bands (mirror the legacy 7-band meters) ─────────────────────────────
const BANDS: Array<{ band: string; label: string; lo: number; hi: number }> = [
  { band: "subBass", label: "Sub-bass", lo: 20, hi: 60 },
  { band: "bass", label: "Bass", lo: 60, hi: 250 },
  { band: "lowMid", label: "Low-mid", lo: 250, hi: 500 },
  { band: "mid", label: "Mid", lo: 500, hi: 2000 },
  { band: "highMid", label: "High-mid", lo: 2000, hi: 4000 },
  { band: "presence", label: "Presence", lo: 4000, hi: 6000 },
  { band: "brilliance", label: "Brilliance", lo: 6000, hi: 20000 },
];

// ── Shape helpers (evaluated on GRID_FREQS to build dbOffsets) ─────────────────
const log2 = (f: number) => Math.log2(f);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Gaussian bell in log-frequency. `bw` is the std-dev in octaves. */
function bell(centerHz: number, gainDb: number, bw: number) {
  return (f: number) => gainDb * Math.exp(-0.5 * Math.pow((log2(f) - log2(centerHz)) / bw, 2));
}

/** Low shelf: full `gainDb` well below `cornerHz`, 0 well above (smoothstep). */
function lowShelf(cornerHz: number, gainDb: number, widthOct = 1.5) {
  return (f: number) => {
    const t = clamp01((log2(cornerHz) - log2(f)) / (2 * widthOct) + 0.5);
    return gainDb * (t * t * (3 - 2 * t));
  };
}

/** High shelf: full `gainDb` well above `cornerHz`, 0 well below (smoothstep). */
function highShelf(cornerHz: number, gainDb: number, widthOct = 1.5) {
  return (f: number) => {
    const t = clamp01((log2(f) - log2(cornerHz)) / (2 * widthOct) + 0.5);
    return gainDb * (t * t * (3 - 2 * t));
  };
}

function shape(...terms: Array<(f: number) => number>): number[] {
  return GRID_FREQS.map((f) => {
    const sum = terms.reduce((acc, term) => acc + term(f), 0);
    return Math.round(sum * 100) / 100;
  });
}

// ── Built-in profiles ─────────────────────────────────────────────────────────
export const PROFILES: IdealProfile[] = [
  {
    id: "flat",
    label: "Flat / neutral",
    description: "Neutral reference — no target tilt.",
    freqs: GRID_FREQS,
    dbOffsets: GRID_FREQS.map(() => 0),
  },
  {
    id: "music-fullrange",
    label: "Music (full-range)",
    description: "Balanced mix: gentle low warmth and a soft presence lift.",
    freqs: GRID_FREQS,
    dbOffsets: shape(
      lowShelf(120, 3, 1.5), // low-end warmth
      bell(4500, 2.5, 1.1), // presence lift
      highShelf(12000, -1.5, 1.2), // gentle air roll-off
    ),
  },
  {
    id: "speech-podcast",
    label: "Speech / podcast",
    description: "Intelligibility: high-pass tilt, 2–5 kHz presence bump.",
    freqs: GRID_FREQS,
    dbOffsets: shape(
      lowShelf(110, -6, 1.4), // reduce sub-bass / rumble
      bell(3000, 4, 1.0), // intelligibility bump
      highShelf(9000, -2, 1.2), // tame sibilance/air
    ),
  },
  {
    id: "broadcast",
    label: "Broadcast (speech)",
    description: "Loudness-normalized speech: controlled lows, gentle presence.",
    freqs: GRID_FREQS,
    dbOffsets: shape(
      lowShelf(140, -8, 1.2), // steeper low cut for a controlled, dialog-forward tone
      bell(2500, 2.5, 1.1), // gentle intelligibility
      highShelf(10000, -3, 1.2), // tame highs for consistent loudness
    ),
  },
];

const BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

export function getProfile(id: string | undefined | null): IdealProfile | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/**
 * Default profile id for a content classification (PRD 04 → 05). Speech maps to
 * the podcast target, music to the full-range target, everything else to flat.
 */
export function defaultProfileForContentType(ct: ContentType | undefined): string {
  switch (ct) {
    case "speech":
      return "speech-podcast";
    case "music":
    case "mixed":
      return "music-fullrange";
    default:
      return "flat";
  }
}

// ── Comparison ────────────────────────────────────────────────────────────────

/** Penalty applied to the weighted-RMS deviation (dB) when scoring, per dB. */
export const PENALTY_PER_DB = 4;

/**
 * Perceptual weights per grid point: mids/presence (~200 Hz–6 kHz) matter most,
 * the extremes least. Keeps the match score from being dominated by rumble or air.
 */
const POINT_WEIGHTS: number[] = GRID_FREQS.map((f) => {
  if (f >= 200 && f <= 6000) return 1;
  if (f < 200) return 0.5;
  return 0.6; // > 6 kHz
});

/** Mean of the finite entries of `xs` (ignores −inf/NaN silence floors). */
function finiteMean(xs: number[]): number {
  let sum = 0;
  let n = 0;
  for (const x of xs) {
    if (Number.isFinite(x)) {
      sum += x;
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Compare a measured spectrum curve against an ideal profile. Both are reduced to
 * their mean (over finite points) and subtracted, so the deviation is invariant to
 * a global level offset. Returns null if the curve is missing or grid-mismatched.
 */
export function compareToProfile(
  curve: { freqs: number[]; db: number[] } | undefined,
  profile: IdealProfile,
): ProfileComparison | null {
  if (!curve || !Array.isArray(curve.db) || curve.db.length !== profile.dbOffsets.length) {
    return null;
  }

  const measuredMean = finiteMean(curve.db);
  const targetMean = finiteMean(profile.dbOffsets);

  const deviation = curve.db.map((db, i) => {
    const m = Number.isFinite(db) ? db - measuredMean : 0;
    const t = profile.dbOffsets[i] - targetMean;
    return m - t;
  });

  // Weighted RMS of the deviation → match score.
  let wsum = 0;
  let wtot = 0;
  deviation.forEach((d, i) => {
    const w = POINT_WEIGHTS[i] ?? 1;
    wsum += w * d * d;
    wtot += w;
  });
  const wrms = wtot > 0 ? Math.sqrt(wsum / wtot) : 0;
  const matchScore = Math.round(Math.max(0, Math.min(100, 100 - PENALTY_PER_DB * wrms)));

  // Per-band mean deviation for the report card.
  const bands: BandDeviation[] = BANDS.map(({ band, label, lo, hi }) => {
    const vals: number[] = [];
    GRID_FREQS.forEach((f, i) => {
      if (f >= lo && f < hi) vals.push(deviation[i]);
    });
    return { band, label, deviation: vals.length ? finiteMean(vals) : 0 };
  });

  let topOver: BandDeviation | null = null;
  let topUnder: BandDeviation | null = null;
  for (const b of bands) {
    if (b.deviation > 0 && (!topOver || b.deviation > topOver.deviation)) topOver = b;
    if (b.deviation < 0 && (!topUnder || b.deviation < topUnder.deviation)) topUnder = b;
  }

  return { profileId: profile.id, deviation, matchScore, bands, topOver, topUnder };
}
