import { describe, it, expect } from "vitest";
import { BAND_METADATA, BAND_LABELS, dominantBandLabel, formatChannelTable } from "./bands.js";
import type { AudioAnalysis, ChannelAnalysis } from "./types.js";

/** Minimal analysis fixture — only the fields formatChannelTable reads. */
function makeAnalysis(opts: {
  bands?: Record<string, number>;
  sox?: Partial<AudioAnalysis["sox"]>;
} = {}): AudioAnalysis {
  return {
    filePath: "/tmp/take.wav",
    sox: {
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
      rmsDbfs: -16,
      peakDbfs: -3,
      dynamicRangeDb: 13,
      clipping: false,
      ...opts.sox,
    },
    ffprobe: {
      format: {
        filename: "/tmp/take.wav",
        formatName: "wav",
        formatLongName: "WAV / WAVE",
        durationSeconds: 1,
        sizeBytes: 88244,
        bitRate: 705920,
        tags: {},
      },
      stream: {
        codecName: "pcm_s16le",
        codecLongName: "PCM signed 16-bit little-endian",
        channels: 1,
        channelLayout: "mono",
        sampleRate: 44100,
        bitDepth: 16,
        bitRate: null,
        durationSeconds: 1,
      },
    },
    spectrum: {
      bands: {
        subBass: -30,
        bass: -12,
        lowMid: -14,
        mid: -10,
        highMid: -16,
        presence: -18,
        brilliance: -22,
        ...opts.bands,
      },
      spectralCentroid: 1800,
      spectralRolloff85: 4500,
      dynamicRange: 13,
    },
    loudness: null,
  };
}

function makeChannel(name: string, index: number, opts: Parameters<typeof makeAnalysis>[0] = {}): ChannelAnalysis {
  return {
    channel: { index, name, tmpPath: `/tmp/${name}.wav`, needsCleanup: false },
    analysis: makeAnalysis(opts),
  };
}

describe("BAND_METADATA", () => {
  it("has all 7 bands in order with the exact keys", () => {
    expect(BAND_METADATA.map((b) => b.key)).toEqual([
      "subBass",
      "bass",
      "lowMid",
      "mid",
      "highMid",
      "presence",
      "brilliance",
    ]);
  });

  it("has the expected labels", () => {
    expect(BAND_METADATA.find((b) => b.key === "subBass")?.label).toBe("Sub-bass");
    expect(BAND_METADATA.find((b) => b.key === "highMid")?.label).toBe("High-mid");
  });

  it("has contiguous bounds — each band's hi equals the next band's lo", () => {
    for (let i = 0; i < BAND_METADATA.length - 1; i++) {
      expect(BAND_METADATA[i].hi).toBe(BAND_METADATA[i + 1].lo);
    }
  });
});

describe("BAND_LABELS", () => {
  it("maps band keys to human labels", () => {
    expect(BAND_LABELS.mid).toBe("Mid");
    expect(BAND_LABELS.brilliance).toBe("Brilliance");
  });
});

describe("dominantBandLabel", () => {
  it("picks the loudest band", () => {
    expect(
      dominantBandLabel({ subBass: -30, bass: -12, lowMid: -14, mid: -10, highMid: -2, presence: -18, brilliance: -22 })
    ).toBe("High-mid");
  });

  it("picks sub-bass when it is the max", () => {
    expect(
      dominantBandLabel({ subBass: -2, bass: -12, lowMid: -14, mid: -10, highMid: -16, presence: -18, brilliance: -22 })
    ).toBe("Sub-bass");
  });

  it("defaults to Mid for an empty object", () => {
    expect(dominantBandLabel({})).toBe("Mid");
  });
});

describe("formatChannelTable", () => {
  it("renders a header row with all column names", () => {
    const lines = formatChannelTable([makeChannel("Vocal", 0)]);
    expect(lines[0]).toContain("Channel");
    expect(lines[0]).toContain("RMS dBFS");
    expect(lines[0]).toContain("Peak dBFS");
    expect(lines[0]).toContain("Dyn Range");
    expect(lines[0]).toContain("Dominant Band");
  });

  it("renders a separator row", () => {
    const lines = formatChannelTable([makeChannel("Vocal", 0)]);
    expect(lines[1]).toMatch(/-{5,}/);
  });

  it("renders a finite-valued row with rms/peak/dyn and the dominant band", () => {
    const lines = formatChannelTable([
      makeChannel("Vocal", 0, { bands: { highMid: -2 }, sox: { rmsDbfs: -16, peakDbfs: -3, dynamicRangeDb: 13 } }),
    ]);
    const row = lines[2];
    expect(row).toContain("-16.00 dBFS");
    expect(row).toContain("13.00 dB");
    expect(row).toContain("High-mid");
  });

  it("renders -inf dBFS for -Infinity rms/peak values", () => {
    const lines = formatChannelTable([makeChannel("Silent", 0, { sox: { rmsDbfs: -Infinity, peakDbfs: -Infinity } })]);
    const row = lines[2];
    expect(row.match(/-inf dBFS/g)).toHaveLength(2);
  });
});
