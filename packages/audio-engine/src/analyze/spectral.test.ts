import { describe, it, expect } from "vitest";
import { findSpectralPeaks, bandEnergy, localEnvelope } from "./spectral.js";
import type { SpectrumCurve } from "../types.js";

/** Build a SpectrumCurve from db values; freqs default to a simple ascending grid. */
function curve(db: number[], freqs?: number[]): SpectrumCurve {
  return { db, freqs: freqs ?? db.map((_, i) => 100 * (i + 1)) };
}

describe("localEnvelope", () => {
  it("returns the same value everywhere for a uniform curve", () => {
    const env = localEnvelope([5, 5, 5, 5, 5], 2);
    expect(env).toHaveLength(5);
    env.forEach((v) => expect(v).toBeCloseTo(5));
  });

  it("returns -Infinity where all neighbors in the window are non-finite", () => {
    const env = localEnvelope([-Infinity, -Infinity, -Infinity], 1);
    expect(env[1]).toBe(-Infinity);
  });

  it("clamps the window at the array start and end", () => {
    // window half-width 2, index 0: only indices 0,1,2 exist -> mean of [10,20,30]
    const env = localEnvelope([10, 20, 30, 40, 50], 2);
    expect(env[0]).toBeCloseTo((10 + 20 + 30) / 3);
    // index 4 (last): only indices 2,3,4 exist -> mean of [30,40,50]
    expect(env[4]).toBeCloseTo((30 + 40 + 50) / 3);
  });
});

describe("findSpectralPeaks", () => {
  it("returns [] for a flat curve", () => {
    const c = curve([-20, -20, -20, -20, -20]);
    expect(findSpectralPeaks(c)).toEqual([]);
  });

  it("finds a single sharp spike", () => {
    const c = curve([-40, -40, -10, -40, -40]);
    const peaks = findSpectralPeaks(c);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].index).toBe(2);
    expect(peaks[0].freq).toBe(c.freqs[2]);
    expect(peaks[0].db).toBe(-10);
    // envelope at index 2 with default half-window 3 averages all 5 points
    // (window clamps to [0,4]): mean = (-40*4 + -10) / 5 = -34
    expect(peaks[0].prominence).toBeCloseTo(-10 - -34);
  });

  it("returns two spikes of different prominence sorted descending", () => {
    const c = curve([-40, -40, -10, -40, -40, -40, -25, -40, -40]);
    const peaks = findSpectralPeaks(c, { envelopeHalfWindow: 1 });
    expect(peaks).toHaveLength(2);
    expect(peaks[0].index).toBe(2); // bigger spike (-10) first
    expect(peaks[1].index).toBe(6); // smaller spike (-25) second
    expect(peaks[0].prominence).toBeGreaterThan(peaks[1].prominence);
  });

  it("caps results at maxPeaks", () => {
    const c = curve([-40, -40, -10, -40, -40, -40, -25, -40, -40]);
    const peaks = findSpectralPeaks(c, { envelopeHalfWindow: 1, maxPeaks: 1 });
    expect(peaks).toHaveLength(1);
    expect(peaks[0].index).toBe(2);
  });

  it("excludes a peak whose prominence is below minProminenceDb", () => {
    const c = curve([-40, -40, -10, -40, -40]);
    expect(findSpectralPeaks(c, { minProminenceDb: 100 })).toEqual([]);
  });

  it("excludes a peak whose absolute level is below minDb", () => {
    const c = curve([-40, -40, -10, -40, -40]);
    expect(findSpectralPeaks(c, { minDb: 0 })).toEqual([]);
  });

  it("detects a peak at index 0 (left edge clamping)", () => {
    const c = curve([-10, -40, -40, -40, -40]);
    const peaks = findSpectralPeaks(c);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].index).toBe(0);
  });

  it("detects a peak at the last index (right edge clamping)", () => {
    const c = curve([-40, -40, -40, -40, -10]);
    const peaks = findSpectralPeaks(c);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].index).toBe(4);
  });

  it("detects a spike beside -Infinity silent bins without returning the silent bins", () => {
    const c = curve([-Infinity, -40, -10, -40, -Infinity]);
    const peaks = findSpectralPeaks(c);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].index).toBe(2);
  });

  it("returns [] when freqs and db lengths mismatch", () => {
    const c: SpectrumCurve = { freqs: [100, 200, 300], db: [-10, -20] };
    expect(findSpectralPeaks(c)).toEqual([]);
  });

  it("returns [] for an empty curve", () => {
    expect(findSpectralPeaks(curve([]))).toEqual([]);
  });

  it("returns [] for a falsy curve", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(findSpectralPeaks(undefined as any)).toEqual([]);
  });
});

describe("bandEnergy", () => {
  it("returns the mean of finite bins within [lowHz, highHz)", () => {
    const c = curve([-10, -20, -30, -40], [100, 200, 300, 400]);
    expect(bandEnergy(c, 100, 400)).toBeCloseTo((-10 + -20 + -30) / 3);
  });

  it("excludes a bin exactly at highHz and includes one exactly at lowHz", () => {
    const c = curve([-10, -20, -30], [100, 200, 300]);
    expect(bandEnergy(c, 100, 300)).toBeCloseTo((-10 + -20) / 2);
  });

  it("returns -Infinity when the band has only non-finite bins", () => {
    const c = curve([-Infinity, -Infinity], [100, 200]);
    expect(bandEnergy(c, 100, 300)).toBe(-Infinity);
  });

  it("returns -Infinity when the range matches no bin", () => {
    const c = curve([-10, -20], [100, 200]);
    expect(bandEnergy(c, 1000, 2000)).toBe(-Infinity);
  });

  it("returns -Infinity for an invalid curve", () => {
    const c: SpectrumCurve = { freqs: [100, 200, 300], db: [-10, -20] };
    expect(bandEnergy(c, 100, 300)).toBe(-Infinity);
  });

  it("returns -Infinity for a falsy curve", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(bandEnergy(undefined as any, 100, 300)).toBe(-Infinity);
  });

  it("returns -Infinity for an empty curve", () => {
    expect(bandEnergy(curve([]), 100, 300)).toBe(-Infinity);
  });
});
