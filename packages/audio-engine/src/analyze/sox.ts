import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SoxStats } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Parse a single numeric value from sox stat output.
 * Lines look like: "             Samples read:     1234567"
 */
function parseField(output: string, label: string): number {
  // Escape special regex chars in label
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = output.match(new RegExp(`${escaped}\\s+([\\-\\d.]+)`));
  if (!match) {
    throw new Error(`sox stat: could not find field "${label}" in output:\n${output}`);
  }
  return parseFloat(match[1]);
}

function amplitudeToDbfs(amplitude: number): number {
  if (amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

export async function runSox(filePath: string): Promise<SoxStats> {
  // sox writes stat output to stderr
  let stderr = "";
  try {
    await execFileAsync("sox", [filePath, "-n", "stat"], { encoding: "utf8" });
  } catch (err: unknown) {
    // sox stat exits with code 2 and writes to stderr — this is normal
    const e = err as { stderr?: string; stdout?: string };
    stderr = e.stderr ?? "";
    if (!stderr) {
      throw new Error(`sox failed with no stderr output: ${String(err)}`);
    }
  }

  const output = stderr;

  const samplesRead = parseField(output, "Samples read:");
  const lengthSeconds = parseField(output, "Length (seconds):");
  const scaledBy = parseField(output, "Scaled by:");
  const maximumAmplitude = parseField(output, "Maximum amplitude:");
  const minimumAmplitude = parseField(output, "Minimum amplitude:");
  const midlineAmplitude = parseField(output, "Midline amplitude:");
  const meanNorm = parseField(output, "Mean    norm:");
  const meanAmplitude = parseField(output, "Mean    amplitude:");
  const rmsAmplitude = parseField(output, "RMS     amplitude:");
  const maximumDelta = parseField(output, "Maximum delta:");
  const minimumDelta = parseField(output, "Minimum delta:");
  const meanDelta = parseField(output, "Mean    delta:");
  const rmsDelta = parseField(output, "RMS     delta:");
  const roughFrequency = parseField(output, "Rough   frequency:");
  const volumeAdjustment = parseField(output, "Volume adjustment:");

  const peakAmplitude = Math.max(Math.abs(maximumAmplitude), Math.abs(minimumAmplitude));
  const rmsDbfs = amplitudeToDbfs(rmsAmplitude);
  const peakDbfs = amplitudeToDbfs(peakAmplitude);
  const dynamicRangeDb = peakDbfs - rmsDbfs;
  const clipping = peakAmplitude >= 1.0;

  return {
    samplesRead,
    lengthSeconds,
    scaledBy,
    maximumAmplitude,
    minimumAmplitude,
    midlineAmplitude,
    meanNorm,
    meanAmplitude,
    rmsAmplitude,
    maximumDelta,
    minimumDelta,
    meanDelta,
    rmsDelta,
    roughFrequency,
    volumeAdjustment,
    rmsDbfs,
    peakDbfs,
    dynamicRangeDb,
    clipping,
  };
}
