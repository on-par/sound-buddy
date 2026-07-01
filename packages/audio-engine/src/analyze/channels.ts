import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { ChannelFile } from "../types.js";

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set([".wav", ".aif", ".aiff", ".flac", ".mp3"]);

function uniquePrefix(): string {
  return `sb-${randomBytes(6).toString("hex")}`;
}

export async function extractChannels(inputFile: string, names: string[] = []): Promise<ChannelFile[]> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_streams", inputFile],
    { encoding: "utf8" }
  );

  const raw = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; channels?: number }> };
  const audioStream = (raw.streams ?? []).find((s) => s.codec_type === "audio");

  if (!audioStream) throw new Error(`No audio stream found in "${inputFile}"`);

  const channelCount = audioStream.channels ?? 1;

  if (channelCount <= 2) {
    const name = names[0] ?? "CH01";
    return [{ index: 0, name, tmpPath: inputFile, needsCleanup: false }];
  }

  const prefix = uniquePrefix();
  const tmp = tmpdir();
  const channels: ChannelFile[] = [];

  for (let i = 0; i < channelCount; i++) {
    const name = names[i] ?? `CH${String(i + 1).padStart(2, "0")}`;
    const tmpPath = join(tmp, `${prefix}-ch${i}.wav`);

    await execFileAsync("ffmpeg", [
      "-i", inputFile,
      "-map_channel", `0.0.${i}`,
      "-y",
      tmpPath,
    ]);

    channels.push({ index: i, name, tmpPath, needsCleanup: true });
  }

  return channels;
}

export async function loadChannelFiles(dir: string, names: string[] = []): Promise<ChannelFile[]> {
  const entries = readdirSync(dir)
    .filter((f) => AUDIO_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort();

  return entries.map((filename, i) => ({
    index: i,
    name: names[i] ?? `CH${String(i + 1).padStart(2, "0")}`,
    tmpPath: join(dir, filename),
    needsCleanup: false,
  }));
}
