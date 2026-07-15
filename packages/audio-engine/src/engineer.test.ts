import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { AudioAnalysis, ChannelAnalysis, ChannelComparison, FrequencyBands } from "./types.js";
import type { WindowData } from "./stream/types.js";
import type { NarrativePort, NarrativeResult } from "./narrative/port.js";
import { SYSTEM_PROMPT, MULTI_CHANNEL_SYSTEM_PROMPT } from "./prompts/index.js";

const { requestMock } = vi.hoisted(() => {
  const requestMock = vi.fn();
  return { requestMock };
});

vi.mock("http", () => ({
  request: requestMock,
  default: { request: requestMock },
}));

import {
  buildMultiChannelPrompt,
  getEngineerRead,
  analyzeMultiChannel,
  analyzeStream,
  analyzeWithOllama,
} from "./engineer.js";

type MakeAnalysisOpts = {
  bands?: Partial<FrequencyBands>;
  sox?: Partial<AudioAnalysis["sox"]>;
  spectrum?: Partial<Pick<AudioAnalysis["spectrum"], "spectralCentroid" | "spectralRolloff85">>;
};

function makeAnalysis(opts: MakeAnalysisOpts = {}): AudioAnalysis {
  const bands: FrequencyBands = {
    subBass: -30,
    bass: -12,
    lowMid: -14,
    mid: -10,
    highMid: -16,
    presence: -18,
    brilliance: -22,
    ...opts.bands,
  };
  return {
    filePath: "/tmp/take.wav",
    sox: {
      samplesRead: 44100,
      lengthSeconds: 1,
      scaledBy: 1,
      maximumAmplitude: 0.8,
      minimumAmplitude: -0.8,
      midlineAmplitude: 0,
      meanNorm: 0.3,
      meanAmplitude: 0,
      rmsAmplitude: 0.35,
      maximumDelta: 0.1,
      minimumDelta: 0,
      meanDelta: 0.05,
      rmsDelta: 0.06,
      roughFrequency: 220,
      volumeAdjustment: 3,
      rmsDbfs: -16,
      peakDbfs: -3,
      dynamicRangeDb: 13,
      clipping: false,
      ...opts.sox,
    },
    ffprobe: {
      format: {
        filename: "/tmp/take.wav",
        formatName: "wav",
        formatLongName: "WAV / WAVE",
        durationSeconds: 1,
        sizeBytes: 88244,
        bitRate: 705920,
        tags: {},
      },
      stream: {
        codecName: "pcm_s16le",
        codecLongName: "PCM signed 16-bit little-endian",
        channels: 1,
        channelLayout: "mono",
        sampleRate: 44100,
        bitDepth: 16,
        bitRate: null,
        durationSeconds: 1,
      },
    },
    spectrum: {
      bands,
      spectralCentroid: 1800,
      spectralRolloff85: 4500,
      dynamicRange: 13,
      ...opts.spectrum,
    },
    loudness: null,
  };
}

function makeChannel(name: string, index: number, opts: MakeAnalysisOpts = {}): ChannelAnalysis {
  return {
    channel: { index, name, tmpPath: `/tmp/${name}.wav`, needsCleanup: false },
    analysis: makeAnalysis(opts),
  };
}

function makeComparison(overrides: Partial<ChannelComparison> = {}): ChannelComparison {
  return {
    bandRankings: { bass: ["Kick", "Bass"] },
    maskingPairs: [],
    subBassOffenders: [],
    mixBandEnergy: { bass: -10.5 },
    ...overrides,
  };
}

function makeWindow(overrides: Partial<WindowData> = {}): WindowData {
  return {
    window: 1,
    ts: 1000,
    channels: [
      { index: 0, name: "Kick", bands: { bass: -12.34 }, rms: -18.5, peak: -3.2, clipping: false, centroid: 150.7, rolloff: 8000 },
    ],
    masking: [],
    ...overrides,
  };
}

function makePort(opts: { result?: NarrativeResult; deltas?: string[] } = {}) {
  const result: NarrativeResult = opts.result ?? { ok: true, provider: "anthropic", model: "claude-sonnet-4-6" };
  const calls: Array<{ system: string; user: string }> = [];
  const port: NarrativePort = {
    streamNarrative: vi.fn(async (system: string, user: string, onDelta: (text: string) => void) => {
      calls.push({ system, user });
      for (const d of opts.deltas ?? []) onDelta(d);
      return result;
    }),
    listModels: vi.fn(async () => []),
  };
  return { port, calls };
}

