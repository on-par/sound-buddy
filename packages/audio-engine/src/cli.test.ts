import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import type { AudioAnalysis, ChannelFile, ChannelAnalysis } from "./types.js";

vi.mock("./analyze/index.js", () => ({ analyzeAudio: vi.fn() }));
vi.mock("./analyze/channels.js", () => ({ extractChannels: vi.fn(), loadChannelFiles: vi.fn() }));
vi.mock("./analyze/compare.js", () => ({ compareChannels: vi.fn() }));
vi.mock("./report.js", () => ({
  buildReport: vi.fn(),
  buildSummaryTable: vi.fn(),
  formatMultiChannelReport: vi.fn(),
}));
vi.mock("./engineer.js", () => ({
  getEngineerRead: vi.fn(),
  analyzeMultiChannel: vi.fn(),
  analyzeWithOllama: vi.fn(),
}));
vi.mock("./stream/index.js", () => ({ startLive: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(), rmSync: vi.fn() };
});

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { analyzeAudio } from "./analyze/index.js";
import { extractChannels, loadChannelFiles } from "./analyze/channels.js";
import { compareChannels } from "./analyze/compare.js";
import { buildReport, buildSummaryTable, formatMultiChannelReport } from "./report.js";
import { getEngineerRead, analyzeMultiChannel, analyzeWithOllama } from "./engineer.js";
import { startLive } from "./stream/index.js";
import {
  parseArgs,
  printHelp,
  analyzeChannelSafe,
  printChannelTable,
  runListDevices,
  runSingleFile,
  runDirectory,
  main,
  isMainModule,
  logLlmFailure,
} from "./cli.js";
import { cleanupChannelFiles } from "./index.js";

const mockAnalysis: AudioAnalysis = {
  filePath: "/tmp/mix.wav",
  sox: {
    samplesRead: 44100,
    lengthSeconds: 1.0,
    scaledBy: 2147483647,
    maximumAmplitude: 0.8,
    minimumAmplitude: -0.8,
    midlineAmplitude: 0.0,
    meanNorm: 0.3,
    meanAmplitude: 0.0,
    rmsAmplitude: 0.35,
    maximumDelta: 0.1,
    minimumDelta: 0.0,
    meanDelta: 0.05,
    rmsDelta: 0.06,
    roughFrequency: 220,
    volumeAdjustment: 3.1,
    rmsDbfs: -9.11,
    peakDbfs: -1.94,
    dynamicRangeDb: 7.17,
    clipping: false,
  },
  ffprobe: {
    format: {
      filename: "/tmp/mix.wav",
      formatName: "wav",
      formatLongName: "WAV / WAVE (Waveform Audio)",
      durationSeconds: 1.0,
      sizeBytes: 88244,
      bitRate: 705920,
      tags: {},
    },
    stream: {
      codecName: "pcm_s16le",
      codecLongName: "PCM signed 16-bit little-endian",
      channels: 2,
      channelLayout: "stereo",
      sampleRate: 44100,
      bitDepth: 16,
      bitRate: null,
      durationSeconds: 1.0,
    },
  },
  spectrum: {
    bands: { subBass: 0.05, bass: 0.12, lowMid: 0.08, mid: 0.45, highMid: 0.2, presence: 0.07, brilliance: 0.03 },
    spectralCentroid: 1800,
    spectralRolloff85: 4500,
    dynamicRange: 7.17,
    curve: { freqs: [20, 200, 2000, 20000], db: [-30, -18, -16, -35] },
    frames: [
      { t: 0.0, db: [-32, -20, -18, -36], rms: -18.2, class: "music" },
      { t: 0.5, db: [-28, -16, -14, -34], rms: -14.1, class: "music" },
    ],
    contentType: "speech",
    segments: [
      { class: "speech", start: 0, end: 0.6 },
      { class: "music", start: 0.6, end: 1.0 },
    ],
  },
  loudness: null,
};

function withChannels(channels: number): AudioAnalysis {
  return { ...mockAnalysis, ffprobe: { ...mockAnalysis.ffprobe, stream: { ...mockAnalysis.ffprobe.stream, channels } } };
}

function chFile(i: number, name: string, needsCleanup = true): ChannelFile {
  return { index: i, name, tmpPath: `/tmp/ch${i}.wav`, needsCleanup };
}

