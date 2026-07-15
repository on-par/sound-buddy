import { describe, it, expect } from "vitest";
import { toAnalysisSummary, toChannelResult } from "./summary.js";
import { dominantBandLabel } from "./bands.js";
import type { ChannelAnalysis } from "./types.js";
import type { FrequencyBands } from "./types.js";

// Bands with a clear, unambiguous dominant band (bass) so the expected label
// is deterministic without any floating-point comparison.
const BANDS: FrequencyBands = {
  subBass: -30,
  bass: -6,
  lowMid: -14,
  mid: -10,
  highMid: -20,
  presence: -25,
  brilliance: -35,
};

/**
 * Only the fields toChannelResult/toAnalysisSummary read (channel.name,
 * sox.{rmsDbfs,peakDbfs,dynamicRangeDb}, spectrum.bands) are populated; the
 * cast is safe because the mapper never touches the rest of ChannelAnalysis.
 */
function makeChannelAnalysis(name: string, sox: { rmsDbfs: number; peakDbfs: number; dynamicRangeDb: number }): ChannelAnalysis {
  return {
    channel: { index: 0, name, tmpPath: `/tmp/${name}.wav`, needsCleanup: false },
    analysis: {
      sox,
      spectrum: { bands: BANDS },
    },
  } as ChannelAnalysis;
}

describe("toChannelResult", () => {
  it("maps a single channel to its flat, IPC-safe summary", () => {
    const fake = makeChannelAnalysis("Kick", { rmsDbfs: -18, peakDbfs: -4, dynamicRangeDb: 14 });

    expect(toChannelResult(fake)).toEqual({
      name: "Kick",
      rmsDbfs: -18,
      peakDbfs: -4,
      dynamicRangeDb: 14,
      dominantBand: dominantBandLabel(BANDS),
    });
  });
});

describe("toAnalysisSummary", () => {
  it("maps multiple channels, each field mapped exactly", () => {
    const fakes = [
      makeChannelAnalysis("Kick", { rmsDbfs: -18, peakDbfs: -4, dynamicRangeDb: 14 }),
      makeChannelAnalysis("Snare", { rmsDbfs: -12, peakDbfs: -2, dynamicRangeDb: 10 }),
    ];

    expect(toAnalysisSummary(fakes)).toEqual({
      channels: [
        { name: "Kick", rmsDbfs: -18, peakDbfs: -4, dynamicRangeDb: 14, dominantBand: dominantBandLabel(BANDS) },
        { name: "Snare", rmsDbfs: -12, peakDbfs: -2, dynamicRangeDb: 10, dominantBand: dominantBandLabel(BANDS) },
      ],
    });
  });

  it("returns an empty channels array for an empty input", () => {
    expect(toAnalysisSummary([])).toEqual({ channels: [] });
  });
});
