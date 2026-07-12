import type { FfprobeResult, AudioStream, AudioFormat } from "../types.js";
import { execFileWithTimeout, FFPROBE_TIMEOUT_MS } from "./timeout.js";

export interface RunFfprobeOptions {
  bin?: string;
  signal?: AbortSignal;
}

interface RawFfprobeStream {
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  bits_per_raw_sample?: string;
  bits_per_sample?: number;
  bit_rate?: string;
  duration?: string;
}

interface RawFfprobeFormat {
  filename?: string;
  format_name?: string;
  format_long_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
}

interface RawFfprobeOutput {
  streams?: RawFfprobeStream[];
  format?: RawFfprobeFormat;
}

export async function runFfprobe(filePath: string, opts: RunFfprobeOptions = {}): Promise<FfprobeResult> {
  const { bin = "ffprobe", signal } = opts;
  const { stdout } = await execFileWithTimeout(
    bin,
    [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { encoding: "utf8", signal },
    "ffprobe",
    FFPROBE_TIMEOUT_MS,
  );

  const raw: RawFfprobeOutput = JSON.parse(stdout);

  const rawFormat = raw.format ?? {};
  const audioStream = (raw.streams ?? []).find((s) => s.codec_type === "audio");

  if (!audioStream) {
    throw new Error(`ffprobe: no audio stream found in "${filePath}"`);
  }

  // Bit depth: prefer bits_per_raw_sample, fall back to bits_per_sample
  let bitDepth: number | null = null;
  if (audioStream.bits_per_raw_sample) {
    const v = parseInt(audioStream.bits_per_raw_sample, 10);
    if (!isNaN(v) && v > 0) bitDepth = v;
  }
  if (bitDepth === null && audioStream.bits_per_sample !== undefined && audioStream.bits_per_sample > 0) {
    bitDepth = audioStream.bits_per_sample;
  }

  const stream: AudioStream = {
    codecName: audioStream.codec_name ?? "unknown",
    codecLongName: audioStream.codec_long_name ?? "unknown",
    channels: audioStream.channels ?? 0,
    channelLayout: audioStream.channel_layout ?? (audioStream.channels === 1 ? "mono" : "unknown"),
    sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : 0,
    bitDepth,
    bitRate: audioStream.bit_rate ? parseInt(audioStream.bit_rate, 10) : null,
    durationSeconds: audioStream.duration ? parseFloat(audioStream.duration) : null,
  };

  const formatDuration = rawFormat.duration ? parseFloat(rawFormat.duration) : 0;
  const format: AudioFormat = {
    filename: rawFormat.filename ?? filePath,
    formatName: rawFormat.format_name ?? "unknown",
    formatLongName: rawFormat.format_long_name ?? "unknown",
    durationSeconds: formatDuration,
    sizeBytes: rawFormat.size ? parseInt(rawFormat.size, 10) : 0,
    bitRate: rawFormat.bit_rate ? parseInt(rawFormat.bit_rate, 10) : 0,
    tags: rawFormat.tags ?? {},
  };

  return { format, stream };
}