function chAnalysis(name: string, analysis: AudioAnalysis = mockAnalysis): ChannelAnalysis {
  return { channel: chFile(0, name), analysis };
}

function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough };
  child.stdout = new PassThrough();
  return child;
}

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function out(): string {
  return logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}
function warnOut(): string {
  return warnSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}
function errOut(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

beforeEach(() => {
  vi.resetAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);

  vi.mocked(analyzeAudio).mockResolvedValue(mockAnalysis);
  vi.mocked(compareChannels).mockReturnValue({
    bandRankings: {},
    maskingPairs: [],
    subBassOffenders: [],
    mixBandEnergy: {},
  } as never);
  vi.mocked(buildSummaryTable).mockReturnValue("SUMMARY-TABLE");
  vi.mocked(buildReport).mockReturnValue("REPORT-TEXT");
  vi.mocked(formatMultiChannelReport).mockReturnValue("MULTI-REPORT");
  vi.mocked(getEngineerRead).mockResolvedValue(undefined);
  vi.mocked(analyzeMultiChannel).mockResolvedValue(undefined);
  vi.mocked(analyzeWithOllama).mockResolvedValue(undefined);
  vi.mocked(existsSync).mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("returns full defaults with no args", () => {
    expect(parseArgs(["node", "sound-buddy"])).toEqual({
      file: null,
      dir: null,
      names: [],
      noSpectrum: false,
      help: false,
      live: false,
      listDevices: false,
      device: undefined,
      channels: undefined,
      windowSecs: 3,
      llmIntervalSecs: 60,
      ollama: false,
      ollamaModel: "llama3.2",
      ollamaHost: "http://localhost:11434",
    });
  });

  it("--help sets help: true", () => {
    expect(parseArgs(["node", "sound-buddy", "--help"]).help).toBe(true);
  });

  it("-h sets help: true", () => {
    expect(parseArgs(["node", "sound-buddy", "-h"]).help).toBe(true);
  });

  it("bare positional sets file", () => {
    expect(parseArgs(["node", "sound-buddy", "mix.wav"]).file).toBe("mix.wav");
  });

  it("--dir sets dir", () => {
    expect(parseArgs(["node", "sound-buddy", "--dir", "./session"]).dir).toBe("./session");
  });

  it("trailing --dir with no value leaves dir null", () => {
    expect(parseArgs(["node", "sound-buddy", "--dir"]).dir).toBeNull();
  });

  it("--names splits and trims", () => {
    expect(parseArgs(["node", "sound-buddy", "--names", "Kick, Snare ,HH"]).names).toEqual([
      "Kick",
      "Snare",
      "HH",
    ]);
  });

  it("trailing --names with no value leaves names empty", () => {
    expect(parseArgs(["node", "sound-buddy", "--names"]).names).toEqual([]);
  });

  it("--no-spectrum sets noSpectrum: true", () => {
    expect(parseArgs(["node", "sound-buddy", "--no-spectrum"]).noSpectrum).toBe(true);
  });

  it("--live sets live: true", () => {
    expect(parseArgs(["node", "sound-buddy", "--live"]).live).toBe(true);
  });

  it("--list-devices sets listDevices: true", () => {
    expect(parseArgs(["node", "sound-buddy", "--list-devices"]).listDevices).toBe(true);
  });

  it("--device sets device", () => {
    expect(parseArgs(["node", "sound-buddy", "--device", "DANTE Virtual Soundcard"]).device).toBe(
      "DANTE Virtual Soundcard"
    );
  });

  it("--ch parses a comma list of channel indices", () => {
    expect(parseArgs(["node", "sound-buddy", "--ch", "0, 1,2"]).channels).toEqual([0, 1, 2]);
  });

  it("--window sets windowSecs", () => {
    expect(parseArgs(["node", "sound-buddy", "--window", "2.5"]).windowSecs).toBe(2.5);
  });

  it("--llm-interval sets llmIntervalSecs", () => {
    expect(parseArgs(["node", "sound-buddy", "--llm-interval", "30"]).llmIntervalSecs).toBe(30);
  });

  it("--ollama sets ollama: true", () => {
    expect(parseArgs(["node", "sound-buddy", "--ollama"]).ollama).toBe(true);
  });

  it("--ollama-model sets ollamaModel", () => {
    expect(parseArgs(["node", "sound-buddy", "--ollama-model", "mistral"]).ollamaModel).toBe("mistral");
  });

  it("trailing --ollama-model keeps the default", () => {
    expect(parseArgs(["node", "sound-buddy", "--ollama-model"]).ollamaModel).toBe("llama3.2");
  });

  it("--ollama-host sets ollamaHost", () => {
    expect(parseArgs(["node", "sound-buddy", "--ollama-host", "http://x:1"]).ollamaHost).toBe("http://x:1");
  });

  it("trailing --ollama-host keeps the default", () => {
    expect(parseArgs(["node", "sound-buddy", "--ollama-host"]).ollamaHost).toBe("http://localhost:11434");
  });

  it("ignores an unknown flag", () => {
    const opts = parseArgs(["node", "sound-buddy", "--bogus"]);
    expect(opts.file).toBeNull();
  });

  it("parses a kitchen-sink combo of file + flags together", () => {
    const opts = parseArgs([
      "node",
      "sound-buddy",
      "mix.wav",
      "--no-spectrum",
      "--ollama",
      "--ollama-model",
      "mistral",
      "--window",
      "4",
    ]);
    expect(opts).toMatchObject({
      file: "mix.wav",
      noSpectrum: true,
      ollama: true,
      ollamaModel: "mistral",
      windowSecs: 4,
    });
  });
});

