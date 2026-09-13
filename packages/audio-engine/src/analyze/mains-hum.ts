/**
 * Deterministic mains-hum eligibility policy, plus the extractor that reads a
 * live channel's 48-point spectral curve to find the peak the policy
 * consumes. The policy reuses the established strict-silence and
 * spectral-prominence conventions, requires a known mains frequency to avoid
 * classifying arbitrary bass as hum, and counts completed analysis windows
 * rather than wall-clock time. `extractMainsHumWindow` selects the strongest
 * peak on the existing fixed grid whose index is nearest 50Hz or 60Hz, and
 * `classifyMainsHum` combines both with channel identity for a live consumer.
 */

import { findSpectralPeaks } from "./spectral.js";
import { GRID_FREQS } from "../profiles/index.js";

/** RMS values must be strictly below this established silence threshold. */
export const MAINS_HUM_SILENCE_THRESHOLD_DBFS = -55;
/** A supplied narrowband peak needs at least this prominence above its envelope. */
export const MAINS_HUM_MIN_PEAK_PROMINENCE_DB = 6;
/** Exact mains frequencies accepted by this policy. */
export const MAINS_HUM_FREQUENCIES_HZ = [50, 60] as const;
/** Consecutive qualifying completed windows required for eligibility. */
export const MAINS_HUM_REQUIRED_CONSECUTIVE_WINDOWS = 3;

/** Measurements from one completed analysis window and its already-selected peak. */
export interface MainsHumWindow {
  rmsDbfs: number;
  peak: {
    freq: number;
    prominence: number;
  } | null;
}

/** Caller-owned persistence state for consecutive qualifying analysis windows. */
export interface MainsHumEligibility {
  consecutiveQualifyingWindows: number;
  eligible: boolean;
}

/** Whether a completed window has valid, near-silent measurements and a mains peak. */
export function isQualifyingMainsHumWindow(window: MainsHumWindow): boolean {
  if (!Number.isFinite(window.rmsDbfs) || window.rmsDbfs >= MAINS_HUM_SILENCE_THRESHOLD_DBFS || !window.peak) {
    return false;
  }

  const { freq, prominence } = window.peak;
  return (
    Number.isFinite(freq) &&
    Number.isFinite(prominence) &&
    MAINS_HUM_FREQUENCIES_HZ.some((frequency) => frequency === freq) &&
    prominence >= MAINS_HUM_MIN_PEAK_PROMINENCE_DB
  );
}

/** Advance caller-owned eligibility using one completed analysis window. */
export function advanceMainsHumEligibility(
  previous: MainsHumEligibility,
  window: MainsHumWindow,
): MainsHumEligibility {
  if (!isQualifyingMainsHumWindow(window)) {
    return { consecutiveQualifyingWindows: 0, eligible: false };
  }

  const consecutiveQualifyingWindows = previous.consecutiveQualifyingWindows + 1;
  return {
    consecutiveQualifyingWindows,
    eligible: consecutiveQualifyingWindows >= MAINS_HUM_REQUIRED_CONSECUTIVE_WINDOWS,
  };
}

/** Index of the grid point in `freqs` nearest `targetHz`. */
function nearestGridIndexToFrequency(freqs: readonly number[], targetHz: number): number {
  let bestIndex = 0;
  let bestDiff = Infinity;
  freqs.forEach((f, i) => {
    const diff = Math.abs(f - targetHz);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  });
  return bestIndex;
}

/**
 * Grid index nearest each configured mains frequency, mapped back to the
 * canonical 50/60 literal. The log-spaced grid never lands exactly on 50 or
 * 60 Hz, so this snapping is what lets a real peak satisfy the strict
 * equality check in {@link isQualifyingMainsHumWindow}.
 */
const MAINS_HUM_GRID_INDEX_TO_FREQUENCY: ReadonlyMap<number, (typeof MAINS_HUM_FREQUENCIES_HZ)[number]> = new Map(
  MAINS_HUM_FREQUENCIES_HZ.map((freq) => [nearestGridIndexToFrequency(GRID_FREQS, freq), freq]),
);

/** Read a channel's live 48-point curve and select its dominant mains-frequency peak, if any. */
export function extractMainsHumWindow(channel: { rms: number; curve?: number[] }): MainsHumWindow {
  const db = channel.curve;
  if (!db || db.length !== GRID_FREQS.length) {
    return { rmsDbfs: channel.rms, peak: null };
  }

  const peaks = findSpectralPeaks(
    { freqs: GRID_FREQS, db },
    { minProminenceDb: MAINS_HUM_MIN_PEAK_PROMINENCE_DB },
  );
  // findSpectralPeaks sorts by prominence descending, so this picks the
  // strongest mains-grid-index peak when both 50Hz and 60Hz are local maxima.
  const mainsPeak = peaks.find((p) => MAINS_HUM_GRID_INDEX_TO_FREQUENCY.has(p.index));

  return {
    rmsDbfs: channel.rms,
    peak: mainsPeak
      ? { freq: MAINS_HUM_GRID_INDEX_TO_FREQUENCY.get(mainsPeak.index)!, prominence: mainsPeak.prominence }
      : null,
  };
}

/** One channel's mains-hum classification for a completed live analysis window. */
export interface MainsHumDetectionResult {
  channelIndex: number;
  channelName: string;
  eligibility: MainsHumEligibility;
  frequencyHz: (typeof MAINS_HUM_FREQUENCIES_HZ)[number] | null;
}

/** Classify one channel's completed window: extract its mains peak, advance eligibility, attach identity. */
export function classifyMainsHum(
  previous: MainsHumEligibility,
  channel: { index: number; name: string; rms: number; curve?: number[] },
): MainsHumDetectionResult {
  const window = extractMainsHumWindow(channel);
  const eligibility = advanceMainsHumEligibility(previous, window);

  return {
    channelIndex: channel.index,
    channelName: channel.name,
    eligibility,
    // window.peak.freq is always a value snapped in extractMainsHumWindow via
    // MAINS_HUM_GRID_INDEX_TO_FREQUENCY, i.e. always 50 or 60.
    frequencyHz:
      eligibility.eligible && window.peak
        ? (window.peak.freq as (typeof MAINS_HUM_FREQUENCIES_HZ)[number])
        : null,
  };
}
