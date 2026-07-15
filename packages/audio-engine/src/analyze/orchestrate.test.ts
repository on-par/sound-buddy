import { describe, it, expect, vi, beforeEach } from "vitest";

const soxResult = { rmsDbfs: -9, peakDbfs: -6 } as unknown;
const ffprobeResult = { stream: { channels: 1 } } as unknown;
const spectrumResult = { bands: {} } as unknown;
const loudnessResult = { integratedLufs: -9, loudnessRange: 0, truePeakDbtp: -6 } as unknown;

const mocks = vi.hoisted(() => ({
  runSoxMock: vi.fn(),
  runFfprobeMock: vi.fn(),
  runSpectrumMock: vi.fn(),
  runEbur128Mock: vi.fn(),
}));

vi.mock("./sox.js", () => ({ runSox: mocks.runSoxMock }));
vi.mock("./ffprobe.js", () => ({ runFfprobe: mocks.runFfprobeMock }));
vi.mock("./spectrum.js", () => ({ runSpectrum: mocks.runSpectrumMock }));
vi.mock("./ebur128.js", () => ({ runEbur128: mocks.runEbur128Mock }));

import { analyzeAudio } from "./orchestrate.js";

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runSoxMock.mockResolvedValue(soxResult);
  mocks.runFfprobeMock.mockResolvedValue(ffprobeResult);
  mocks.runSpectrumMock.mockResolvedValue(spectrumResult);
  mocks.runEbur128Mock.mockResolvedValue(loudnessResult);
});

describe("analyzeAudio (orchestrate)", () => {
  it("threads all four resolved results onto the assembled analysis and passes scriptPath to runSpectrum", async () => {
    const analysis = await analyzeAudio("/tmp/take.wav", { spectrum: { scriptPath: "/path/to/spectrum.py" } });

    expect(analysis).toEqual({
      filePath: "/tmp/take.wav",
      sox: soxResult,
      ffprobe: ffprobeResult,
      spectrum: spectrumResult,
      loudness: loudnessResult,
    });
    expect(mocks.runSpectrumMock).toHaveBeenCalledWith(
      "/tmp/take.wav",
      expect.objectContaining({ scriptPath: "/path/to/spectrum.py" }),
    );
  });

  it("threads the top-level signal into every parser call", async () => {
    const controller = new AbortController();
    await analyzeAudio("/tmp/take.wav", {
      spectrum: { scriptPath: "/path/to/spectrum.py" },
      signal: controller.signal,
    });

    expect(mocks.runSoxMock).toHaveBeenCalledWith("/tmp/take.wav", expect.objectContaining({ signal: controller.signal }));
    expect(mocks.runFfprobeMock).toHaveBeenCalledWith(
      "/tmp/take.wav",
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(mocks.runSpectrumMock).toHaveBeenCalledWith(
      "/tmp/take.wav",
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(mocks.runEbur128Mock).toHaveBeenCalledWith(
      "/tmp/take.wav",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("fires onProgress exactly once per stage on success, including ebur128", async () => {
    const seen: string[] = [];
    await analyzeAudio("/tmp/take.wav", {
      spectrum: { scriptPath: "/path/to/spectrum.py" },
      onProgress: (stage) => seen.push(stage),
    });

    expect(seen.filter((s) => s === "sox")).toHaveLength(1);
    expect(seen.filter((s) => s === "ffprobe")).toHaveLength(1);
    expect(seen.filter((s) => s === "spectrum")).toHaveLength(1);
    expect(seen.filter((s) => s === "ebur128")).toHaveLength(1);
  });

  it("noSpectrum: true skips runSpectrum, resolves the silent placeholder, and still fires onProgress('spectrum')", async () => {
    const seen: string[] = [];
    const analysis = await analyzeAudio("/tmp/take.wav", {
      noSpectrum: true,
      onProgress: (stage) => seen.push(stage),
    });

    expect(mocks.runSpectrumMock).not.toHaveBeenCalled();
    expect(analysis.spectrum).toEqual({
      bands: {
        subBass: -120,
        bass: -120,
        lowMid: -120,
        mid: -120,
        highMid: -120,
        presence: -120,
        brilliance: -120,
      },
      spectralCentroid: 0,
      spectralRolloff85: 0,
      dynamicRange: 0,
    });
    expect(seen).toContain("spectrum");
  });

  it("resolves loudness: null and calls onEbur128Error once when ebur128 rejects with a non-abort error", async () => {
    const boom = new Error("ffmpeg not found");
    mocks.runEbur128Mock.mockRejectedValueOnce(boom);
    const onEbur128Error = vi.fn();

    const analysis = await analyzeAudio("/tmp/take.wav", {
      spectrum: { scriptPath: "/path/to/spectrum.py" },
      onEbur128Error,
    });

    expect(analysis.loudness).toBeNull();
    expect(onEbur128Error).toHaveBeenCalledTimes(1);
    expect(onEbur128Error).toHaveBeenCalledWith(boom);
  });

  it("rejects (does not swallow) when ebur128 rejects with an AbortError, and does not call onEbur128Error", async () => {
    mocks.runEbur128Mock.mockRejectedValueOnce(abortError());
    const onEbur128Error = vi.fn();

    await expect(
      analyzeAudio("/tmp/take.wav", { spectrum: { scriptPath: "/path/to/spectrum.py" }, onEbur128Error }),
    ).rejects.toThrow("The operation was aborted");
    expect(onEbur128Error).not.toHaveBeenCalled();
  });

  it("rejects when a non-ebur128 parser (sox) rejects with an AbortError", async () => {
    mocks.runSoxMock.mockRejectedValueOnce(abortError());

    await expect(analyzeAudio("/tmp/take.wav", { spectrum: { scriptPath: "/path/to/spectrum.py" } })).rejects.toThrow(
      "The operation was aborted",
    );
  });

  it("rejects with an actionable error, without calling runSpectrum, when spectrum is omitted and noSpectrum is not set", async () => {
    await expect(analyzeAudio("/tmp/take.wav", {})).rejects.toThrow(
      "analyzeAudio: opts.spectrum.scriptPath is required unless opts.noSpectrum is true",
    );
    expect(mocks.runSpectrumMock).not.toHaveBeenCalled();
  });
});