describe("printHelp", () => {
  it("prints usage and flag documentation", () => {
    printHelp();
    const text = out();
    expect(text).toContain("Usage:");
    expect(text).toContain("--dir");
    expect(text).toContain("--live");
    expect(text).toContain("--list-devices");
    expect(text).toContain("--names");
    expect(text).toContain("--no-spectrum");
    expect(text).toContain("--ollama-model");
    expect(text).toContain("--llm-interval");
    expect(text).toContain("--help");
  });
});

describe("cleanupChannelFiles", () => {
  it("removes only files that need cleanup", () => {
    const files = [chFile(0, "A", true), chFile(1, "B", false), chFile(2, "C", true)];
    cleanupChannelFiles(files);
    expect(rmSync).toHaveBeenCalledTimes(2);
    expect(rmSync).toHaveBeenCalledWith("/tmp/ch0.wav");
    expect(rmSync).toHaveBeenCalledWith("/tmp/ch2.wav");
    expect(rmSync).not.toHaveBeenCalledWith("/tmp/ch1.wav");
  });

  it("does not throw when rmSync throws, and still attempts every needsCleanup file", () => {
    vi.mocked(rmSync).mockImplementation(() => {
      throw new Error("EPERM");
    });
    const files = [chFile(0, "A", true), chFile(1, "B", true)];
    expect(() => cleanupChannelFiles(files)).not.toThrow();
    expect(rmSync).toHaveBeenCalledTimes(2);
  });
});

describe("analyzeChannelSafe", () => {
  it("returns the channel analysis when analyzeAudio resolves", async () => {
    const ch = chFile(0, "Kick");
    const result = await analyzeChannelSafe(ch);
    expect(result).toEqual({ channel: ch, analysis: mockAnalysis });
    expect(analyzeAudio).toHaveBeenCalledWith(ch.tmpPath);
  });

  it("returns null and warns when analyzeAudio rejects", async () => {
    const ch = chFile(0, "Kick");
    vi.mocked(analyzeAudio).mockRejectedValue(new Error("boom"));
    const result = await analyzeChannelSafe(ch);
    expect(result).toBeNull();
    expect(warnOut()).toContain("Kick");
    expect(warnOut()).toContain(ch.tmpPath);
  });
});

