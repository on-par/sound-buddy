import { describe, it, expect } from "vitest";
import { buildReport, buildSummaryTable } from "./report.js";
import type { AudioAnalysis, ContentType, FrequencyBands } from "./types.js";

/**
 * Minimal analysis fixture. `bands`/`contentType` overrides let each test drive
 * the content-aware observations (PRD 04) without a real sox/ffprobe/python run.
 */
function makeAnalysis(opts: {
  contentType?: ContentType;
  bands?: Partial<FrequencyBands>;
  sox?: Partial<AudioAnalysis["sox"]>;
} = {}): AudioAnalysis {
  const bands: FrequencyBands = {
    subBass: -30,
    bass: -12,
    lowMid: -14,
    mid: -10,
    highMid: -16,
    presence: -18,
    brilliance: -22,
    ...opts.bands,
  };
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
      bands,
      spectralCentroid: 1800,
      spectralRolloff85: 4500,
      dynamicRange: 13,
      ...(opts.contentType ? { contentType: opts.contentType } : {}),
    },
    loudness: null,
  };
}

describe("buildReport — content type (PRD 04)", () => {
  it("surfaces the detected content type in the observations", () => {
    expect(buildReport(makeAnalysis({ contentType: "speech" }))).toContain("Content type: Speech");
    expect(buildReport(makeAnalysis({ contentType: "music" }))).toContain("Content type: Music");
  });

  it("describes music and mixed content as tuned for the worship-service target", () => {
    expect(buildReport(makeAnalysis({ contentType: "music" }))).toContain("thresholds tuned for worship service reference");
    expect(buildReport(makeAnalysis({ contentType: "mixed" }))).toContain("thresholds tuned for worship service reference");
  });

  it("does not call high-dynamic worship recordings quiet just because whole-file RMS is low", () => {
    const sox = { rmsDbfs: -26.76, peakDbfs: -6.21, dynamicRangeDb: 20.55 };

    const mixedReport = buildReport(makeAnalysis({ contentType: "mixed", sox }));
    expect(mixedReport).toContain("Dynamic service");
    expect(mixedReport).not.toContain("Quiet mix");

    const musicReport = buildReport(makeAnalysis({ contentType: "music", sox: { ...sox, peakDbfs: -11.5 } }));
    expect(musicReport).toContain("Dynamic service");
    expect(musicReport).not.toContain("Quiet mix");
  });

  it("omits the content-type line when the classifier did not run", () => {
    expect(buildReport(makeAnalysis())).not.toContain("Content type:");
  });

  it("flags a presence dip for speech that music tolerates (tighter speech threshold)", () => {
    // presence sits 10 dB under mid: past the speech threshold (8), under music's (12).
    const bands = { mid: -8, presence: -18 };
    expect(buildReport(makeAnalysis({ contentType: "speech", bands }))).toContain("Presence dip");
    expect(buildReport(makeAnalysis({ contentType: "music", bands }))).not.toContain("Presence dip");
  });

  it("describes a speech presence dip as an intelligibility problem", () => {
    const report = buildReport(makeAnalysis({ contentType: "speech", bands: { mid: -8, presence: -18 } }));
    expect(report).toContain("unintelligible/dull");
  });

  it("warns on high sub-bass for speech even when it stays under the bass mud threshold", () => {
    // subBass well below bass (no generic mud flag) but high vs the voice band.
    const bands = { subBass: -14, bass: -6, mid: -18 };
    const report = buildReport(makeAnalysis({ contentType: "speech", bands }));
    expect(report).toContain("Sub-bass (speech)");
  });
});

describe("buildSummaryTable — content type (PRD 04)", () => {
  it("adds a Content Type row when classified", () => {
    expect(buildSummaryTable(makeAnalysis({ contentType: "mixed" }))).toContain("Content Type");
    expect(buildSummaryTable(makeAnalysis({ contentType: "mixed" }))).toContain("Mixed (speech + music)");
  });

  it("omits the Content Type row when unclassified", () => {
    expect(buildSummaryTable(makeAnalysis())).not.toContain("Content Type");
  });
});