let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildMultiChannelPrompt", () => {
  it("renders the full mix section with formatted stats and bands", () => {
    const mix = makeAnalysis({
      sox: { peakDbfs: -3.1, rmsDbfs: -16.2, dynamicRangeDb: 13.1, clipping: true },
      spectrum: { spectralCentroid: 1500.6, spectralRolloff85: 8000.4 },
    });
    const out = buildMultiChannelPrompt(mix, [], makeComparison());

    expect(out).toContain("=== FULL MIX ANALYSIS ===");
    expect(out).toContain("Peak: -3.10 dBFS");
    expect(out).toContain("RMS: -16.20 dBFS");
    expect(out).toContain("Dyn Range: 13.10 dB");
    expect(out).toContain("Clipping: YES");
    expect(out).toContain("Spectral centroid: 1501 Hz");
    expect(out).toContain("Rolloff 85%: 8000 Hz");
    expect(out).toContain("sub=-30.00 bass=-12.00");
  });

  it("omits the mix section when mix is null", () => {
    const out = buildMultiChannelPrompt(null, [], makeComparison());
    expect(out).not.toContain("FULL MIX ANALYSIS");
    expect(out).toContain("=== CHANNEL ANALYSES ===");
  });

  it("renders per-channel headers with 1-indexed CH numbers and clipping status", () => {
    const channels = [
      makeChannel("Kick", 0, { sox: { clipping: false } }),
      makeChannel("Vox", 3, { sox: { clipping: false } }),
    ];
    const out = buildMultiChannelPrompt(null, channels, makeComparison());

    expect(out).toContain("--- Kick (CH1) ---");
    expect(out).toContain("--- Vox (CH4) ---");
    expect(out).toContain("Clipping: No");
    expect(out).toContain("sub=-30.00 bass=-12.00 lo-mid=-14.00 mid=-10.00 hi-mid=-16.00 presence=-18.00 brilliance=-22.00");
  });

  it("still emits section headers with no channels and no channel rows", () => {
    const out = buildMultiChannelPrompt(null, [], makeComparison());
    expect(out).toContain("=== CHANNEL ANALYSES ===");
    expect(out).toContain("=== COMPARISON & MASKING ANALYSIS ===");
    expect(out).not.toContain("--- ");
  });

  it("includes sub-bass offenders only when present", () => {
    const withOffenders = buildMultiChannelPrompt(
      null,
      [],
      makeComparison({ subBassOffenders: ["Kick", "Bass"] }),
    );
    expect(withOffenders).toContain("Sub-bass offenders (>-20 dBFS in sub-bass band): Kick, Bass");

    const withoutOffenders = buildMultiChannelPrompt(null, [], makeComparison());
    expect(withoutOffenders).not.toContain("Sub-bass offenders");
  });

  it("includes masking pairs only when present", () => {
    const withPairs = buildMultiChannelPrompt(
      null,
      [],
      makeComparison({
        maskingPairs: [{ bandName: "bass", channelA: "Kick", channelB: "Bass", energyDiff: 1.234 }],
      }),
    );
    expect(withPairs).toContain("bass: Kick vs Bass (diff: 1.23 dB)");

    const withoutPairs = buildMultiChannelPrompt(null, [], makeComparison());
    expect(withoutPairs).not.toContain("Masking pairs");
  });

  it("always renders band rankings and mix band energy", () => {
    const out = buildMultiChannelPrompt(null, [], makeComparison());
    expect(out).toContain("bass: Kick > Bass");
    expect(out).toContain("bass: -10.50 dBFS");
  });
});