describe("printChannelTable", () => {
  it("prints header, separator, and one data row for a single channel", () => {
    printChannelTable([chAnalysis("Kick")]);
    const text = out();
    expect(text).toContain("Channel");
    expect(text).toContain("RMS dBFS");
    expect(text).toContain("Peak dBFS");
    expect(text).toContain("Dyn Range");
    expect(text).toContain("Dominant Band");
    expect(text).toMatch(/-{5,}/);
    expect(text).toContain("-9.11 dBFS");
    expect(text).toContain("-1.94 dBFS");
    expect(text).toContain("7.17 dB");
    expect(text).toContain("Mid");
  });

  it("prints one row per channel for 2 channels", () => {
    printChannelTable([chAnalysis("A"), chAnalysis("B")]);
    const text = out();
    expect(text).toContain("A");
    expect(text).toContain("B");
  });

  it("prints one row per channel for 8 channels", () => {
    const chans = Array.from({ length: 8 }, (_, i) => chAnalysis(`CH${i + 1}`));
    printChannelTable(chans);
    const text = out();
    for (let i = 1; i <= 8; i++) {
      expect(text).toContain(`CH${i}`);
    }
  });

  it("pads the name column to fit a name longer than 10 chars", () => {
    printChannelTable([chAnalysis("Overhead Left Extra")]);
    expect(out()).toContain("Overhead Left Extra");
  });

  it("shows -inf dBFS for -Infinity rms/peak", () => {
    const analysis: AudioAnalysis = {
      ...mockAnalysis,
      sox: { ...mockAnalysis.sox, rmsDbfs: -Infinity, peakDbfs: -Infinity },
    };
    printChannelTable([chAnalysis("Kick", analysis)]);
    const matches = out().match(/-inf dBFS/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("maps highMid to the High-mid label", () => {
    const analysis: AudioAnalysis = {
      ...mockAnalysis,
      spectrum: {
        ...mockAnalysis.spectrum,
        bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 9, presence: 0, brilliance: 0 },
      },
    };
    printChannelTable([chAnalysis("Kick", analysis)]);
    expect(out()).toContain("High-mid");
  });

  it("falls back to the raw key for an unknown dominant band", () => {
    const analysis: AudioAnalysis = {
      ...mockAnalysis,
      spectrum: {
        ...mockAnalysis.spectrum,
        bands: { ...mockAnalysis.spectrum.bands, weird: 9 } as never,
      },
    };
    printChannelTable([chAnalysis("Kick", analysis)]);
    expect(out()).toContain("weird");
  });
});

describe("runListDevices", () => {
  it("spawns python3 with the stream script and --list-devices", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = runListDevices();
    child.stdout.emit("data", Buffer.from(JSON.stringify({ devices: [] })));
    child.emit("close", 0);
    await p;
    expect(spawn).toHaveBeenCalledWith(
      "python3",
      [expect.stringContaining("stream.py"), "--list-devices"],
      { stdio: ["ignore", "pipe", "inherit"] }
    );
  });

  it("resolves and prints a device table for two devices", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = runListDevices();
    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          devices: [
            { index: 0, name: "MacBook Pro Microphone", channels: 1, default_sr: 48000 },
            { index: 1, name: "DANTE Virtual Soundcard", channels: 32, default_sr: 48000 },
          ],
        })
      )
    );
    child.emit("close", 0);
    await expect(p).resolves.toBeUndefined();
    const text = out();
    expect(text).toContain("IDX");
    expect(text).toContain("NAME");
    expect(text).toContain("CHANNELS");
    expect(text).toContain("SAMPLE RATE");
    expect(text).toContain("MacBook Pro Microphone");
    expect(text).toContain("DANTE Virtual Soundcard");
    expect(text).toContain("48000 Hz");
  });

  it("prints 'No input devices found.' for an empty devices array", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = runListDevices();
    child.stdout.emit("data", Buffer.from(JSON.stringify({ devices: [] })));
    child.emit("close", 0);
    await expect(p).resolves.toBeUndefined();
    expect(out()).toContain("No input devices found.");
  });

  it("prints 'No input devices found.' when the devices key is absent", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = runListDevices();
    child.stdout.emit("data", Buffer.from(JSON.stringify({})));
    child.emit("close", 0);
    await expect(p).resolves.toBeUndefined();
    expect(out()).toContain("No input devices found.");
  });

  it("rejects when the process exits non-zero", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = runListDevices();
    child.emit("close", 1);
    await expect(p).rejects.toThrow(/exited with code 1/);
  });

  it("rejects when stdout is not valid JSON", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = runListDevices();
    child.stdout.emit("data", Buffer.from("not json"));
    child.emit("close", 0);
    await expect(p).rejects.toThrow(/Failed to parse device list/);
  });

  it("accumulates output split across multiple data chunks", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = runListDevices();
    const json = JSON.stringify({ devices: [{ index: 0, name: "Mic", channels: 1, default_sr: 48000 }] });
    const mid = Math.floor(json.length / 2);
    child.stdout.emit("data", Buffer.from(json.slice(0, mid)));
    child.stdout.emit("data", Buffer.from(json.slice(mid)));
    child.emit("close", 0);
    await expect(p).resolves.toBeUndefined();
    expect(out()).toContain("Mic");
  });
});

