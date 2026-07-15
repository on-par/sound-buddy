import { describe, it, expect, vi, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { isVideoFile, extractAudioToWav, VIDEO_EXTENSIONS } from "./extract.js";

const executeMock = vi.hoisted(() => vi.fn());
vi.mock("./timeout.js", async () => {
  const actual = await vi.importActual<typeof import("./timeout.js")>("./timeout.js");
  return {
    ...actual,
    execFileWithTimeout: executeMock,
    EXTRACT_TIMEOUT_MS: 300_000,
  };
});

beforeEach(() => {
  executeMock.mockClear();
});

describe("isVideoFile", () => {
  it("returns true for known video extensions", () => {
    expect(isVideoFile("/tmp/service.mp4")).toBe(true);
    expect(isVideoFile("/tmp/service.mov")).toBe(true);
    expect(isVideoFile("/tmp/service.m4v")).toBe(true);
    expect(isVideoFile("/tmp/service.mkv")).toBe(true);
    expect(isVideoFile("/tmp/service.webm")).toBe(true);
  });

  it("is case-insensitive on the extension", () => {
    expect(isVideoFile("/tmp/SERVICE.MP4")).toBe(true);
    expect(isVideoFile("/tmp/service.WebM")).toBe(true);
  });

  it("returns false for audio extensions", () => {
    expect(isVideoFile("/tmp/service.wav")).toBe(false);
    expect(isVideoFile("/tmp/service.mp3")).toBe(false);
    expect(isVideoFile("/tmp/service.flac")).toBe(false);
  });

  it("returns false for a file with no extension", () => {
    expect(isVideoFile("/tmp/service")).toBe(false);
  });

  it("exposes the full set of supported video extensions", () => {
    expect([...VIDEO_EXTENSIONS].sort()).toEqual([".m4v", ".mkv", ".mov", ".mp4", ".webm"]);
  });
});

describe("extractAudioToWav", () => {
  it("runs ffmpeg with the expected args and returns a .wav path under tmpDir", async () => {
    executeMock.mockResolvedValueOnce({ stdout: "", stderr: "" });

    const result = await extractAudioToWav("/recordings/service.mp4", { tmpDir: "/tmp/sb-test" });

    expect(result).toMatch(/^\/tmp\/sb-test\/sb-extract-[0-9a-f]{12}\.wav$/);
    const [bin, args, options, stage, timeoutMs] = executeMock.mock.calls[0];
    expect(bin).toBe("ffmpeg");
    expect(args).toEqual(["-i", "/recordings/service.mp4", "-vn", "-ac", "2", "-acodec", "pcm_s16le", "-y", result]);
    expect(options.encoding).toBe("utf8");
    expect(stage).toBe("ffmpeg extract");
    expect(timeoutMs).toBe(300_000);
  });

  it("uses the injected bin override", async () => {
    executeMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    await extractAudioToWav("/recordings/service.mp4", { bin: "/opt/sb/ffmpeg", tmpDir: "/tmp/sb-test" });
    expect(executeMock.mock.calls[0][0]).toBe("/opt/sb/ffmpeg");
  });

  it("passes the signal through to execFileWithTimeout", async () => {
    executeMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    const controller = new AbortController();
    await extractAudioToWav("/recordings/service.mp4", { signal: controller.signal, tmpDir: "/tmp/sb-test" });
    expect(executeMock.mock.calls[0][2].signal).toBe(controller.signal);
  });

  it("defaults tmpDir to the OS tmp dir when not provided", async () => {
    executeMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    const result = await extractAudioToWav("/recordings/service.mp4");
    expect(result.startsWith(tmpdir())).toBe(true);
  });

  it("throws an actionable error on ffmpeg failure", async () => {
    executeMock.mockRejectedValueOnce(new Error("ffmpeg: no such filter"));

    await expect(extractAudioToWav("/recordings/service.mp4", { tmpDir: "/tmp/sb-test" })).rejects.toThrow(
      /Could not extract an audio track from "service\.mp4" — make sure the video has sound, or export the audio as a WAV and analyze that instead/,
    );
  });

  it("rethrows a SubprocessTimeoutError as-is", async () => {
    const { SubprocessTimeoutError } = await import("./timeout.js");
    const timeoutErr = new SubprocessTimeoutError("ffmpeg extract", 300_000);
    executeMock.mockRejectedValueOnce(timeoutErr);

    await expect(extractAudioToWav("/recordings/service.mp4", { tmpDir: "/tmp/sb-test" })).rejects.toBe(timeoutErr);
  });

  it("rethrows an abort error as-is", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    executeMock.mockRejectedValueOnce(abortErr);

    await expect(extractAudioToWav("/recordings/service.mp4", { tmpDir: "/tmp/sb-test" })).rejects.toBe(abortErr);
  });
});
