import { describe, it, expect, vi } from "vitest";

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

import { analyzeAudio } from "./index.js";

mocks.runSoxMock.mockResolvedValue(soxResult);
mocks.runFfprobeMock.mockResolvedValue(ffprobeResult);
mocks.runSpectrumMock.mockResolvedValue(spectrumResult);
mocks.runEbur128Mock.mockResolvedValue(loudnessResult);

describe("analyzeAudio", () => {
  it("threads a resolved LoudnessStats onto analysis.loudness", async () => {
    const analysis = await analyzeAudio("/tmp/take.wav");
    expect(analysis.loudness).toEqual(loudnessResult);
    expect(analysis.sox).toEqual(soxResult);
    expect(analysis.ffprobe).toEqual(ffprobeResult);
    expect(analysis.spectrum).toEqual(spectrumResult);
  });

  it("resolves with loudness: null when runEbur128 rejects while the other three succeed", async () => {
    mocks.runEbur128Mock.mockRejectedValueOnce(new Error("ffmpeg not found"));
    const analysis = await analyzeAudio("/tmp/take.wav");
    expect(analysis.loudness).toBeNull();
    expect(analysis.sox).toEqual(soxResult);
    expect(analysis.ffprobe).toEqual(ffprobeResult);
    expect(analysis.spectrum).toEqual(spectrumResult);
  });
});
