// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// DOM-free RTA display model shared-spec port (#1709/#1721). Display grid
// mirrors iOS RTALayout.standard (apps/ios/SoundBuddyKit/Sources/
// SoundBuddyKit/RTA.swift). Engine grid (GRID_FREQS, 48 pts) is untouched.

export const RTA_DISPLAY_MIN_HZ = 20;
export const RTA_DISPLAY_MAX_HZ = 20_000;
export const RTA_DISPLAY_ANCHOR_HZ = 1000;
export const RTA_DISPLAY_BANDS_PER_OCTAVE = 6;

/** Port of iOS RTALayout.init — 1/6-octave band centers anchored at 1 kHz, bounded to 20 Hz..20 kHz. */
export function rtaDisplayBandCenters(bandsPerOctave: number = RTA_DISPLAY_BANDS_PER_OCTAVE): number[] {
  const first = Math.ceil(bandsPerOctave * Math.log2(RTA_DISPLAY_MIN_HZ / RTA_DISPLAY_ANCHOR_HZ));
  const last = Math.floor(bandsPerOctave * Math.log2(RTA_DISPLAY_MAX_HZ / RTA_DISPLAY_ANCHOR_HZ));
  const centers: number[] = [];
  for (let k = first; k <= last; k++) {
    centers.push(RTA_DISPLAY_ANCHOR_HZ * Math.pow(2, k / bandsPerOctave));
  }
  return centers;
}

/** The iOS RTALayout.standard centers (59 bands), frozen. */
export const RTA_DISPLAY_BAND_CENTERS: readonly number[] = Object.freeze(rtaDisplayBandCenters());

interface EnginePoint {
  f: number;
  db: number;
}

/**
 * Resamples a 48-point engine curve (e.g. GRID_FREQS + a per-point dB curve)
 * onto a display grid (default: RTA_DISPLAY_BAND_CENTERS) by linearly
 * interpolating in log10(Hz) between the bracketing engine points, clamping
 * to the first/last usable value outside the engine range. Never mutates
 * engineFreqs or engineDb.
 */
export function mapEngineCurveToDisplayGrid(
  engineFreqs: readonly number[],
  engineDb: readonly number[],
  displayCenters: readonly number[] = RTA_DISPLAY_BAND_CENTERS,
): number[] {
  if (engineFreqs.length !== engineDb.length) {
    throw new RangeError(
      `Engine curve has ${engineFreqs.length} frequencies but ${engineDb.length} dB values — ` +
        'pass matching freqs/db arrays (e.g. GRID_FREQS with a 48-point curve).',
    );
  }

  const pairs: EnginePoint[] = [];
  for (let i = 0; i < engineFreqs.length; i++) {
    const f = engineFreqs[i];
    const db = engineDb[i];
    if (Number.isFinite(f) && f > 0 && Number.isFinite(db)) {
      pairs.push({ f, db });
    }
  }
  pairs.sort((a, b) => a.f - b.f);

  if (pairs.length === 0) {
    return displayCenters.map(() => -Infinity);
  }

  const first = pairs[0];
  const last = pairs[pairs.length - 1];

  return displayCenters.map((c) => {
    if (c <= first.f) return first.db;
    if (c >= last.f) return last.db;

    const hi = pairs.find((p) => p.f >= c)!;
    if (hi.f === c) return hi.db;
    const hiIndex = pairs.indexOf(hi);
    const lo = pairs[hiIndex - 1];

    const t = (Math.log10(c) - Math.log10(lo.f)) / (Math.log10(hi.f) - Math.log10(lo.f));
    return lo.db + (hi.db - lo.db) * t;
  });
}