describe("NarrativePort-backed functions", () => {
  describe("getEngineerRead", () => {
    it("golden: sends the exact pre-refactor prompt string, split into (system, user)", async () => {
      const { port, calls } = makePort();
      await getEngineerRead("REPORT DATA", port);

      expect(calls).toHaveLength(1);
      const joined = `${calls[0].system}\n\n${calls[0].user}`;
      expect(joined).toBe(`${SYSTEM_PROMPT}\n\nHere is the acoustic measurement data:\n\nREPORT DATA`);
      expect(joined).toContain("professional audio engineer with 20+ years");
      expect(joined).toContain("REPORT DATA");
    });
  });

  describe("analyzeMultiChannel", () => {
    it("golden: system/user match the multi-channel system prompt and built prompt body", async () => {
      const mix = makeAnalysis();
      const channels = [makeChannel("Kick", 0), makeChannel("Vox", 1)];
      const comparison = makeComparison();
      const { port, calls } = makePort();

      await analyzeMultiChannel(mix, channels, comparison, port);

      expect(calls).toHaveLength(1);
      expect(calls[0].system).toBe(MULTI_CHANNEL_SYSTEM_PROMPT);
      const built = buildMultiChannelPrompt(mix, channels, comparison);
      expect(calls[0].user).toBe(built);
      const joined = `${calls[0].system}\n\n${calls[0].user}`;
      expect(joined).toBe(`${MULTI_CHANNEL_SYSTEM_PROMPT}\n\n${built}`);
    });
  });

  describe("analyzeStream", () => {
    it("golden: computes windowSecs and formats windows into the user message", async () => {
      const windows = [makeWindow({ window: 1, ts: 1000 }), makeWindow({ window: 2, ts: 1003 })];
      const { port, calls } = makePort();

      await analyzeStream(windows, ["Kick"], port);

      expect(calls).toHaveLength(1);
      expect(calls[0].system).toContain("2 consecutive 3.0-second analysis windows");
      expect(calls[0].system.startsWith("You are a professional audio engineer monitoring a live mix from a Midas M32R console.")).toBe(true);
      expect(calls[0].user.startsWith("Live mix data:\n\n")).toBe(true);
      expect(calls[0].user).toContain("Window 1 (t=1970-01-01T00:16:40.000Z)");
      expect(calls[0].user).toContain("Kick: rms=-18.5dBFS peak=-3.2dBFS clip=false centroid=151Hz");
      expect(calls[0].user).toContain("[bass:-12.3dB]");
    });

    it("falls back to a 3-second window when only one window is given", async () => {
      const windows = [makeWindow({ window: 1, ts: 1000 })];
      const { port, calls } = makePort();

      await analyzeStream(windows, ["Kick"], port);

      expect(calls[0].system).toContain("1 consecutive 3.0-second analysis windows");
    });

    it("includes a masking line only when the window has masking pairs", async () => {
      const withMasking = [
        makeWindow({ masking: [{ band: "bass", channelA: "Kick", channelB: "Bass", diffDb: 2.5 }] }),
      ];
      const { port: portWithMasking, calls: callsWithMasking } = makePort();
      await analyzeStream(withMasking, ["Kick"], portWithMasking);
      expect(callsWithMasking[0].user).toContain("masking: bass:Kick↔Bass(2.5dB)");

      const withoutMasking = [makeWindow({ masking: [] })];
      const { port: portWithoutMasking, calls: callsWithoutMasking } = makePort();
      await analyzeStream(withoutMasking, ["Kick"], portWithoutMasking);
      expect(callsWithoutMasking[0].user).not.toContain("masking:");
    });
  });

  describe("streaming to stdout", () => {
    it("forwards deltas to stdout and writes a trailing newline", async () => {
      const { port } = makePort({ deltas: ["hello", " world"] });

      await getEngineerRead("x", port);

      expect(writeSpy).toHaveBeenNthCalledWith(1, "hello");
      expect(writeSpy).toHaveBeenNthCalledWith(2, " world");
      expect(writeSpy).toHaveBeenNthCalledWith(3, "\n");
    });
  });

  describe("failure throws, no trailing newline", () => {
    it("getEngineerRead rejects with the port's reason and never writes a trailing newline", async () => {
      const { port } = makePort({ result: { ok: false, reason: "Model anthropic/claude-sonnet-4-6 not found in the Pi model registry." } });

      await expect(getEngineerRead("x", port)).rejects.toThrow("not found");
      expect(writeSpy).not.toHaveBeenCalledWith("\n");
    });

    it("analyzeMultiChannel rejects with the port's reason", async () => {
      const { port } = makePort({ result: { ok: false, reason: "boom" } });
      await expect(
        analyzeMultiChannel(makeAnalysis(), [], makeComparison(), port),
      ).rejects.toThrow("boom");
    });

    it("analyzeStream rejects with the port's reason", async () => {
      const { port } = makePort({ result: { ok: false, reason: "boom" } });
      await expect(analyzeStream([makeWindow()], ["Kick"], port)).rejects.toThrow("boom");
    });
  });

  describe("default port", () => {
    it("constructs the unified PiNarrativeAdapter and streams through it when no port is given", async () => {
      vi.resetModules();
      const streamNarrativeMock = vi.fn(async (_system: string, _user: string, onDelta: (text: string) => void) => {
        onDelta("hi");
        return { ok: true as const, provider: "anthropic", model: "claude-sonnet-4-6" };
      });
      vi.doMock("./narrative/pi-adapter.js", () => ({
        PiNarrativeAdapter: vi.fn().mockImplementation(function (this: unknown) {
          return {
            streamNarrative: streamNarrativeMock,
            listModels: vi.fn(async () => []),
          };
        }),
      }));

      const { getEngineerRead: getEngineerReadFresh } = await import("./engineer.js");
      await getEngineerReadFresh("x");

      expect(streamNarrativeMock).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledWith("hi");

      vi.doUnmock("./narrative/pi-adapter.js");
      vi.resetModules();
    });
  });
});

