import type { LoudnessStats } from "../types.js";
import { execFileWithTimeout, EBUR128_TIMEOUT_MS } from "./timeout.js";

// ffmpeg's ebur128 filter writes per-frame progress lines AND the final
// summary to stderr; the per-frame lines also contain "I:"/"LRA:" tokens, so
// we must only search the tail after the last "Summary:" marker or a
// per-frame line could match instead of the real summary.
const INTEGRATED_LUFS_RE = /^\s*I:\s+(-?[\d.]+|nan)\s+LUFS/m;
const LOUDNESS_RANGE_RE = /^\s*LRA:\s+(-?[\d.]+|nan)\s+LU/m;
const TRUE_PEAK_RE = /^\s*Peak:\s+(-?[\d.]+|nan)\s+dBFS/m;

function parseField(tail: string, re: RegExp, fieldName: string): number {
  const match = tail.match(re);
  const value = match ? parseFloat(match[1]) : NaN;
  if (!match || !isFinite(value)) {
    throw new Error(
      `ffmpeg ebur128: could not parse ${fieldName} from summary output — the file may be too short or the bundled ffmpeg outdated; the report card will fall back to RMS levels`,
    );
  }
  return value;
}

export function parseEbur128Summary(output: string): LoudnessStats {
  const summaryIndex = output.lastIndexOf("Summary:");
  const tail = summaryIndex >= 0 ? output.slice(summaryIndex) : "";

  return {
    integratedLufs: parseField(tail, INTEGRATED_LUFS_RE, "integrated loudness"),
    loudnessRange: parseField(tail, LOUDNESS_RANGE_RE, "loudness range"),
    truePeakDbtp: parseField(tail, TRUE_PEAK_RE, "true peak"),
  };
}

export async function runEbur128(filePath: string): Promise<LoudnessStats> {
  const { stderr } = await execFileWithTimeout(
    "ffmpeg",
    ["-nostats", "-hide_banner", "-i", filePath, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
    { encoding: "utf8" },
    "ffmpeg ebur128",
    EBUR128_TIMEOUT_MS,
  );

  return parseEbur128Summary(stderr);
}
