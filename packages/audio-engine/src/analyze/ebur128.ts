import type { LoudnessStats } from "../types.js";
import { execFileWithTimeout, EBUR128_TIMEOUT_MS } from "./timeout.js";

export interface RunEbur128Options {
  bin?: string;
  signal?: AbortSignal;
}

// ffmpeg's ebur128 filter writes per-frame progress lines AND the final
// summary to stderr; the per-frame lines also contain "I:"/"LRA:" tokens, so
// we must only search the tail after the last "Summary:" marker or a
// per-frame line could match instead of the real summary. "-inf" (not just a
// numeric value or "nan") is a real value ffmpeg prints for true peak on
// fully-silent audio — a muted channel or pre-service silence is common
// enough in church recordings that it must parse, not throw.
const INTEGRATED_LUFS_RE = /^\s*I:\s+(-?[\d.]+|-inf|nan)\s+LUFS/m;
const LOUDNESS_RANGE_RE = /^\s*LRA:\s+(-?[\d.]+|-inf|nan)\s+LU/m;
const TRUE_PEAK_RE = /^\s*Peak:\s+(-?[\d.]+|-inf|nan)\s+dBFS/m;

function parseField(tail: string, re: RegExp, fieldName: string): number {
  const match = tail.match(re);
  const raw = match?.[1];
  const value = raw === "-inf" ? -Infinity : raw !== undefined ? parseFloat(raw) : NaN;
  if (!match || Number.isNaN(value)) {
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

// ebur128 prints a progress line to stderr roughly every 100ms of audio;
// a multi-hour service recording can produce many MB before the summary
// block, well past Node's 1 MB execFile default (which would otherwise
// throw ERR_CHILD_PROCESS_STDIO_MAXBUFFER and silently drop loudness data).
const EBUR128_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export async function runEbur128(filePath: string, opts: RunEbur128Options = {}): Promise<LoudnessStats> {
  const { bin = "ffmpeg", signal } = opts;
  const { stderr } = await execFileWithTimeout(
    bin,
    ["-nostats", "-hide_banner", "-i", filePath, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: EBUR128_MAX_BUFFER_BYTES, signal },
    "ffmpeg ebur128",
    EBUR128_TIMEOUT_MS,
  );

  return parseEbur128Summary(stderr);
}
