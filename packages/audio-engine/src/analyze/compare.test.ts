import { describe, it, expect } from "vitest";
import { compareChannels } from "./compare.js";
import type { ChannelAnalysis, FrequencyBands } from "../types.js";

const DEFAULT_DB = -60;
const DOUBLING_GAIN_DB = 20 * Math.log10(2);

function makeChannel(
  name: string,
  index: number,
  bands: Partial<FrequencyBands>,
): ChannelAnalysis {
  const fullBands: FrequencyBands = {
    subBass: DEFAULT_DB,
    bass: DEFAULT_DB,
    lowMid: DEFAULT_DB,
    mid: DEFAULT_DB,
    highMid: DEFAULT_DB,
    presence: DEFAULT_DB,
    brilliance: DEFAULT_DB,
    ...bands,
  };
  return {
    channel: { index, name, tmpPath: `/tmp/${name}.wav`, needsCleanup: false },
    analysis: {
      filePath: `/tmp/${name}.wav`,
      sox: {} as ChannelAnalysis["analysis"]["sox"],
      ffprobe: {} as ChannelAnalysis["analysis"]["ffprobe"],
      spectrum: {
        bands: fullBands,
        spectralCentroid: 1000,
        spectralRolloff85: 2000,
        dynamicRange: 20,
      },
      loudness: null,
    },
  };
}

const BAND_LABELS = {
  subBass: "Sub-bass (20-60 Hz)",
  bass: "Bass (60-250 Hz)",
  lowMid: "Low-mid (250-500 Hz)",
  mid: "Mid (500-2000 Hz)",
  highMid: "High-mid (2000-4000 Hz)",
  presence: "Presence (4000-6000 Hz)",
  brilliance: "Brilliance (6000-20000 Hz)",
} as const;

