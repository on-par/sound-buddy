import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { execFileWithTimeout, EXTRACT_TIMEOUT_MS, SubprocessTimeoutError, isAbortError } from "./timeout.js";

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm"]);

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export interface ExtractAudioOptions {
  bin?: string;
  signal?: AbortSignal;
  tmpDir?: string;
}

export async function extractAudioToWav(filePath: string, opts: ExtractAudioOptions = {}): Promise<string> {
  const { bin = "ffmpeg", signal, tmpDir } = opts;
  const outPath = join(tmpDir ?? tmpdir(), `sb-extract-${randomBytes(6).toString("hex")}.wav`);

  try {
    await execFileWithTimeout(
      bin,
      ["-i", filePath, "-vn", "-ac", "2", "-acodec", "pcm_s16le", "-y", outPath],
      { encoding: "utf8", signal },
      "ffmpeg extract",
      EXTRACT_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof SubprocessTimeoutError) throw err;
    if (isAbortError(err)) throw err;
    throw new Error(
      `Could not extract an audio track from "${basename(filePath)}" — make sure the video has sound, or export the audio as a WAV and analyze that instead`,
      { cause: err },
    );
  }

  return outPath;
}
