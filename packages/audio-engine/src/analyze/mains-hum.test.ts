import { describe, expect, it } from "vitest";
import {
  MAINS_HUM_FREQUENCIES_HZ,
  MAINS_HUM_MIN_PEAK_PROMINENCE_DB,
  MAINS_HUM_REQUIRED_CONSECUTIVE_WINDOWS,
  MAINS_HUM_SILENCE_THRESHOLD_DBFS,
  advanceMainsHumEligibility,
  isQualifyingMainsHumWindow,
} from "./mains-hum.js";
import type { MainsHumEligibility, MainsHumWindow } from "./mains-hum.js";

const INITIAL_ELIGIBILITY: MainsHumEligibility = {
  consecutiveQualifyingWindows: 0,
  eligible: false,
};

function qualifyingWindow(freq = 60): MainsHumWindow {
  return {
    rmsDbfs: MAINS_HUM_SILENCE_THRESHOLD_DBFS - 1,
    peak: { freq, prominence: MAINS_HUM_MIN_PEAK_PROMINENCE_DB },
  };
}

describe("mains-hum policy constants", () => {
  it("exposes the established threshold and persistence policy values", () => {
    expect(MAINS_HUM_SILENCE_THRESHOLD_DBFS).toBe(-55);
    expect(MAINS_HUM_MIN_PEAK_PROMINENCE_DB).toBe(6);
    expect(MAINS_HUM_FREQUENCIES_HZ).toEqual([50, 60]);
    expect(MAINS_HUM_REQUIRED_CONSECUTIVE_WINDOWS).toBe(3);
  });
});

describe("isQualifyingMainsHumWindow", () => {
  it("accepts finite, near-silent 50 Hz and 60 Hz peaks at the prominence floor", () => {
    expect(isQualifyingMainsHumWindow(qualifyingWindow(50))).toBe(true);
    expect(isQualifyingMainsHumWindow(qualifyingWindow(60))).toBe(true);
  });

  it("uses strict silence and inclusive prominence boundaries", () => {
    expect(isQualifyingMainsHumWindow({ ...qualifyingWindow(), rmsDbfs: -55 })).toBe(false);
    expect(isQualifyingMainsHumWindow({ ...qualifyingWindow(), rmsDbfs: -55.1 })).toBe(true);
    expect(isQualifyingMainsHumWindow({ ...qualifyingWindow(), peak: { freq: 60, prominence: 5 } })).toBe(false);
    expect(isQualifyingMainsHumWindow({ ...qualifyingWindow(), peak: { freq: 60, prominence: 6 } })).toBe(true);
  });
});

describe("advanceMainsHumEligibility", () => {
  it("becomes eligible on the third consecutive qualifying completed window", () => {
    const first = advanceMainsHumEligibility(INITIAL_ELIGIBILITY, qualifyingWindow());
    expect(first).toEqual({ consecutiveQualifyingWindows: 1, eligible: false });

    const second = advanceMainsHumEligibility(first, qualifyingWindow());
    expect(second).toEqual({ consecutiveQualifyingWindows: 2, eligible: false });

    const third = advanceMainsHumEligibility(second, qualifyingWindow());
    expect(third).toEqual({ consecutiveQualifyingWindows: 3, eligible: true });
    expect(advanceMainsHumEligibility(third, qualifyingWindow())).toEqual({
      consecutiveQualifyingWindows: 4,
      eligible: true,
    });
  });

  it.each([
    ["active program material", { ...qualifyingWindow(), rmsDbfs: -55 }],
    ["an absent peak", { rmsDbfs: -56, peak: null }],
    ["a non-mains frequency", { ...qualifyingWindow(), peak: { freq: 59, prominence: 6 } }],
    ["insufficient prominence", { ...qualifyingWindow(), peak: { freq: 60, prominence: 5 } }],
    ["NaN RMS", { ...qualifyingWindow(), rmsDbfs: Number.NaN }],
    ["infinite RMS", { ...qualifyingWindow(), rmsDbfs: Number.NEGATIVE_INFINITY }],
    ["NaN peak frequency", { ...qualifyingWindow(), peak: { freq: Number.NaN, prominence: 6 } }],
    ["infinite peak frequency", { ...qualifyingWindow(), peak: { freq: Number.POSITIVE_INFINITY, prominence: 6 } }],
    ["NaN peak prominence", { ...qualifyingWindow(), peak: { freq: 60, prominence: Number.NaN } }],
    ["infinite peak prominence", { ...qualifyingWindow(), peak: { freq: 60, prominence: Number.POSITIVE_INFINITY } }],
  ] as const)("clears a prior eligible run for %s", (_reason, window) => {
    const previous: MainsHumEligibility = {
      consecutiveQualifyingWindows: MAINS_HUM_REQUIRED_CONSECUTIVE_WINDOWS,
      eligible: true,
    };

    expect(advanceMainsHumEligibility(previous, window)).toEqual(INITIAL_ELIGIBILITY);
  });

  it("restarts at one after a reset rather than retaining stale persistence", () => {
    const partialRun: MainsHumEligibility = { consecutiveQualifyingWindows: 2, eligible: false };
    const reset = advanceMainsHumEligibility(partialRun, { rmsDbfs: -56, peak: null });

    expect(reset).toEqual(INITIAL_ELIGIBILITY);
    expect(advanceMainsHumEligibility(reset, qualifyingWindow())).toEqual({
      consecutiveQualifyingWindows: 1,
      eligible: false,
    });
  });
});
