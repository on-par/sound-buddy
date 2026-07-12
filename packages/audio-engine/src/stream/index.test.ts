import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("./display.js", () => ({ render: vi.fn() }));
vi.mock("../engineer.js", () => ({ analyzeStream: vi.fn().mockResolvedValue(undefined) }));

import { spawn } from "node:child_process";
import { render } from "./display.js";
import { analyzeStream } from "../engineer.js";
import { buildStreamArgs, startLive, type LiveOptions } from "./index.js";

const base: LiveOptions = {
  windowSecs: 3,
  llmIntervalSecs: 0,
};

describe("buildStreamArgs", () => {
  it("emits device/window/channels positionals with sensible blanks", () => {
    expect(buildStreamArgs(base)).toEqual(["", "3", ""]);
    expect(buildStreamArgs({ ...base, device: "Scarlett", channels: [0, 1, 2] })).toEqual(
      ["Scarlett", "3", "0,1,2"],
    );
  });

  it("omits --session-dir and --arm in monitor mode", () => {
    const args = buildStreamArgs({ ...base, intervalSecs: 0.1 });
    expect(args).not.toContain("--session-dir");
    expect(args).not.toContain("--arm");
    expect(args).not.toContain("--record");
  });

  it("maps sessionDir → --session-dir and armTokens → --arm", () => {
    const args = buildStreamArgs({
      ...base,
      sessionDir: "/tmp/session-1",
      armTokens: ["0", "2-3"],
    });
    expect(args).toContain("--session-dir");
    expect(args[args.indexOf("--session-dir") + 1]).toBe("/tmp/session-1");
    expect(args).toContain("--arm");
    expect(args[args.indexOf("--arm") + 1]).toBe("0,2-3");
  });

  it("forwards sessionDir without --arm when no strips are armed", () => {
    const args = buildStreamArgs({ ...base, sessionDir: "/tmp/s", armTokens: [] });
    expect(args).toContain("--session-dir");
    expect(args).not.toContain("--arm");
  });

  it("still supports the single-file --record path", () => {
    const args = buildStreamArgs({ ...base, recordPath: "/tmp/out.wav" });
    expect(args).toContain("--record");
    expect(args[args.indexOf("--record") + 1]).toBe("/tmp/out.wav");
  });

  it("emits --interval with its value when intervalSecs is positive", () => {
    const args = buildStreamArgs({ ...base, intervalSecs: 0.25 });
    expect(args).toContain("--interval");
    expect(args[args.indexOf("--interval") + 1]).toBe("0.25");
  });

  it("omits --interval when intervalSecs is 0 or undefined", () => {
    expect(buildStreamArgs({ ...base, intervalSecs: 0 })).not.toContain("--interval");
    expect(buildStreamArgs({ ...base, intervalSecs: undefined })).not.toContain("--interval");
  });

  it("orders all optional flags correctly when every option is set", () => {
    const args = buildStreamArgs({
      device: "M32R",
      channels: [0, 2, 3],
      windowSecs: 5,
      llmIntervalSecs: 30,
      intervalSecs: 0.1,
      recordPath: "/out.wav",
      sessionDir: "/tmp/sess",
      armTokens: ["0", "2-3"],
    });
    expect(args).toEqual([
      "M32R",
      "5",
      "0,2,3",
      "--interval",
      "0.1",
      "--record",
      "/out.wav",
      "--session-dir",
      "/tmp/sess",
      "--arm",
      "0,2-3",
    ]);
  });

  it("emits an empty positional when channels is an empty array", () => {
    expect(buildStreamArgs({ ...base, channels: [] })).toEqual(["", "3", ""]);
  });
});

function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.kill = vi.fn();
  return child;
}

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

const windowLine = (n: number) =>
  JSON.stringify({ type: "window", window: n, ts: n, channels: [], masking: [] });

