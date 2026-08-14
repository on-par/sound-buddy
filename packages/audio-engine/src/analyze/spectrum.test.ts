import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileWithTimeoutMock = vi.hoisted(() => vi.fn());
vi.mock("./timeout.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./timeout.js")>();
  return { ...actual, execFileWithTimeout: execFileWithTimeoutMock };
});

import { runSpectrum, type RunSpectrumOptions } from "./spectrum.js";
import { SPECTRUM_TIMEOUT_MS } from "./timeout.js";

const SCRIPT_PATH = "/path/to/spectrum.py";

const MODERN_OUTPUT = {
  bands: { sub_bass: -30, bass: -22, low_mid: -18, mid: -16, high_mid: -18, presence: -20, brilliance: -24 },
  spectral_centroid: 1200,
  spectral_rolloff_85: 4800,
  dynamic_range: 12,
  curve: { freqs: [20, 200, 2000, 20000], db: [-30, -22, -18, -24] },
  frames: [
    { t: 0.0, db: [-32, -20, -18, -36], rms: -18.2, class: "speech" },
    { t: 0.5, db: [-28, -16, -14, -34], rms: -14.1, class: "music" },
  ],
  segments: [
    { class: "speech", start: 0, end: 0.6 },
    { class: "music", start: 0.6, end: 1.0 },
  ],
  content_type: "mixed",
};

function mockStdout(value: unknown): void {
  execFileWithTimeoutMock.mockResolvedValueOnce({ stdout: JSON.stringify(value), stderr: "" });
}

function baseOpts(): RunSpectrumOptions {
  return { scriptPath: SCRIPT_PATH };
}

beforeEach(() => {
  execFileWithTimeoutMock.mockReset();
});

describe("runSpectrum", () => {
  it("parses a full modern output: camelCase bands, spectral stats, and all additive fields", async () => {
    mockStdout(MODERN_OUTPUT);

    const result = await runSpectrum("/audio/take.wav", baseOpts());

    expect(result.bands).toEqual({
      subBass: -30,
      bass: -22,
      lowMid: -18,
      mid: -16,
      highMid: -18,
      presence: -20,
      brilliance: -24,
    });
    expect(result.spectralCentroid).toBe(1200);
    expect(result.spectralRolloff85).toBe(4800);
    expect(result.dynamicRange).toBe(12);
    expect(result.curve).toEqual({ freqs: [20, 200, 2000, 20000], db: [-30, -22, -18, -24] });
    expect(result.frames).toEqual([
      { t: 0.0, db: [-32, -20, -18, -36], rms: -18.2, class: "speech" },
      { t: 0.5, db: [-28, -16, -14, -34], rms: -14.1, class: "music" },
    ]);
    expect(result.segments).toEqual([
      { class: "speech", start: 0, end: 0.6 },
      { class: "music", start: 0.6, end: 1.0 },
    ]);
    expect(result.contentType).toBe("mixed");
  });

  it("omits the additive fields when an older build supplies none of them", async () => {
    mockStdout({
      bands: { sub_bass: -30, bass: -22, low_mid: -18, mid: -16, high_mid: -18, presence: -20, brilliance: -24 },
      spectral_centroid: 1200,
      spectral_rolloff_85: 4800,
      dynamic_range: 12,
    });

    const result = await runSpectrum("/audio/take.wav", baseOpts());

    expect(result).toEqual({
      bands: {
        subBass: -30,
        bass: -22,
        lowMid: -18,
        mid: -16,
        highMid: -18,
        presence: -20,
        brilliance: -24,
      },
      spectralCentroid: 1200,
      spectralRolloff85: 4800,
      dynamicRange: 12,
    });
    expect(result.curve).toBeUndefined();
    expect(result.frames).toBeUndefined();
    expect(result.segments).toBeUndefined();
    expect(result.contentType).toBeUndefined();
  });

  it("coerces an unknown content class on a frame and segment to 'unknown'", async () => {
    mockStdout({
      ...MODERN_OUTPUT,
      frames: [{ t: 0.0, db: [-32], rms: -18.2, class: "weird" }],
      segments: [{ class: "weird", start: 0, end: 0.6 }],
    });

    const result = await runSpectrum("/audio/take.wav", baseOpts());

    expect(result.frames?.[0].class).toBe("unknown");
    expect(result.segments?.[0].class).toBe("unknown");
  });

  it("omits contentType when the classifier reports an unknown content type", async () => {
    mockStdout({ ...MODERN_OUTPUT, content_type: "weird" });

    const result = await runSpectrum("/audio/take.wav", baseOpts());

    expect(result.contentType).toBeUndefined();
  });

  it("defaults python to python3 and threads scriptPath, filePath, utf8 encoding and the spectrum label", async () => {
    execFileWithTimeoutMock.mockResolvedValueOnce({ stdout: JSON.stringify(MODERN_OUTPUT), stderr: "" });

    await runSpectrum("/audio/take.wav", baseOpts());

    expect(execFileWithTimeoutMock).toHaveBeenCalledWith(
      "python3",
      [SCRIPT_PATH, "/audio/take.wav"],
      expect.objectContaining({ encoding: "utf8" }),
      "spectrum analysis",
      SPECTRUM_TIMEOUT_MS,
    );
  });

  it("threads a custom python binary, env and abort signal when provided", async () => {
    execFileWithTimeoutMock.mockResolvedValueOnce({ stdout: JSON.stringify(MODERN_OUTPUT), stderr: "" });
    const controller = new AbortController();
    const env = { PATH: "/custom" };

    await runSpectrum("/audio/take.wav", {
      scriptPath: SCRIPT_PATH,
      python: "/venv/bin/python",
      env,
      signal: controller.signal,
    });

    expect(execFileWithTimeoutMock).toHaveBeenCalledWith(
      "/venv/bin/python",
      [SCRIPT_PATH, "/audio/take.wav"],
      expect.objectContaining({ encoding: "utf8", env, signal: controller.signal }),
      "spectrum analysis",
      SPECTRUM_TIMEOUT_MS,
    );
  });
});
