import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { AudioAnalysis, ChannelAnalysis, ChannelComparison, FrequencyBands } from "./types.js";
import type { WindowData } from "./stream/types.js";

const {
  promptMock,
  subscribeMock,
  findMock,
  authCreateMock,
  modelRegistryCreateMock,
  sessionManagerInMemoryMock,
  createAgentSessionMock,
  requestMock,
} = vi.hoisted(() => {
  const promptMock = vi.fn().mockResolvedValue(undefined);
  const subscribeMock = vi.fn();
  const findMock = vi.fn((): { id: string } | null => ({ id: "claude-sonnet-4-6" }));
  const authCreateMock = vi.fn(() => ({}));
  const modelRegistryCreateMock = vi.fn(() => ({ find: findMock }));
  const sessionManagerInMemoryMock = vi.fn(() => ({}));
  const createAgentSessionMock = vi.fn(async () => ({
    session: { subscribe: subscribeMock, prompt: promptMock },
  }));
  const requestMock = vi.fn();
  return {
    promptMock,
    subscribeMock,
    findMock,
    authCreateMock,
    modelRegistryCreateMock,
    sessionManagerInMemoryMock,
    createAgentSessionMock,
    requestMock,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: createAgentSessionMock,
  AuthStorage: { create: authCreateMock },
  ModelRegistry: { create: modelRegistryCreateMock },
  SessionManager: { inMemory: sessionManagerInMemoryMock },
}));

vi.mock("http", () => ({
  request: requestMock,
  default: { request: requestMock },
}));

import {
  fmt,
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

let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  findMock.mockImplementation(() => ({ id: "claude-sonnet-4-6" }));
  createAgentSessionMock.mockImplementation(async () => ({
    session: { subscribe: subscribeMock, prompt: promptMock },
  }));
  promptMock.mockResolvedValue(undefined);
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fmt", () => {
  it("formats a normal number to 2 decimals by default", () => {
    expect(fmt(-12.345)).toBe("-12.35");
    expect(fmt(0)).toBe("0.00");
  });

  it("honors the decimals arg", () => {
    expect(fmt(-12.345, 1)).toBe("-12.3");
    expect(fmt(5, 0)).toBe("5");
  });

  it("formats non-finite values as -inf", () => {
    expect(fmt(-Infinity)).toBe("-inf");
    expect(fmt(Infinity)).toBe("-inf");
    expect(fmt(NaN)).toBe("-inf");
  });
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

describe("session functions", () => {
  describe("getEngineerRead", () => {
    it("prompts with the engineer system prompt and the report data", async () => {
      await getEngineerRead("REPORT DATA");
      const prompt = promptMock.mock.calls[0][0] as string;
      expect(prompt).toContain("professional audio engineer with 20+ years");
      expect(prompt).toContain("REPORT DATA");
    });

    it("errors when the model is not found in the registry", async () => {
      findMock.mockReturnValueOnce(null);
      await expect(getEngineerRead("x")).rejects.toThrow(
        "Model claude-sonnet-4-6 not found in registry",
      );
    });

    it("wires createSession deps together", async () => {
      await getEngineerRead("x");
      expect(authCreateMock).toHaveBeenCalled();
      expect(modelRegistryCreateMock).toHaveBeenCalledWith(authCreateMock.mock.results[0]?.value);
      expect(sessionManagerInMemoryMock).toHaveBeenCalled();
      expect(createAgentSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: findMock.mock.results[0]?.value }),
      );
    });

    it("streams text_delta events to stdout and writes a trailing newline", async () => {
      const promise = getEngineerRead("x");
      await new Promise((r) => setImmediate(r));
      const cb = subscribeMock.mock.calls[0][0] as (e: unknown) => void;
      cb({ type: "text_delta", text: "hello" });
      cb({ type: "other", text: "x" });
      cb({ type: "text_delta", text: 42 });
      await promise;

      expect(writeSpy).toHaveBeenCalledWith("hello");
      expect(writeSpy).not.toHaveBeenCalledWith("x");
      expect(writeSpy).not.toHaveBeenCalledWith(42);
      expect(writeSpy).toHaveBeenCalledWith("\n");
    });
  });

  describe("analyzeMultiChannel", () => {
    it("prompts with the multi-channel system prompt, channel names, and the built prompt body", async () => {
      const mix = makeAnalysis();
      const channels = [makeChannel("Kick", 0), makeChannel("Vox", 1)];
      const comparison = makeComparison();

      await analyzeMultiChannel(mix, channels, comparison);

      const prompt = promptMock.mock.calls[0][0] as string;
      expect(prompt).toContain("professional mixing engineer");
      expect(prompt).toContain("Kick");
      expect(prompt).toContain("Vox");
      expect(prompt).toContain(buildMultiChannelPrompt(mix, channels, comparison));

      const cb = subscribeMock.mock.calls[0][0] as (e: unknown) => void;
      cb({ type: "text_delta", text: "hello" });
      expect(writeSpy).toHaveBeenCalledWith("hello");
    });
  });

  describe("analyzeStream", () => {
    it("computes windowSecs from the first/last window timestamps across multiple windows", async () => {
      const windows = [makeWindow({ window: 1, ts: 1000 }), makeWindow({ window: 2, ts: 1003 })];
      await analyzeStream(windows, ["Kick"]);

      const prompt = promptMock.mock.calls[0][0] as string;
      expect(prompt).toContain("2 consecutive 3.0-second analysis windows");
      expect(prompt).toContain("Window 1 (t=1970-01-01T00:16:40.000Z)");
      expect(prompt).toContain("Kick: rms=-18.5dBFS peak=-3.2dBFS clip=false centroid=151Hz");
      expect(prompt).toContain("[bass:-12.3dB]");

      const cb = subscribeMock.mock.calls[0][0] as (e: unknown) => void;
      cb({ type: "text_delta", text: "hello" });
      expect(writeSpy).toHaveBeenCalledWith("hello");
    });

    it("falls back to a 3-second window when only one window is given", async () => {
      const windows = [makeWindow({ window: 1, ts: 1000 })];
      await analyzeStream(windows, ["Kick"]);

      const prompt = promptMock.mock.calls[0][0] as string;
      expect(prompt).toContain("1 consecutive 3.0-second analysis windows");
    });

    it("includes a masking line only when the window has masking pairs", async () => {
      const withMasking = [
        makeWindow({ masking: [{ band: "bass", channelA: "Kick", channelB: "Bass", diffDb: 2.5 }] }),
      ];
      await analyzeStream(withMasking, ["Kick"]);
      expect((promptMock.mock.calls[0][0] as string)).toContain("masking: bass:Kick↔Bass(2.5dB)");

      promptMock.mockClear();

      const withoutMasking = [makeWindow({ masking: [] })];
      await analyzeStream(withoutMasking, ["Kick"]);
      expect((promptMock.mock.calls[0][0] as string)).not.toContain("masking:");
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
