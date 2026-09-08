import { describe, expect, it } from "vitest";
import {
  MAINS_HUM_FREQUENCIES_HZ,
  MAINS_HUM_MIN_PEAK_PROMINENCE_DB,
  MAINS_HUM_REQUIRED_CONSECUTIVE_WINDOWS,
  MAINS_HUM_SILENCE_THRESHOLD_DBFS,
  advanceMainsHumEligibility,
  classifyMainsHum,
  extractMainsHumWindow,
  isQualifyingMainsHumWindow,
} from "./mains-hum.js";
import type { MainsHumEligibility, MainsHumWindow } from "./mains-hum.js";
import { GRID_FREQS } from "../profiles/index.js";

function nearestGridIndexToFrequency(targetHz: number): number {
  let bestIndex = 0;
  let bestDiff = Infinity;
  GRID_FREQS.forEach((f, i) => {
    const diff = Math.abs(f - targetHz);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  });
  return bestIndex;
}

const GRID_INDEX_NEAREST_50HZ = nearestGridIndexToFrequency(50);
const GRID_INDEX_NEAREST_60HZ = nearestGridIndexToFrequency(60);

function curveWithPeakAt(index: number, opts?: { baselineDb?: number; peakDb?: number }): number[] {
  const baseline = opts?.baselineDb ?? -60;
  const peak = opts?.peakDb ?? -48; // 12 dB above baseline, comfortably over the 6 dB floor
  const db = new Array(GRID_FREQS.length).fill(baseline);
  db[index] = peak;
  return db;
}

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

describe("extractMainsHumWindow", () => {
  it("returns peak: null when the curve is absent", () => {
    expect(extractMainsHumWindow({ rms: -56 })).toEqual({ rmsDbfs: -56, peak: null });
  });

  it("returns peak: null when the curve length does not match the grid", () => {
    expect(extractMainsHumWindow({ rms: -56, curve: [1, 2, 3] })).toEqual({ rmsDbfs: -56, peak: null });
  });

  it("returns peak: null for a flat curve with no prominent peak", () => {
    const curve = new Array(GRID_FREQS.length).fill(-60);
    expect(extractMainsHumWindow({ rms: -56, curve })).toEqual({ rmsDbfs: -56, peak: null });
  });

  it("finds a prominent peak at the grid index nearest 50Hz and snaps it to 50", () => {
    const result = extractMainsHumWindow({ rms: -56, curve: curveWithPeakAt(GRID_INDEX_NEAREST_50HZ) });
    expect(result.peak?.freq).toBe(50);
    expect(result.peak?.prominence).toBeGreaterThanOrEqual(MAINS_HUM_MIN_PEAK_PROMINENCE_DB);
  });

  it("finds a prominent peak at the grid index nearest 60Hz and snaps it to 60", () => {
    const result = extractMainsHumWindow({ rms: -56, curve: curveWithPeakAt(GRID_INDEX_NEAREST_60HZ) });
    expect(result.peak?.freq).toBe(60);
    expect(result.peak?.prominence).toBeGreaterThanOrEqual(MAINS_HUM_MIN_PEAK_PROMINENCE_DB);
  });

  it("ignores a strong prominent peak at a non-mains grid index (e.g. near 1kHz)", () => {
    const indexNear1kHz = nearestGridIndexToFrequency(1000);
    const result = extractMainsHumWindow({ rms: -56, curve: curveWithPeakAt(indexNear1kHz) });
    expect(result.peak).toBeNull();
  });
});