describe("analyzeWithOllama", () => {
  function setupRequest() {
    const res = new EventEmitter();
    const req = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
    requestMock.mockImplementation((_opts: unknown, cb: (r: unknown) => void) => {
      queueMicrotask(() => cb(res));
      return req;
    });
    return { req, res };
  }

  it("builds the request body and options with defaults, and streams content", async () => {
    const { req, res } = setupRequest();
    const p = analyzeWithOllama("my report", "my system");
    await new Promise((r) => setImmediate(r));

    expect(requestMock).toHaveBeenCalledTimes(1);
    const options = requestMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options["hostname"]).toBe("localhost");
    expect(options["port"]).toBe(11434);
    expect(options["path"]).toBe("/api/chat");
    expect(options["method"]).toBe("POST");
    const headers = options["headers"] as Record<string, unknown>;
    expect(headers["content-type"]).toBe("application/json");

    const sentBody = req.write.mock.calls[0][0] as string;
    expect(headers["content-length"]).toBe(Buffer.byteLength(sentBody));
    expect(JSON.parse(sentBody)).toEqual({
      model: "llama3.2",
      messages: [
        { role: "system", content: "my system" },
        { role: "user", content: "my report" },
      ],
      stream: true,
    });
    expect(req.end).toHaveBeenCalled();

    res.emit("data", Buffer.from('{"message":{"content":"Hi"},"done":false}\n{"done":true}\n'));
    await p;

    expect(writeSpy).toHaveBeenCalledWith("Hi");
    expect(writeSpy).toHaveBeenCalledWith("\n");
  });

  it("uses an explicit model and host with an explicit port", async () => {
    const { req, res } = setupRequest();
    const p = analyzeWithOllama("r", "s", "mistral", "http://myhost:9999");
    await new Promise((r) => setImmediate(r));

    const options = requestMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options["hostname"]).toBe("myhost");
    expect(options["port"]).toBe(9999);

    const sentBody = req.write.mock.calls[0][0] as string;
    expect(JSON.parse(sentBody).model).toBe("mistral");

    res.emit("data", Buffer.from('{"done":true}\n'));
    await p;
  });

  it("falls back to port 11434 when the host has no port", async () => {
    const { res } = setupRequest();
    const p = analyzeWithOllama("r", "s", "llama3.2", "http://myhost");
    await new Promise((r) => setImmediate(r));

    const options = requestMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options["port"]).toBe(11434);

    res.emit("data", Buffer.from('{"done":true}\n'));
    await p;
  });

  it("buffers a streamed message split across chunks", async () => {
    const { res } = setupRequest();
    const p = analyzeWithOllama("r", "s");
    await new Promise((r) => setImmediate(r));

    res.emit("data", Buffer.from('{"message":{"content":"He'));
    res.emit("data", Buffer.from('llo"},"done":false}\n'));
    res.emit("data", Buffer.from('{"done":true}\n'));
    await p;

    expect(writeSpy).toHaveBeenCalledWith("Hello");
    expect(writeSpy).not.toHaveBeenCalledWith("He");
  });

  it("silently ignores malformed JSON lines", async () => {
    const { res } = setupRequest();
    const p = analyzeWithOllama("r", "s");
    await new Promise((r) => setImmediate(r));

    res.emit("data", Buffer.from('not json\n\n{"done":true}\n'));
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves on end when no done line was sent", async () => {
    const { res } = setupRequest();
    const p = analyzeWithOllama("r", "s");
    await new Promise((r) => setImmediate(r));

    res.emit("data", Buffer.from('{"message":{"content":"partial"},"done":false}\n'));
    res.emit("end");
    await p;

    expect(writeSpy).toHaveBeenCalledWith("\n");
  });

  it("rejects when the response emits an error", async () => {
    const { res } = setupRequest();
    const p = analyzeWithOllama("r", "s");
    await new Promise((r) => setImmediate(r));

    res.emit("error", new Error("boom"));
    await expect(p).rejects.toThrow("boom");
  });

  it("rejects on connection refused and logs an Ollama hint", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const req = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
    requestMock.mockImplementation(() => req);

    const p = analyzeWithOllama("r", "s");
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    req.emit("error", err);

    await expect(p).rejects.toThrow("connect ECONNREFUSED");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Ollama not running"));
  });

  it("rejects on other request errors without the Ollama hint", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const req = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
    requestMock.mockImplementation(() => req);

    const p = analyzeWithOllama("r", "s");
    const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    req.emit("error", err);

    await expect(p).rejects.toThrow("timed out");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
