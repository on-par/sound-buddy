import { describe, it, expect } from "vitest";
import { assessChannelGain, assessGainStructure, gainHealthLabel } from "./gain-structure.js";
import type { SoxStats } from "../types.js";

/** Minimal SoxStats fixture — only rmsDbfs/peakDbfs/clipping are read by the module. */
function makeSox(overrides: Partial<SoxStats> = {}): SoxStats {
  return {
    samplesRead: 44100,
    lengthSeconds: 1,
    scaledBy: 1,
    maximumAmplitude: 0.8,
    minimumAmplitude: -0.8,
    midlineAmplitude: 0,
    meanNorm: 0.3,
    meanAmplitude: 0,
    rmsAmplitude: 0.35,
    maximumDelta: 0.1,
    minimumDelta: 0,
    meanDelta: 0.05,
    rmsDelta: 0.06,
    roughFrequency: 220,
    volumeAdjustment: 3,
    rmsDbfs: -18,
    peakDbfs: -3,
    dynamicRangeDb: 13,
    clipping: false,
    ...overrides,
  };
}

describe("assessChannelGain", () => {
  it("is healthy at exactly the target level", () => {
    const result = assessChannelGain("Vocal", makeSox({ rmsDbfs: -18 }));
    expect(result.status).toBe("healthy");
    expect(result.score).toBe(100);
    expect(result.warnings).toEqual([]);
  });

  it("stays healthy at the boundary of the tolerance band (-24 dBFS)", () => {
    const result = assessChannelGain("Vocal", makeSox({ rmsDbfs: -24 }));
    expect(result.status).toBe("healthy");
    expect(result.score).toBe(100);
  });

  it("stays healthy at the boundary of the tolerance band (-12 dBFS)", () => {
    const result = assessChannelGain("Vocal", makeSox({ rmsDbfs: -12 }));
    expect(result.status).toBe("healthy");
    expect(result.score).toBe(100);
  });

  it("flags a cold channel below the tolerance band", () => {
    const result = assessChannelGain("Acoustic Guitar", makeSox({ rmsDbfs: -34 }));
    expect(result.status).toBe("cold");
    expect(result.distanceFromTargetDb).toBeCloseTo(-16);
    expect(result.score).toBe(60); // 100 - 4*(16-6)
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/preamp/);
    expect(result.warnings[0]).toMatch(/noise floor/);
  });

  it("flags a hot channel above the tolerance band", () => {
    const result = assessChannelGain("Kick", makeSox({ rmsDbfs: -6 }));
    expect(result.status).toBe("hot");
    expect(result.score).toBe(76); // 100 - 4*(12-6)
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/preamp\/source/);
  });

  it("flags clipping as hot with a dedicated warning, even mid-band", () => {
    const result = assessChannelGain("Snare", makeSox({ rmsDbfs: -18, clipping: true }));
    expect(result.status).toBe("hot");
    expect(result.score).toBe(70); // 100 - 30
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Clipping/);
    expect(result.warnings[0]).toMatch(/0 dBFS/);
  });

  it("treats a silent channel (-Infinity RMS) without crashing or scoring", () => {
    const result = assessChannelGain("Unused", makeSox({ rmsDbfs: -Infinity }));
    expect(result.status).toBe("silent");
    expect(result.score).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(Number.isNaN(result.distanceFromTargetDb)).toBe(true);
  });
});

describe("assessGainStructure", () => {
  it("averages scored channels and excludes silent ones from the mean", () => {
    const report = assessGainStructure([
      { name: "Hot", sox: makeSox({ rmsDbfs: -6 }) }, // score 76
      { name: "Cold", sox: makeSox({ rmsDbfs: -34 }) }, // score 60
      { name: "Healthy", sox: makeSox({ rmsDbfs: -18 }) }, // score 100
      { name: "Silent", sox: makeSox({ rmsDbfs: -Infinity }) },
    ]);
    expect(report.overallScore).toBe(Math.round((76 + 60 + 100) / 3));
    expect(report.channels).toHaveLength(4);
    expect(report.targetDbfs).toBe(-18);
  });

  it("defaults to 100 when every channel is silent", () => {
    const report = assessGainStructure([
      { name: "A", sox: makeSox({ rmsDbfs: -Infinity }) },
      { name: "B", sox: makeSox({ rmsDbfs: -Infinity }) },
    ]);
    expect(report.overallScore).toBe(100);
  });
});

describe("gainHealthLabel", () => {
  it("labels each score band", () => {
    expect(gainHealthLabel(95)).toBe("Excellent");
    expect(gainHealthLabel(80)).toBe("Good");
    expect(gainHealthLabel(65)).toBe("Fair");
    expect(gainHealthLabel(40)).toBe("Poor");
  });
});
