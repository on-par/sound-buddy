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
  // sox writes stat output to stderr, but exit code varies by platform/version:
  // some versions exit 0 (success) with stderr populated, others exit non-zero.
  // We need to capture stderr in both cases.
  let stderr = "";
  try {
    const result = await execFileAsync("sox", [filePath, "-n", "stat"], { encoding: "utf8" });
    // sox succeeded — stderr is on the resolved value
    stderr = result.stderr ?? "";
  } catch (err: unknown) {
    // sox exited non-zero — stderr is on the error object
    const e = err as { stderr?: string; stdout?: string };
    stderr = e.stderr ?? "";
    if (!stderr) {
      throw new Error(`sox failed with no stderr output: ${String(err)}`);
    }
  }

  let output = stderr;

  // Some sox versions omit fields for silent/duplicate channels. Make parsing resilient.
  function safeParseField(label: string): number | undefined {
    try { return parseField(output, label); } catch { return undefined; }
  }

  const samplesRead = parseField(output, "Samples read:");
  const lengthSeconds = parseField(output, "Length (seconds):");
  const scaledBy = safeParseField("Scaled by:") ?? 0;
  const maximumAmplitude = safeParseField("Maximum amplitude:") ?? 0;
  const minimumAmplitude = safeParseField("Minimum amplitude:") ?? 0;
  const midlineAmplitude = safeParseField("Midline amplitude:") ?? 0;
  const meanNorm = safeParseField("Mean    norm:") ?? 0;
  const meanAmplitude = safeParseField("Mean    amplitude:") ?? 0;
  const rmsAmplitude = safeParseField("RMS     amplitude:") ?? 0;
  const maximumDelta = safeParseField("Maximum delta:") ?? 0;
  const minimumDelta = safeParseField("Minimum delta:") ?? 0;
  const meanDelta = safeParseField("Mean    delta:") ?? 0;
  const rmsDelta = safeParseField("RMS     delta:") ?? 0;
  const roughFrequency = safeParseField("Rough   frequency:") ?? 0;
  const volumeAdjustment = safeParseField("Volume adjustment:") ?? 1.0;

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
