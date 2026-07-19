import { describe, it, expect, vi, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: execFileAsyncMock,
  }),
}));

const readdirSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ readdirSync: readdirSyncMock }));

import { extractChannels, loadChannelFiles } from "./channels.js";

function ffprobeResult(channels?: number, codecType = "audio") {
  return { stdout: JSON.stringify({ streams: [{ codec_type: codecType, channels }] }), stderr: "" };
}

beforeEach(() => {
  execFileAsyncMock.mockReset();
  readdirSyncMock.mockReset();
});

describe("extractChannels", () => {
  it("returns a single passthrough entry for a mono file", async () => {
    execFileAsyncMock.mockResolvedValueOnce(ffprobeResult(1));

    const result = await extractChannels("/audio/service.wav");

    expect(result).toEqual([{ index: 0, name: "CH01", tmpPath: "/audio/service.wav", needsCleanup: false }]);
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", "/audio/service.wav"],
      { encoding: "utf8" },
    );
  });

  it("returns a single passthrough entry for a stereo file", async () => {
    execFileAsyncMock.mockResolvedValueOnce(ffprobeResult(2));

    const result = await extractChannels("/audio/service.wav");

    expect(result).toEqual([{ index: 0, name: "CH01", tmpPath: "/audio/service.wav", needsCleanup: false }]);
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("honors names[0] for mono/stereo passthrough", async () => {
    execFileAsyncMock.mockResolvedValueOnce(ffprobeResult(1));

    const result = await extractChannels("/audio/service.wav", ["Pastor Mic"]);

    expect(result[0].name).toBe("Pastor Mic");
  });

  it("splits a 4-channel file into four mono files via ffmpeg", async () => {
    execFileAsyncMock.mockResolvedValueOnce(ffprobeResult(4));
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await extractChannels("/audio/service.wav");

    expect(result).toHaveLength(4);
    expect(result.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(result.map((c) => c.name)).toEqual(["CH01", "CH02", "CH03", "CH04"]);
    expect(result.every((c) => c.needsCleanup === true)).toBe(true);

    const prefixDir = tmpdir();
    const prefixes = new Set<string>();
    for (const c of result) {
      expect(c.tmpPath.startsWith(join(prefixDir, "sb-"))).toBe(true);
      const match = c.tmpPath.match(/^(.*sb-[0-9a-f]{12})-ch(\d)\.wav$/);
      expect(match).not.toBeNull();
      prefixes.add(match![1]);
    }
    expect(prefixes.size).toBe(1);

    expect(execFileAsyncMock).toHaveBeenCalledTimes(5);
    expect(execFileAsyncMock.mock.calls[0]).toEqual([
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", "/audio/service.wav"],
      { encoding: "utf8" },
    ]);
    for (let i = 0; i < 4; i++) {
      expect(execFileAsyncMock.mock.calls[i + 1]).toEqual([
        "ffmpeg",
        ["-i", "/audio/service.wav", "-filter:a", `pan=mono|c0=c${i + 1}`, "-y", result[i].tmpPath],
      ]);
    }
  });

  it("falls back to default names for unspecified channels", async () => {
    execFileAsyncMock.mockResolvedValueOnce(ffprobeResult(3));
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await extractChannels("/audio/service.wav", ["Kick", "Snare"]);

    expect(result.map((c) => c.name)).toEqual(["Kick", "Snare", "CH03"]);
  });

  it("throws when no audio stream is present", async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }),
      stderr: "",
    });

    await expect(extractChannels("/audio/service.mp4")).rejects.toThrow(
      'No audio stream found in "/audio/service.mp4"',
    );
  });

  it("throws when the streams array is missing", async () => {
    execFileAsyncMock.mockResolvedValueOnce({ stdout: "{}", stderr: "" });

    await expect(extractChannels("/audio/service.mp4")).rejects.toThrow(
      'No audio stream found in "/audio/service.mp4"',
    );
  });

  it("defaults to mono when the channels field is missing", async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ streams: [{ codec_type: "audio" }] }),
      stderr: "",
    });

    const result = await extractChannels("/audio/service.wav");

    expect(result).toEqual([{ index: 0, name: "CH01", tmpPath: "/audio/service.wav", needsCleanup: false }]);
  });

  it("picks the audio stream, skipping earlier non-audio streams", async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ streams: [{ codec_type: "video" }, { codec_type: "audio", channels: 2 }] }),
      stderr: "",
    });

    const result = await extractChannels("/audio/service.wav");

    expect(result).toEqual([{ index: 0, name: "CH01", tmpPath: "/audio/service.wav", needsCleanup: false }]);
  });
});

describe("loadChannelFiles", () => {
  it("filters to audio extensions, sorts, and maps to channel files", async () => {
    readdirSyncMock.mockReturnValue(["b.wav", "notes.txt", "a.flac", "cover.jpg"]);

    const result = await loadChannelFiles("/audio/dir");

    expect(result).toEqual([
      { index: 0, name: "CH01", tmpPath: join("/audio/dir", "a.flac"), needsCleanup: false },
      { index: 1, name: "CH02", tmpPath: join("/audio/dir", "b.wav"), needsCleanup: false },
    ]);
    expect(readdirSyncMock).toHaveBeenCalledWith("/audio/dir");
  });

  it("matches extensions case-insensitively", async () => {
    readdirSyncMock.mockReturnValue(["LOUD.WAV", "Mix.Aiff"]);

    const result = await loadChannelFiles("/audio/dir");

    expect(result).toHaveLength(2);
  });

  it("honors provided names with a default fallback", async () => {
    readdirSyncMock.mockReturnValue(["a.wav", "b.wav", "c.wav"]);

    const result = await loadChannelFiles("/audio/dir", ["Kick"]);

    expect(result.map((c) => c.name)).toEqual(["Kick", "CH02", "CH03"]);
  });

  it("returns an empty array for an empty directory", async () => {
    readdirSyncMock.mockReturnValue([]);

    const result = await loadChannelFiles("/audio/dir");

    expect(result).toEqual([]);
  });

  it("accepts every supported extension", async () => {
    readdirSyncMock.mockReturnValue(["a.wav", "b.aif", "c.aiff", "d.flac", "e.mp3"]);

    const result = await loadChannelFiles("/audio/dir");

    expect(result).toHaveLength(5);
  });
});