describe("compareChannels", () => {
  it("returns the expected result shape", () => {
    const result = compareChannels([makeChannel("a", 0, {})]);

    const labels = Object.values(BAND_LABELS);
    expect(Object.keys(result.bandRankings).sort()).toEqual([...labels].sort());
    expect(Object.keys(result.mixBandEnergy).sort()).toEqual([...labels].sort());
    expect(Array.isArray(result.maskingPairs)).toBe(true);
    expect(Array.isArray(result.subBassOffenders)).toBe(true);
  });

  it("handles a single channel (degenerate case)", () => {
    const ch = makeChannel("solo", 0, { mid: -12, subBass: -30 });
    const result = compareChannels([ch]);

    for (const label of Object.values(BAND_LABELS)) {
      expect(result.bandRankings[label]).toEqual(["solo"]);
    }
    expect(result.maskingPairs).toEqual([]);
    expect(result.mixBandEnergy[BAND_LABELS.mid]).toBeCloseTo(-12, 6);
    expect(result.mixBandEnergy[BAND_LABELS.subBass]).toBeCloseTo(-30, 6);
  });

  it("handles an empty channel list", () => {
    const result = compareChannels([]);

    for (const label of Object.values(BAND_LABELS)) {
      expect(result.bandRankings[label]).toEqual([]);
      expect(result.mixBandEnergy[label]).toBe(-Infinity);
    }
    expect(result.maskingPairs).toEqual([]);
    expect(result.subBassOffenders).toEqual([]);
  });

  it("ranks channels by band energy descending, independently per band", () => {
    const loud = makeChannel("loud", 0, { mid: -10, bass: -40 });
    const medium = makeChannel("medium", 1, { mid: -25, bass: -10 });
    const quiet = makeChannel("quiet", 2, { mid: -40, bass: -25 });

    const result = compareChannels([loud, medium, quiet]);

    expect(result.bandRankings[BAND_LABELS.mid]).toEqual(["loud", "medium", "quiet"]);
    expect(result.bandRankings[BAND_LABELS.bass]).toEqual(["medium", "quiet", "loud"]);
  });

  it("detects a masking pair for channels within 3 dB", () => {
    const loud = makeChannel("loud", 0, { mid: -10, highMid: -5 });
    const quiet = makeChannel("quiet", 1, { mid: -12, highMid: -50 });

    const result = compareChannels([loud, quiet]);

    const midPairs = result.maskingPairs.filter((p) => p.bandName === BAND_LABELS.mid);
    expect(midPairs).toHaveLength(1);
    expect(midPairs[0]).toMatchObject({ channelA: "loud", channelB: "quiet" });
    expect(midPairs[0].energyDiff).toBeCloseTo(2, 6);

    const highMidPairs = result.maskingPairs.filter((p) => p.bandName === BAND_LABELS.highMid);
    expect(highMidPairs).toEqual([]);
  });

  it("flags exactly a 3 dB gap, but not 3.01 dB", () => {
    const a = makeChannel("a", 0, { mid: -10 });
    const bAtBoundary = makeChannel("b", 1, { mid: -13 });

    const boundaryResult = compareChannels([a, bAtBoundary]);
    const boundaryMidPairs = boundaryResult.maskingPairs.filter((p) => p.bandName === BAND_LABELS.mid);
    expect(boundaryMidPairs).toHaveLength(1);
    expect(boundaryMidPairs[0].energyDiff).toBeCloseTo(3, 6);

    const bOverBoundary = makeChannel("b", 1, { mid: -13.01 });
    const overResult = compareChannels([a, bOverBoundary]);
    const overMidPairs = overResult.maskingPairs.filter((p) => p.bandName === BAND_LABELS.mid);
    expect(overMidPairs).toEqual([]);
  });

  it("produces all three pairs when three channels sit within 3 dB of each other", () => {
    const a = makeChannel("a", 0, { mid: -10 });
    const b = makeChannel("b", 1, { mid: -11.5 });
    const c = makeChannel("c", 2, { mid: -13 });

    const result = compareChannels([a, b, c]);
    const midPairs = result.maskingPairs.filter((p) => p.bandName === BAND_LABELS.mid);

    expect(midPairs).toHaveLength(3);
    const pairKeys = midPairs.map((p) => `${p.channelA}-${p.channelB}`).sort();
    expect(pairKeys).toEqual(["a-b", "a-c", "b-c"]);
  });

  it("excludes -Infinity band values from ranking dominance and masking", () => {
    const silentOne = makeChannel("silent1", 0, { mid: -Infinity });
    const silentTwo = makeChannel("silent2", 1, { mid: -Infinity });
    const normal = makeChannel("normal", 2, { mid: -10 });

    const result = compareChannels([silentOne, silentTwo, normal]);

    expect(result.bandRankings[BAND_LABELS.mid][0]).toBe("normal");
    expect(result.bandRankings[BAND_LABELS.mid]).toHaveLength(3);

    const midPairs = result.maskingPairs.filter((p) => p.bandName === BAND_LABELS.mid);
    expect(midPairs).toEqual([]);
  });

  it("contributes 0 linear energy for a silent channel in the mix", () => {
    const silent = makeChannel("silent", 0, { mid: -Infinity });
    const normal = makeChannel("normal", 1, { mid: -10 });

    const result = compareChannels([silent, normal]);

    expect(result.mixBandEnergy[BAND_LABELS.mid]).toBeCloseTo(-10, 6);
  });

  it("excludes a silent channel from sub-bass offenders", () => {
    const silent = makeChannel("silent", 0, { subBass: -Infinity });
    const result = compareChannels([silent]);

    expect(result.subBassOffenders).toEqual([]);
  });

  it("never masks or contributes mix energy for a NaN band value", () => {
    const nanChannel = makeChannel("weird", 0, { mid: NaN });
    const normal = makeChannel("normal", 1, { mid: -10 });

    const result = compareChannels([nanChannel, normal]);

    expect(result.bandRankings[BAND_LABELS.mid]).toHaveLength(2);
    expect(result.bandRankings[BAND_LABELS.mid]).toEqual(expect.arrayContaining(["weird", "normal"]));

    const midPairs = result.maskingPairs.filter((p) => p.bandName === BAND_LABELS.mid);
    expect(midPairs).toEqual([]);

    expect(result.mixBandEnergy[BAND_LABELS.mid]).toBeCloseTo(-10, 6);
  });

  it("does not flag a NaN sub-bass value as an offender", () => {
    const nanChannel = makeChannel("weird", 0, { subBass: NaN });
    const result = compareChannels([nanChannel]);

    expect(result.subBassOffenders).toEqual([]);
  });

  it("identifies sub-bass offenders strictly above -20 dBFS", () => {
    const hot = makeChannel("hot", 0, { subBass: -15 });
    const atBoundary = makeChannel("atBoundary", 1, { subBass: -20 });
    const quiet = makeChannel("quiet", 2, { subBass: -25 });
    const silent = makeChannel("silent", 3, { subBass: -Infinity });

    const result = compareChannels([hot, atBoundary, quiet, silent]);

    expect(result.subBassOffenders).toEqual(["hot"]);
  });

  it("sums linear energy for mix band energy computation", () => {
    const a = makeChannel("a", 0, { bass: -10 });
    const b = makeChannel("b", 1, { bass: -10 });

    const result = compareChannels([a, b]);

    expect(result.mixBandEnergy[BAND_LABELS.bass]).toBeCloseTo(-10 + DOUBLING_GAIN_DB, 4);
  });
});
