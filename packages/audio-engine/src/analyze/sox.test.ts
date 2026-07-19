import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileWithTimeoutMock = vi.hoisted(() => vi.fn());
vi.mock("./timeout.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./timeout.js")>();
  return { ...actual, execFileWithTimeout: execFileWithTimeoutMock };
});

import { runSox } from "./sox.js";
import { SubprocessTimeoutError } from "./timeout.js";

const FULL_STATS = [
  "Samples read:      123456",
  "Length (seconds):  2.500000",
  "Scaled by:         2147483647.0",
  "Maximum amplitude: 0.500000",
  "Minimum amplitude: -0.500000",
  "Midline amplitude: 0.000000",
  "Mean    norm:      0.100000",
  "Mean    amplitude: 0.000000",
  "RMS     amplitude: 0.150000",
  "Maximum delta:     0.010000",
  "Minimum delta:     0.000000",
  "Mean    delta:     0.005000",
  "RMS     delta:     0.006000",
  "Rough   frequency: 440",
  "Volume adjustment: 1.500",
].join("\n");

beforeEach(() => {
  execFileWithTimeoutMock.mockReset();
});

describe("runSox", () => {
  it("parses stats from a successful resolve (stdout path)", async () => {
    execFileWithTimeoutMock.mockResolvedValueOnce({ stdout: "", stderr: FULL_STATS });

    const stats = await runSox("/audio/take.wav");

    expect(stats.samplesRead).toBe(123456);
    expect(stats.lengthSeconds).toBe(2.5);
    expect(stats.scaledBy).toBe(2147483647);
    expect(stats.volumeAdjustment).toBe(1.5);
    expect(stats.clipping).toBe(false);
  });

  it("parses stats from a rejected call carrying stderr (non-zero exit sox build)", async () => {
    execFileWithTimeoutMock.mockRejectedValueOnce({ stderr: FULL_STATS, stdout: "" });

    const stats = await runSox("/audio/take.wav");

    expect(stats.samplesRead).toBe(123456);
    expect(stats.roughFrequency).toBe(440);
  });

  it("throws when the rejection carries no stderr at all", async () => {
    execFileWithTimeoutMock.mockRejectedValueOnce(new Error("sox: command not found"));

    await expect(runSox("/audio/take.wav")).rejects.toThrow(/sox failed with no stderr/);
  });

  it("rethrows a SubprocessTimeoutError unchanged", async () => {
    const timeoutErr = new SubprocessTimeoutError("sox stat", 60_000);
    execFileWithTimeoutMock.mockRejectedValueOnce(timeoutErr);

    await expect(runSox("/audio/take.wav")).rejects.toBe(timeoutErr);
  });

  it("rethrows an AbortError unchanged", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    execFileWithTimeoutMock.mockRejectedValueOnce(abortErr);

    await expect(runSox("/audio/take.wav")).rejects.toBe(abortErr);
  });

  it("reports -Infinity dBFS when peak/RMS amplitude is zero", async () => {
    const silent = FULL_STATS
      .replace("Maximum amplitude: 0.500000", "Maximum amplitude: 0.000000")
      .replace("Minimum amplitude: -0.500000", "Minimum amplitude: 0.000000")
      .replace("RMS     amplitude: 0.150000", "RMS     amplitude: 0.000000");
    execFileWithTimeoutMock.mockResolvedValueOnce({ stdout: "", stderr: silent });

    const stats = await runSox("/audio/take.wav");

    expect(stats.rmsDbfs).toBe(-Infinity);
    expect(stats.peakDbfs).toBe(-Infinity);
  });

  it("falls back to defaults for missing optional fields, keeping required fields intact", async () => {
    const minimal = [
      "Samples read:      1000",
      "Length (seconds):  1.0",
    ].join("\n");
    execFileWithTimeoutMock.mockResolvedValueOnce({ stdout: "", stderr: minimal });

    const stats = await runSox("/audio/take.wav");

    expect(stats.samplesRead).toBe(1000);
    expect(stats.lengthSeconds).toBe(1.0);
    expect(stats.scaledBy).toBe(0);
    expect(stats.maximumAmplitude).toBe(0);
    expect(stats.minimumAmplitude).toBe(0);
    expect(stats.midlineAmplitude).toBe(0);
    expect(stats.meanNorm).toBe(0);
    expect(stats.meanAmplitude).toBe(0);
    expect(stats.rmsAmplitude).toBe(0);
    expect(stats.maximumDelta).toBe(0);
    expect(stats.minimumDelta).toBe(0);
    expect(stats.meanDelta).toBe(0);
    expect(stats.rmsDelta).toBe(0);
    expect(stats.roughFrequency).toBe(0);
    expect(stats.volumeAdjustment).toBe(1.0);
  });

  it("throws an actionable error when a required field is missing", async () => {
    execFileWithTimeoutMock.mockResolvedValueOnce({ stdout: "", stderr: "nothing useful here" });

    await expect(runSox("/audio/take.wav")).rejects.toThrow(/could not find field "Samples read:"/);
  });
});
