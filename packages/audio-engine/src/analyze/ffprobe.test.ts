import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileAsyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: execFileAsyncMock,
  }),
}));

import { runFfprobe } from "./ffprobe.js";

function stdoutOf(raw: unknown): { stdout: string; stderr: string } {
  return { stdout: JSON.stringify(raw), stderr: "" };
}

beforeEach(() => {
  execFileAsyncMock.mockReset();
});

describe("runFfprobe", () => {
  it("parses a full-fields happy path", async () => {
    execFileAsyncMock.mockResolvedValueOnce(
      stdoutOf({
        streams: [
          {
            codec_type: "audio",
            codec_name: "pcm_s16le",
            codec_long_name: "PCM signed 16-bit little-endian",
            channels: 2,
            channel_layout: "stereo",
            sample_rate: "48000",
            bits_per_raw_sample: "16",
            bit_rate: "1536000",
            duration: "12.5",
          },
        ],
        format: {
          filename: "/audio/take.wav",
          format_name: "wav",
          format_long_name: "WAV / WAVE",
          duration: "12.5",
          size: "1200000",
          bit_rate: "1536000",
          tags: { artist: "Sound Buddy" },
        },
      }),
    );

    const result = await runFfprobe("/audio/take.wav");

    expect(result.stream).toEqual({
      codecName: "pcm_s16le",
      codecLongName: "PCM signed 16-bit little-endian",
      channels: 2,
      channelLayout: "stereo",
      sampleRate: 48000,
      bitDepth: 16,
      bitRate: 1536000,
      durationSeconds: 12.5,
    });
    expect(result.format).toEqual({
      filename: "/audio/take.wav",
      formatName: "wav",
      formatLongName: "WAV / WAVE",
      durationSeconds: 12.5,
      sizeBytes: 1200000,
      bitRate: 1536000,
      tags: { artist: "Sound Buddy" },
    });
  });

  it("throws when there is no audio stream", async () => {
    execFileAsyncMock.mockResolvedValueOnce(
      stdoutOf({ streams: [{ codec_type: "video" }], format: {} }),
    );

    await expect(runFfprobe("/audio/no-audio.mp4")).rejects.toThrow(/no audio stream/);
  });

  it("falls back to bits_per_sample when bits_per_raw_sample is invalid/<=0", async () => {
    execFileAsyncMock.mockResolvedValueOnce(
      stdoutOf({
        streams: [
          { codec_type: "audio", channels: 2, bits_per_raw_sample: "0", bits_per_sample: 24 },
        ],
        format: {},
      }),
    );

    const result = await runFfprobe("/audio/take.wav");
    expect(result.stream.bitDepth).toBe(24);
  });

  it("falls back to bits_per_sample when bits_per_raw_sample is non-numeric", async () => {
    execFileAsyncMock.mockResolvedValueOnce(
      stdoutOf({
        streams: [
          { codec_type: "audio", channels: 2, bits_per_raw_sample: "not-a-number", bits_per_sample: 24 },
        ],
        format: {},
      }),
    );

    const result = await runFfprobe("/audio/take.wav");
    expect(result.stream.bitDepth).toBe(24);
  });

  it("reports bitDepth: null when both bit-depth fields are missing", async () => {
    execFileAsyncMock.mockResolvedValueOnce(
      stdoutOf({ streams: [{ codec_type: "audio", channels: 2 }], format: {} }),
    );

    const result = await runFfprobe("/audio/take.wav");
    expect(result.stream.bitDepth).toBeNull();
  });

  it('labels a stereo stream with no channel_layout as "unknown"', async () => {
    execFileAsyncMock.mockResolvedValueOnce(
      stdoutOf({ streams: [{ codec_type: "audio", channels: 2 }], format: {} }),
    );

    const result = await runFfprobe("/audio/take.wav");
    expect(result.stream.channelLayout).toBe("unknown");
  });

  it('labels a mono stream with no channel_layout as "mono"', async () => {
    execFileAsyncMock.mockResolvedValueOnce(
      stdoutOf({ streams: [{ codec_type: "audio", channels: 1 }], format: {} }),
    );

    const result = await runFfprobe("/audio/take.wav");
    expect(result.stream.channelLayout).toBe("mono");
  });

  it("nulls bit_rate/duration and zeros format.size when missing", async () => {
    execFileAsyncMock.mockResolvedValueOnce(
      stdoutOf({ streams: [{ codec_type: "audio", channels: 1 }], format: {} }),
    );

    const result = await runFfprobe("/audio/take.wav");
    expect(result.stream.bitRate).toBeNull();
    expect(result.stream.durationSeconds).toBeNull();
    expect(result.format.sizeBytes).toBe(0);
    expect(result.format.bitRate).toBe(0);
    expect(result.format.durationSeconds).toBe(0);
  });
});
