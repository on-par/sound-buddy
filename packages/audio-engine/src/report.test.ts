import { describe, it, expect } from "vitest";
import { buildReport, buildSummaryTable, formatMultiChannelReport } from "./report.js";
import type {
  AudioAnalysis,
  ChannelAnalysis,
  ChannelComparison,
  ContentType,
  FrequencyBands,
} from "./types.js";

/**
 * Minimal analysis fixture. `bands`/`contentType` overrides let each test drive
 * the content-aware observations (PRD 04) without a real sox/ffprobe/python run.
 */
type MakeAnalysisOpts = {
  contentType?: ContentType;
  bands?: Partial<FrequencyBands>;
  sox?: Partial<AudioAnalysis["sox"]>;
  format?: Partial<AudioAnalysis["ffprobe"]["format"]>;
  stream?: Partial<AudioAnalysis["ffprobe"]["stream"]>;
  spectrum?: Partial<Pick<AudioAnalysis["spectrum"], "spectralCentroid" | "spectralRolloff85" | "dynamicRange">>;
};

function makeAnalysis(opts: MakeAnalysisOpts = {}): AudioAnalysis {
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
        ...opts.format,
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
        ...opts.stream,
      },
    },
    spectrum: {
      bands,
      spectralCentroid: 1800,
      spectralRolloff85: 4500,
      dynamicRange: 13,
      ...opts.spectrum,
      ...(opts.contentType ? { contentType: opts.contentType } : {}),
    },
    loudness: null,
  };
}

/** Channel fixture mirroring analyze/compare.test.ts's makeChannel, but backed
 * by makeAnalysis so sox/spectrum fields formatMultiChannelReport reads are real. */
function makeChannel(name: string, index: number, opts: MakeAnalysisOpts = {}): ChannelAnalysis {
  return {
    channel: { index, name, tmpPath: `/tmp/${name}.wav`, needsCleanup: false },
    analysis: makeAnalysis(opts),
  };
}