describe("classifyMainsHum", () => {
  const channelBase = { index: 3, name: "Vocal 1" };

  it("becomes eligible with frequencyHz 50 on the third consecutive near-silent 50Hz window", () => {
    const window = { rms: -56, curve: curveWithPeakAt(GRID_INDEX_NEAREST_50HZ) };

    const first = classifyMainsHum(INITIAL_ELIGIBILITY, { ...channelBase, ...window });
    expect(first.eligibility.eligible).toBe(false);
    expect(first.frequencyHz).toBeNull();

    const second = classifyMainsHum(first.eligibility, { ...channelBase, ...window });
    expect(second.eligibility.eligible).toBe(false);
    expect(second.frequencyHz).toBeNull();

    const third = classifyMainsHum(second.eligibility, { ...channelBase, ...window });
    expect(third.eligibility.eligible).toBe(true);
    expect(third.frequencyHz).toBe(50);
  });

  it("becomes eligible with frequencyHz 60 on the third consecutive near-silent 60Hz window", () => {
    const window = { rms: -56, curve: curveWithPeakAt(GRID_INDEX_NEAREST_60HZ) };

    const first = classifyMainsHum(INITIAL_ELIGIBILITY, { ...channelBase, ...window });
    const second = classifyMainsHum(first.eligibility, { ...channelBase, ...window });
    const third = classifyMainsHum(second.eligibility, { ...channelBase, ...window });

    expect(first.eligibility.eligible).toBe(false);
    expect(second.eligibility.eligible).toBe(false);
    expect(third.eligibility.eligible).toBe(true);
    expect(third.frequencyHz).toBe(60);
  });

  it("stays ineligible with a null frequencyHz across three near-silent windows with no tonal peak", () => {
    const window = { rms: -56 };

    let eligibility = INITIAL_ELIGIBILITY;
    for (let i = 0; i < 3; i++) {
      const result = classifyMainsHum(eligibility, { ...channelBase, ...window });
      expect(result.eligibility.eligible).toBe(false);
      expect(result.frequencyHz).toBeNull();
      eligibility = result.eligibility;
    }
  });

  it("stays ineligible with a null frequencyHz across three elevated-rms windows despite a mains-grid peak", () => {
    const window = { rms: -20, curve: curveWithPeakAt(GRID_INDEX_NEAREST_50HZ) };

    let eligibility = INITIAL_ELIGIBILITY;
    for (let i = 0; i < 3; i++) {
      const result = classifyMainsHum(eligibility, { ...channelBase, ...window });
      expect(result.eligibility.eligible).toBe(false);
      expect(result.frequencyHz).toBeNull();
      eligibility = result.eligibility;
    }
  });

  it("carries the input channelIndex and channelName through regardless of eligibility outcome", () => {
    const ineligible = classifyMainsHum(INITIAL_ELIGIBILITY, { ...channelBase, rms: -20 });
    expect(ineligible.channelIndex).toBe(channelBase.index);
    expect(ineligible.channelName).toBe(channelBase.name);

    const qualifying = classifyMainsHum(INITIAL_ELIGIBILITY, {
      ...channelBase,
      rms: -56,
      curve: curveWithPeakAt(GRID_INDEX_NEAREST_50HZ),
    });
    expect(qualifying.channelIndex).toBe(channelBase.index);
    expect(qualifying.channelName).toBe(channelBase.name);
  });

  it("resets frequencyHz to null on the window after a prior eligible run is disqualified", () => {
    const qualifyingWindow = { rms: -56, curve: curveWithPeakAt(GRID_INDEX_NEAREST_50HZ) };

    let result = classifyMainsHum(INITIAL_ELIGIBILITY, { ...channelBase, ...qualifyingWindow });
    result = classifyMainsHum(result.eligibility, { ...channelBase, ...qualifyingWindow });
    result = classifyMainsHum(result.eligibility, { ...channelBase, ...qualifyingWindow });
    expect(result.eligibility.eligible).toBe(true);
    expect(result.frequencyHz).toBe(50);

    const disqualified = classifyMainsHum(result.eligibility, { ...channelBase, rms: -20, curve: qualifyingWindow.curve });
    expect(disqualified.eligibility.eligible).toBe(false);
    expect(disqualified.frequencyHz).toBeNull();
  });
});