describe("startLive", () => {
  let stdout: string;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let sigintBefore: NodeJS.SignalsListener[];
  let sigtermBefore: NodeJS.SignalsListener[];
  let stdinDataBefore: ((...args: unknown[]) => void)[];

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = "";
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    sigintBefore = [...process.listeners("SIGINT")] as NodeJS.SignalsListener[];
    sigtermBefore = [...process.listeners("SIGTERM")] as NodeJS.SignalsListener[];
    stdinDataBefore = [...process.stdin.listeners("data")] as ((...args: unknown[]) => void)[];
  });

  afterEach(() => {
    writeSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process
      .listeners("SIGINT")
      .filter((l) => !sigintBefore.includes(l as NodeJS.SignalsListener))
      .forEach((l) => process.removeListener("SIGINT", l as NodeJS.SignalsListener));
    process
      .listeners("SIGTERM")
      .filter((l) => !sigtermBefore.includes(l as NodeJS.SignalsListener))
      .forEach((l) => process.removeListener("SIGTERM", l as NodeJS.SignalsListener));
    process.stdin
      .listeners("data")
      .filter((l) => !stdinDataBefore.includes(l as (...args: unknown[]) => void))
      .forEach((l) => process.stdin.removeListener("data", l as (...args: unknown[]) => void));
    vi.useRealTimers();
  });

  it("spawns python3 with the built args and hides the cursor", () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    void startLive(base);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = vi.mocked(spawn).mock.calls[0]!;
    expect(cmd).toBe("python3");
    expect((args as string[])[0]).toMatch(/scripts[\\/]stream\.py$/);
    expect((args as string[]).slice(1)).toEqual(buildStreamArgs(base));
    expect(options).toEqual({ stdio: ["ignore", "pipe", "inherit"] });
    expect(stdout).toContain("\x1b[?25l");
  });

  it("renders state on a window line using the default device label", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    void startLive(base);
    child.stdout.write(windowLine(1) + "\n");
    await flush();

    const call = vi.mocked(render).mock.calls.at(-1)!;
    const [state, deviceLabel, windowNum, windowSecs, countdown] = call;
    expect((state as { windows: unknown[] }).windows).toHaveLength(1);
    expect((state as { currentWindow: { window: number } }).currentWindow?.window).toBe(1);
    expect(deviceLabel).toBe("Default Device");
    expect(windowNum).toBe(1);
    expect(windowSecs).toBe(base.windowSecs);
    expect(countdown).toBe(0);
  });

  it("uses the configured device as the render label", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    void startLive({ ...base, device: "Scarlett" });
    child.stdout.write(windowLine(1) + "\n");
    await flush();

    const [, deviceLabel] = vi.mocked(render).mock.calls.at(-1)!;
    expect(deviceLabel).toBe("Scarlett");
  });

  it("carries masking forward from the last window onto meter ticks", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    void startLive(base);
    const masking = [{ band: "mid", channelA: "Vox", channelB: "Gtr", diffDb: 2 }];
    child.stdout.write(
      JSON.stringify({ type: "window", window: 1, ts: 1, channels: [], masking }) + "\n",
    );
    await flush();
    child.stdout.write(JSON.stringify({ type: "meter", ts: 2, channels: [] }) + "\n");
    await flush();

    const [state] = vi.mocked(render).mock.calls.at(-1)!;
    expect((state as { currentWindow: { masking: unknown } }).currentWindow?.masking).toEqual(
      masking,
    );
    expect((state as { windows: unknown[] }).windows).toHaveLength(1);
  });

  it("ignores invalid JSON lines", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    void startLive(base);
    child.stdout.write("not json\n");
    await flush();

    expect(render).not.toHaveBeenCalled();
  });

  it("trims accumulated windows to MAX_WINDOWS", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    void startLive(base);
    for (let n = 1; n <= 11; n++) {
      child.stdout.write(windowLine(n) + "\n");
    }
    await flush();

    const [state] = vi.mocked(render).mock.calls.at(-1)!;
    const windows = (state as { windows: { window: number }[] }).windows;
    expect(windows).toHaveLength(10);
    expect(windows[0]!.window).toBe(2);
  });

  it("handles a stream.py error line by restoring the terminal and exiting", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    void startLive(base);
    child.stdout.write(JSON.stringify({ error: "no such device" }) + "\n");
    await flush();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("no such device"));
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(stdout).toContain("\x1b[?25h");
  });

  it("triggers the LLM once the interval has elapsed, forwarding windows and channel names", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    void startLive({ windowSecs: 5, llmIntervalSecs: 30, channelNames: ["Vox", "Gtr"] });
    child.stdout.write(windowLine(1) + "\n");
    await flush();
    expect(analyzeStream).not.toHaveBeenCalled();

    vi.setSystemTime(31_000);
    child.stdout.write(windowLine(2) + "\n");
    await flush();
    await flush();

    expect(analyzeStream).toHaveBeenCalledTimes(1);
    const [windows, channelNames] = vi.mocked(analyzeStream).mock.calls[0]!;
    expect(windows).toHaveLength(2);
    expect(channelNames).toEqual(["Vox", "Gtr"]);
  });

  it("writes an LLM error to stdout and re-renders when analyzeStream rejects", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    vi.mocked(analyzeStream).mockRejectedValueOnce(new Error("boom"));

    void startLive({ windowSecs: 5, llmIntervalSecs: 30 });
    child.stdout.write(windowLine(1) + "\n");
    await flush();

    vi.setSystemTime(31_000);
    const renderCallsBefore = vi.mocked(render).mock.calls.length;
    child.stdout.write(windowLine(2) + "\n");
    await flush();
    await flush();

    expect(stdout).toContain("[LLM error:");
    expect(vi.mocked(render).mock.calls.length).toBeGreaterThan(renderCallsBefore);
  });

  it("exits 0 without logging when stream.py closes with code 0 or null", () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    void startLive(base);

    child.emit("close", 0);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(stdout).toContain("\x1b[?25h");
    expect(console.error).not.toHaveBeenCalled();

    vi.mocked(process.exit).mockClear();
    vi.mocked(console.error).mockClear();
    const child2 = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child2 as never);
    void startLive(base);
    child2.emit("close", null);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs and exits 1 when stream.py closes with a non-zero code", () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    void startLive(base);

    child.emit("close", 3);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("code 3"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("handles TTY keypresses: l triggers LLM guard, unknown keys no-op, q kills and exits", () => {
    const originalIsTTY = process.stdin.isTTY;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- non-TTY stdin lacks setRawMode
    const originalSetRawMode = (process.stdin as any).setRawMode;
    const resumeSpy = vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    const setEncodingSpy = vi
      .spyOn(process.stdin, "setEncoding")
      .mockImplementation(() => process.stdin);

    try {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- non-TTY stdin lacks setRawMode
      (process.stdin as any).setRawMode = vi.fn();

      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      void startLive(base);

      process.stdin.emit("data", "l");
      expect(analyzeStream).not.toHaveBeenCalled();

      process.stdin.emit("data", "x");
      expect(analyzeStream).not.toHaveBeenCalled();
      expect(child.kill).not.toHaveBeenCalled();

      process.stdin.emit("data", "q");
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(0);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- non-TTY stdin lacks setRawMode
      (process.stdin as any).setRawMode = originalSetRawMode;
      resumeSpy.mockRestore();
      setEncodingSpy.mockRestore();
    }
  });
});
