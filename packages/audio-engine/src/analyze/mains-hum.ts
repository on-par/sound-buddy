/**
 * Deterministic mains-hum eligibility policy. It reuses the established
 * strict-silence and spectral-prominence conventions, requires a known mains
 * frequency to avoid classifying arbitrary bass as hum, and counts completed
 * analysis windows rather than wall-clock time.
 */

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