function makeComparison(overrides: Partial<ChannelComparison> = {}): ChannelComparison {
  return {
    bandRankings: {},
    maskingPairs: [],
    subBassOffenders: [],
    mixBandEnergy: {},
    ...overrides,
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

describe("buildReport — observations and formatting", () => {
  it("flags clipping in both the amplitude section and observations", () => {
    const report = buildReport(makeAnalysis({ sox: { clipping: true, maximumAmplitude: 1.0, minimumAmplitude: -1.0, peakDbfs: 0 } }));
    expect(report).toContain("Clipping detected:   YES *** WARNING ***");
    expect(report).toContain("! Clipping: Signal hits or exceeds 0 dBFS");
  });

  it("reports no clipping by default", () => {
    const report = buildReport(makeAnalysis());
    expect(report).toContain("Clipping detected:   No");
    expect(report).not.toContain("! Clipping");
  });

  it("flags very hot RMS", () => {
    expect(buildReport(makeAnalysis({ sox: { rmsDbfs: -3 } }))).toContain("! Loudness: Very hot");
  });

  it("flags moderately loud RMS", () => {
    expect(buildReport(makeAnalysis({ sox: { rmsDbfs: -10 } }))).toContain(". Loudness: Moderately loud");
  });

  it("calls a quiet mix quiet when it isn't a dynamic service recording", () => {
    expect(buildReport(makeAnalysis({ sox: { rmsDbfs: -25 } }))).toContain("Quiet mix");
  });

  it("reports normal loudness range by default", () => {
    expect(buildReport(makeAnalysis())).toContain(". Loudness: Normal range");
  });

  it("does not call a music recording a dynamic service when peak fails the -12 dBFS gate", () => {
    const report = buildReport(makeAnalysis({ contentType: "music", sox: { rmsDbfs: -26, peakDbfs: -13, dynamicRangeDb: 20 } }));
    expect(report).toContain("Quiet mix");
    expect(report).not.toContain("Dynamic service");
  });

  it("does not call a music recording a dynamic service when dynamic range fails the 15 dB gate", () => {
    const report = buildReport(makeAnalysis({ contentType: "music", sox: { rmsDbfs: -26, peakDbfs: -6, dynamicRangeDb: 14 } }));
    expect(report).toContain("Quiet mix");
    expect(report).not.toContain("Dynamic service");
  });

  it("does not call a speech recording a dynamic service (content-type gate)", () => {
    const report = buildReport(makeAnalysis({ contentType: "speech", sox: { rmsDbfs: -26, peakDbfs: -6, dynamicRangeDb: 20 } }));
    expect(report).toContain("Quiet mix");
    expect(report).not.toContain("Dynamic service");
  });

  it("flags a zero dynamic range as very compressed", () => {
    expect(buildReport(makeAnalysis({ sox: { dynamicRangeDb: 0 } }))).toContain("! Dynamics: Very compressed -- 0.00 dB");
  });

  it("flags a negative dynamic range as very compressed", () => {
    expect(buildReport(makeAnalysis({ sox: { dynamicRangeDb: -2 } }))).toContain("! Dynamics: Very compressed -- -2.00 dB");
  });

  it("flags a moderately compressed dynamic range", () => {
    expect(buildReport(makeAnalysis({ sox: { dynamicRangeDb: 8 } }))).toContain(". Dynamics: Moderately compressed");
  });

  it("flags a very large dynamic range as good", () => {
    expect(buildReport(makeAnalysis({ sox: { dynamicRangeDb: 90 } }))).toContain(". Dynamics: Good dynamic range -- 90.00 dB");
  });

  it("calls the default spectral balance bright/airy", () => {
    expect(buildReport(makeAnalysis())).toContain("Bright/airy character");
  });

  it("flags a heavy low-end bias", () => {
    expect(buildReport(makeAnalysis({ bands: { brilliance: -4, bass: -12 } }))).toContain("! Spectral balance: Heavy low-end bias");
  });

  it("calls a mid-range brightness ratio reasonably balanced", () => {
    expect(buildReport(makeAnalysis({ bands: { brilliance: -6, bass: -12 } }))).toContain("Reasonably balanced");
  });

  it("flags generic sub-bass mud when sub-bass nearly equals or exceeds bass", () => {
    const report = buildReport(makeAnalysis({ bands: { subBass: -10, bass: -12 } }));
    expect(report).toContain("! Sub-bass:");
    expect(report).toContain("possible mud/rumble");
  });

  it("flags a non-speech presence dip past the 12 dB threshold", () => {
    const report = buildReport(makeAnalysis({ bands: { mid: -8, presence: -21 } }));
    expect(report).toContain("Presence dip");
    expect(report).toContain("recessed/dull");
  });

  it("builds without throwing when some bands are -Infinity", () => {
    const report = buildReport(makeAnalysis({ bands: { subBass: -Infinity, presence: -Infinity } }));
    expect(report).toContain("Sub-bass   (20-60 Hz):      -Infinity dB");
  });

  it("builds without throwing when every band is -Infinity", () => {
    const report = buildReport(
      makeAnalysis({
        bands: {
          subBass: -Infinity,
          bass: -Infinity,
          lowMid: -Infinity,
          mid: -Infinity,
          highMid: -Infinity,
          presence: -Infinity,
          brilliance: -Infinity,
        },
      }),
    );
    expect(report).toContain("=== END OF REPORT ===");
  });

  it("renders -inf for a -Infinity RMS level", () => {
    expect(buildReport(makeAnalysis({ sox: { rmsDbfs: -Infinity } }))).toContain("RMS level:           -inf dBFS");
  });

  it("renders sub-kHz spectral centroid in Hz", () => {
    expect(buildReport(makeAnalysis({ spectrum: { spectralCentroid: 800 } }))).toContain("Spectral centroid:      800 Hz");
  });

  it("renders file size in MB above the 1MB threshold", () => {
    expect(buildReport(makeAnalysis({ format: { sizeBytes: 2_500_000 } }))).toContain("2.50 MB");
  });

  it("renders file size in bytes below the 1KB threshold", () => {
    expect(buildReport(makeAnalysis({ format: { sizeBytes: 500 } }))).toContain("500 B");
  });

  it("renders duration with minutes once past 60 seconds", () => {
    expect(buildReport(makeAnalysis({ format: { durationSeconds: 125 } }))).toContain("Duration:        2:05.0");
  });

  it("renders format tags when present", () => {
    const report = buildReport(makeAnalysis({ format: { tags: { artist: "Worship Team", date: "2026" } } }));
    expect(report).toContain("Tags:");
    expect(report).toContain("artist: Worship Team");
    expect(report).toContain("date: 2026");
  });

  it("omits the tags block when there are no tags", () => {
    expect(buildReport(makeAnalysis())).not.toContain("Tags:");
  });

  it("renders stream bitrate when present", () => {
    expect(buildReport(makeAnalysis({ stream: { bitRate: 256000 } }))).toContain("Stream bitrate: 256 kbps");
  });

  it("omits stream bitrate when null", () => {
    expect(buildReport(makeAnalysis())).not.toContain("Stream bitrate:");
  });

  it("renders N/A (lossy) when bit depth is null", () => {
    expect(buildReport(makeAnalysis({ stream: { bitDepth: null } }))).toContain("Bit depth:      N/A (lossy)");
  });

  it("renders bit depth in bits by default", () => {
    expect(buildReport(makeAnalysis())).toContain("16-bit");
  });

  it("labels silence content type with an n/a target", () => {
    const report = buildReport(makeAnalysis({ contentType: "silence" }));
    expect(report).toContain("Content type: Silence");
    expect(report).toContain("thresholds tuned for n/a");
  });

  it("labels speech content type as tuned for intelligibility / presence", () => {
    expect(buildReport(makeAnalysis({ contentType: "speech" }))).toContain("thresholds tuned for intelligibility / presence");
  });
});

describe("buildSummaryTable — remaining branches", () => {
  it("renders a clipping warning row", () => {
    expect(buildSummaryTable(makeAnalysis({ sox: { clipping: true } }))).toContain("YES *** WARNING ***");
  });

  it("renders no clipping row by default", () => {
    const table = buildSummaryTable(makeAnalysis());
    expect(table).toContain("Clipping");
    expect(table).toContain("No");
  });

  it("renders lossy for a null bit depth", () => {
    expect(buildSummaryTable(makeAnalysis({ stream: { bitDepth: null } }))).toContain("lossy");
  });

  it("renders bit depth in bits when present", () => {
    expect(buildSummaryTable(makeAnalysis({ stream: { bitDepth: 24 } }))).toContain("24-bit");
  });

  it("renders -inf dBFS and an infinite headroom for -Infinity peak/RMS", () => {
    const table = buildSummaryTable(makeAnalysis({ sox: { rmsDbfs: -Infinity, peakDbfs: -Infinity } }));
    expect(table.split("-inf dBFS").length - 1).toBe(2);
    expect(table).toContain("Infinity dB");
  });

  it("renders channel count and layout", () => {
    expect(buildSummaryTable(makeAnalysis({ stream: { channels: 8, channelLayout: "7.1" } }))).toContain("8 (7.1)");
  });

  it("renders sub-kHz spectral centroid in Hz", () => {
    expect(buildSummaryTable(makeAnalysis({ spectrum: { spectralCentroid: 950 } }))).toContain("950 Hz");
  });
});

describe("formatMultiChannelReport", () => {
  it("renders the summary frame for an empty channel list and empty comparison", () => {
    const report = formatMultiChannelReport([], makeComparison());
    expect(report).toContain("=== MULTI-CHANNEL SUMMARY ===");
    expect(report).toContain("Channel");
    expect(report).toContain("RMS dBFS");
    expect(report).toContain("Dominant Band");
    expect(report).toContain("Mix band energy:");
    expect(report).toContain("=== END MULTI-CHANNEL SUMMARY ===");
    expect(report).not.toContain("Sub-bass offenders");
    expect(report).not.toContain("Frequency masking detected:");
  });

  it("renders a single channel row with its dominant band", () => {
    const report = formatMultiChannelReport([makeChannel("Vocal", 0)], makeComparison());
    expect(report).toContain("-16.00 dBFS");
    expect(report).toContain("-3.00 dBFS");
    expect(report).toContain("13.00 dB");
    expect(report).toContain("Mid");
    const vocalLine = report.split("\n").find((l) => l.startsWith("Vocal"));
    expect(vocalLine).toBeDefined();
  });

  it("renders a row for every channel across 8+ channels", () => {
    const channels = Array.from({ length: 8 }, (_, i) => makeChannel(`ch${i + 1}`, i));
    const report = formatMultiChannelReport(channels, makeComparison());
    for (let i = 1; i <= 8; i++) {
      expect(report).toContain(`ch${i}`);
    }
  });

  const DOMINANT_LABELS: [keyof FrequencyBands, string][] = [
    ["subBass", "Sub-bass"],
    ["bass", "Bass"],
    ["lowMid", "Low-mid"],
    ["mid", "Mid"],
    ["highMid", "High-mid"],
    ["presence", "Presence"],
    ["brilliance", "Brilliance"],
  ];

  for (const [key, label] of DOMINANT_LABELS) {
    it(`labels ${key} as dominant band "${label}"`, () => {
      const channel = makeChannel("Ch", 0, { bands: { [key]: -5 } as Partial<FrequencyBands> });
      const report = formatMultiChannelReport([channel], makeComparison());
      const lines = report.split("\n");
      const separatorIndex = lines.findIndex((l) => /^-+$/.test(l));
      const row = lines[separatorIndex + 1];
      expect(row).toContain(label);
    });
  }

  it("falls back to the raw band key when it has no known label", () => {
    const channel = makeChannel("Ch", 0);
    // Exercises the `?? dominantBandKey` defensive fallback for a band key that
    // isn't in the known dominantLabels map — not reachable via FrequencyBands alone.
    channel.analysis.spectrum.bands = { ...channel.analysis.spectrum.bands, ultra: 0 } as unknown as FrequencyBands;
    const report = formatMultiChannelReport([channel], makeComparison());
    expect(report).toContain("ultra");
  });

  it("does not dedupe channels with identical names", () => {
    const channels = [makeChannel("Vox", 0), makeChannel("Vox", 1)];
    const report = formatMultiChannelReport(channels, makeComparison());
    expect(report.split("Vox").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("widens columns to fit a channel name longer than the minimum width", () => {
    const report = formatMultiChannelReport([makeChannel("SuperLongChannelName", 0)], makeComparison());
    const header = report.split("\n").find((l) => l.startsWith("Channel"));
    expect(header).toContain("Channel".padEnd(20));
  });

  it("renders -inf dBFS for -Infinity RMS/peak", () => {
    const channel = makeChannel("Silent", 0, { sox: { rmsDbfs: -Infinity, peakDbfs: -Infinity } });
    const report = formatMultiChannelReport([channel], makeComparison());
    expect(report).toContain("-inf dBFS");
  });

  it("lists sub-bass offenders when present", () => {
    const report = formatMultiChannelReport([], makeComparison({ subBassOffenders: ["Kick", "Bass DI"] }));
    expect(report).toContain("Sub-bass offenders (>-20 dBFS): Kick, Bass DI");
  });

  it("lists masking pairs when present", () => {
    const report = formatMultiChannelReport(
      [],
      makeComparison({ maskingPairs: [{ bandName: "Mid (500-2000 Hz)", channelA: "Vox", channelB: "Gtr", energyDiff: 2 }] }),
    );
    expect(report).toContain("Frequency masking detected:");
    expect(report).toContain("Mid (500-2000 Hz): Vox ↔ Gtr (2.00 dB apart)");
  });

  it("renders finite and -inf mix band energy rows", () => {
    const report = formatMultiChannelReport(
      [],
      makeComparison({ mixBandEnergy: { "Bass (60-250 Hz)": -10.5, "Mid (500-2000 Hz)": -Infinity } }),
    );
    expect(report).toContain("-10.50 dBFS");
    expect(report).toContain("-inf dBFS");
  });

  it("omits offender and masking sections when comparison data is empty", () => {
    const report = formatMultiChannelReport([makeChannel("Vocal", 0)], makeComparison());
    expect(report).not.toContain("Sub-bass offenders");
    expect(report).not.toContain("Frequency masking detected:");
  });
});

describe("buildReport — gain structure (#369)", () => {
  it("surfaces a cold-channel warning and health score", () => {
    const report = buildReport(makeAnalysis({ sox: { rmsDbfs: -34 } }));
    expect(report).toContain("[ GAIN STRUCTURE ]");
    expect(report).toContain("Health score:");
    expect(report).toMatch(/below the -18 dBFS target/);
  });

  it("reports a healthy channel as gain structure healthy", () => {
    const report = buildReport(makeAnalysis());
    expect(report).toContain("Gain structure healthy");
  });
});

describe("formatMultiChannelReport — gain structure (#369)", () => {
  it("surfaces the overall score and a cold-channel flag", () => {
    const report = formatMultiChannelReport(
      [makeChannel("Cold Ch", 0, { sox: { rmsDbfs: -34 } })],
      makeComparison(),
    );
    expect(report).toContain("Gain structure health:");
    expect(report).toContain("Overall score:");
    expect(report).toContain("Cold Ch (cold");
  });
});

describe("buildSummaryTable — gain structure (#369)", () => {
  it("includes a Gain Health row", () => {
    const table = buildSummaryTable(makeAnalysis());
    expect(table).toContain("Gain Health");
  });
});