describe("runSingleFile", () => {
  it("stereo happy path prints measurements and the engineer's read via getEngineerRead", async () => {
    await runSingleFile("/tmp/mix.wav", [], false, "llama3.2", "http://localhost:11434");
    const text = out();
    expect(text).toContain("=== Raw Measurements ===");
    expect(text).toContain("SUMMARY-TABLE");
    expect(text).toContain("Audio Engineer's Read");
    expect(getEngineerRead).toHaveBeenCalledWith("REPORT-TEXT");
    expect(analyzeWithOllama).not.toHaveBeenCalled();
  });

  it("stereo + ollama uses analyzeWithOllama instead of getEngineerRead", async () => {
    await runSingleFile("/tmp/mix.wav", [], true, "mistral", "http://host:1");
    expect(analyzeWithOllama).toHaveBeenCalledWith(
      "REPORT-TEXT",
      expect.any(String),
      "mistral",
      "http://host:1"
    );
    expect(getEngineerRead).not.toHaveBeenCalled();
  });

  it("exits 1 and logs the LLM failure when getEngineerRead rejects", async () => {
    const boom = new Error("boom");
    vi.mocked(getEngineerRead).mockRejectedValue(boom);
    await expect(
      runSingleFile("/tmp/mix.wav", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    expect(errOut()).toContain("LLM analysis failed:");
    const detailArg = errorSpy.mock.calls.find((c: unknown[]) => String(c[0]).includes("LLM analysis failed:"))?.[1];
    expect(detailArg).toBe(JSON.stringify(boom.stack));
  });

  it("logLlmFailure handles a non-Error value", () => {
    logLlmFailure("plain string");
    expect(errOut()).toContain(JSON.stringify("plain string"));
  });

  it.each([
    ["spawn sox ENOENT", "brew install sox"],
    ["spawn ffprobe ENOENT", "brew install ffmpeg"],
    ["spawn python3 ENOENT", "pip install librosa numpy"],
    ["bad wav", "Analysis failed:"],
  ])("maps analyzeAudio error %j to a message containing %j", async (errMessage, expectedText) => {
    vi.mocked(analyzeAudio).mockRejectedValue(new Error(errMessage));
    await expect(
      runSingleFile("/tmp/mix.wav", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    expect(errOut()).toContain(expectedText);
  });

  it("multichannel happy path runs per-channel analysis and the multi-channel read", async () => {
    vi.mocked(analyzeAudio).mockResolvedValueOnce(withChannels(8)).mockResolvedValue(withChannels(1));
    const channelFiles = Array.from({ length: 8 }, (_, i) => chFile(i, `CH${i + 1}`));
    vi.mocked(extractChannels).mockResolvedValue(channelFiles);

    await runSingleFile("/tmp/session.wav", [], false, "llama3.2", "http://localhost:11434");

    const text = out();
    expect(text).toContain("Detected 8 channels");
    for (let i = 1; i <= 8; i++) expect(text).toContain(`CH${i}`);
    expect(text).toContain("MULTI-REPORT");
    expect(text).toContain("Multi-Channel Engineer's Read");
    expect(analyzeMultiChannel).toHaveBeenCalledWith(
      expect.objectContaining({ ffprobe: expect.objectContaining({ stream: expect.objectContaining({ channels: 8 }) }) }),
      expect.any(Array),
      expect.any(Object)
    );
    expect(rmSync).toHaveBeenCalledTimes(8);
    expect(extractChannels).toHaveBeenCalledWith("/tmp/session.wav", []);
  });

  it("multichannel + ollama uses analyzeWithOllama instead of analyzeMultiChannel", async () => {
    vi.mocked(analyzeAudio).mockResolvedValueOnce(withChannels(8)).mockResolvedValue(withChannels(1));
    const channelFiles = Array.from({ length: 8 }, (_, i) => chFile(i, `CH${i + 1}`));
    vi.mocked(extractChannels).mockResolvedValue(channelFiles);

    await runSingleFile("/tmp/session.wav", [], true, "mistral", "http://host:1");

    expect(analyzeWithOllama).toHaveBeenCalledWith("MULTI-REPORT", expect.any(String), "mistral", "http://host:1");
    expect(analyzeMultiChannel).not.toHaveBeenCalled();
  });

  it("maps an ffmpeg ENOENT extractChannels error to brew install ffmpeg and exits", async () => {
    vi.mocked(analyzeAudio).mockResolvedValueOnce(withChannels(8)).mockResolvedValue(withChannels(1));
    vi.mocked(extractChannels).mockRejectedValue(new Error("spawn ffmpeg ENOENT"));

    await expect(
      runSingleFile("/tmp/session.wav", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    expect(errOut()).toContain("brew install ffmpeg");
  });

  it("maps a generic extractChannels error to Failed to extract channels: and exits", async () => {
    vi.mocked(analyzeAudio).mockResolvedValueOnce(withChannels(8)).mockResolvedValue(withChannels(1));
    vi.mocked(extractChannels).mockRejectedValue(new Error("permission denied"));

    await expect(
      runSingleFile("/tmp/session.wav", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    expect(errOut()).toContain("Failed to extract channels:");
  });

  it("exits 1 when all channel analyses fail, but still cleans up", async () => {
    vi.mocked(analyzeAudio).mockResolvedValueOnce(withChannels(8)).mockRejectedValue(new Error("nope"));
    const channelFiles = Array.from({ length: 8 }, (_, i) => chFile(i, `CH${i + 1}`));
    vi.mocked(extractChannels).mockResolvedValue(channelFiles);

    await expect(
      runSingleFile("/tmp/session.wav", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    expect(errOut()).toContain("All channel analyses failed.");
    expect(rmSync).toHaveBeenCalledTimes(8);
  });

  it("catches a multichannel LLM failure without exiting, and still cleans up", async () => {
    vi.mocked(analyzeAudio).mockResolvedValueOnce(withChannels(8)).mockResolvedValue(withChannels(1));
    const channelFiles = Array.from({ length: 8 }, (_, i) => chFile(i, `CH${i + 1}`));
    vi.mocked(extractChannels).mockResolvedValue(channelFiles);
    vi.mocked(analyzeMultiChannel).mockRejectedValue(new Error("llm down"));

    await expect(
      runSingleFile("/tmp/session.wav", [], false, "llama3.2", "http://localhost:11434")
    ).resolves.toBeUndefined();
    expect(errOut()).toContain("LLM analysis failed:");
    expect(rmSync).toHaveBeenCalledTimes(8);
  });
});

describe("runDirectory", () => {
  it("exits 1 when the directory does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    await expect(
      runDirectory("./missing", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    expect(errOut()).toContain("Directory not found");
  });

  it("exits 1 when loadChannelFiles rejects", async () => {
    vi.mocked(loadChannelFiles).mockRejectedValue(new Error("EACCES"));
    await expect(
      runDirectory("./session", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    expect(errOut()).toContain("Failed to read directory:");
  });

  it("exits 1 when loadChannelFiles resolves empty", async () => {
    vi.mocked(loadChannelFiles).mockResolvedValue([]);
    await expect(
      runDirectory("./session", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    const text = errOut();
    expect(text).toContain("No audio files found");
    expect(text).toContain("Supported formats");
  });

  it("happy path with 2 files prints tables and the multi-channel report", async () => {
    const files = [chFile(0, "kick.wav", false), chFile(1, "snare.wav", false)];
    vi.mocked(loadChannelFiles).mockResolvedValue(files);
    vi.mocked(analyzeAudio).mockResolvedValue(withChannels(1));

    await runDirectory("./session", [], false, "llama3.2", "http://localhost:11434");

    const text = out();
    expect(text).toContain("Found 2 audio files");
    expect(text).toContain("kick.wav");
    expect(text).toContain("snare.wav");
    expect(text).toContain("MULTI-REPORT");
    expect(analyzeMultiChannel).toHaveBeenCalledWith(null, expect.any(Array), expect.any(Object));
    expect(loadChannelFiles).toHaveBeenCalledWith(expect.stringContaining("session"), []);
  });

  it("ollama: true uses analyzeWithOllama", async () => {
    const files = [chFile(0, "kick.wav", false), chFile(1, "snare.wav", false)];
    vi.mocked(loadChannelFiles).mockResolvedValue(files);
    vi.mocked(analyzeAudio).mockResolvedValue(withChannels(1));

    await runDirectory("./session", [], true, "mistral", "http://host:1");

    expect(analyzeWithOllama).toHaveBeenCalledWith("MULTI-REPORT", expect.any(String), "mistral", "http://host:1");
  });

  it("exits 1 when all channel analyses fail", async () => {
    const files = [chFile(0, "kick.wav", false), chFile(1, "snare.wav", false)];
    vi.mocked(loadChannelFiles).mockResolvedValue(files);
    vi.mocked(analyzeAudio).mockRejectedValue(new Error("nope"));

    await expect(
      runDirectory("./session", [], false, "llama3.2", "http://localhost:11434")
    ).rejects.toThrow("exit:1");
    expect(errOut()).toContain("All channel analyses failed.");
  });

  it("catches an LLM failure without exiting", async () => {
    const files = [chFile(0, "kick.wav", false), chFile(1, "snare.wav", false)];
    vi.mocked(loadChannelFiles).mockResolvedValue(files);
    vi.mocked(analyzeAudio).mockResolvedValue(withChannels(1));
    vi.mocked(analyzeMultiChannel).mockRejectedValue(new Error("llm down"));

    await expect(
      runDirectory("./session", [], false, "llama3.2", "http://localhost:11434")
    ).resolves.toBeUndefined();
    expect(errOut()).toContain("LLM analysis failed:");
  });
});

describe("main", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("--help prints help and exits 0", async () => {
    process.argv = ["node", "sound-buddy", "--help"];
    await expect(main()).rejects.toThrow("exit:0");
    expect(out()).toContain("Usage:");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("--list-devices runs the device listing flow", async () => {
    process.argv = ["node", "sound-buddy", "--list-devices"];
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = main();
    child.stdout.emit("data", Buffer.from(JSON.stringify({ devices: [] })));
    child.emit("close", 0);
    await expect(p).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledWith(
      "python3",
      [expect.stringContaining("stream.py"), "--list-devices"],
      { stdio: ["ignore", "pipe", "inherit"] }
    );
  });

  it("--live calls startLive with parsed options", async () => {
    process.argv = ["node", "sound-buddy", "--live", "--device", "X", "--ch", "0,1", "--window", "2", "--llm-interval", "5"];
    vi.mocked(startLive).mockResolvedValue(undefined);
    await expect(main()).resolves.toBeUndefined();
    expect(startLive).toHaveBeenCalledWith({
      device: "X",
      channels: [0, 1],
      windowSecs: 2,
      llmIntervalSecs: 5,
    });
  });

  it("exits 1 with usage text when no file and no dir are given", async () => {
    process.argv = ["node", "sound-buddy"];
    await expect(main()).rejects.toThrow("exit:1");
    const text = errOut();
    expect(text).toContain("Usage: sound-buddy <file>");
    expect(text).toContain("--help");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("--dir runs the directory flow", async () => {
    process.argv = ["node", "sound-buddy", "--dir", "./session"];
    const files = [chFile(0, "kick.wav", false), chFile(1, "snare.wav", false)];
    vi.mocked(loadChannelFiles).mockResolvedValue(files);
    vi.mocked(analyzeAudio).mockResolvedValue(withChannels(1));

    await expect(main()).resolves.toBeUndefined();
    expect(loadChannelFiles).toHaveBeenCalled();
  });

  it("positional file with existsSync true runs the single-file flow", async () => {
    process.argv = ["node", "sound-buddy", "mix.wav"];
    vi.mocked(existsSync).mockReturnValue(true);

    await expect(main()).resolves.toBeUndefined();
    expect(analyzeAudio).toHaveBeenCalledWith(expect.stringContaining("mix.wav"));
  });

  it("positional file with existsSync false exits 1", async () => {
    process.argv = ["node", "sound-buddy", "missing.wav"];
    vi.mocked(existsSync).mockReturnValue(false);

    await expect(main()).rejects.toThrow("exit:1");
    expect(errOut()).toContain("File not found");
  });
});

describe("isMainModule", () => {
  let originalArgv1: string | undefined;

  beforeEach(() => {
    originalArgv1 = process.argv[1];
  });

  afterEach(() => {
    process.argv[1] = originalArgv1 as string;
  });

  it("returns false when argv[1] is undefined", () => {
    process.argv[1] = undefined as never;
    expect(isMainModule()).toBe(false);
  });

  it("returns false when argv[1] does not resolve to a real path", () => {
    process.argv[1] = "/nonexistent/path/definitely-not-real";
    expect(isMainModule()).toBe(false);
  });

  it("returns false when argv[1] resolves to a real path that isn't index.ts", () => {
    process.argv[1] = fileURLToPath(import.meta.url);
    expect(isMainModule()).toBe(false);
  });
});
