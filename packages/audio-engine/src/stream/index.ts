import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { WindowData, LiveState } from "./types.js";
import { render } from "./display.js";
import { analyzeStream } from "../engineer.js";

export interface LiveOptions {
  device?: string;
  channels?: number[];
  channelNames?: string[];
  windowSecs: number;
  llmIntervalSecs: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const STREAM_SCRIPT = resolve(__dirname, "../../scripts/stream.py");
const MAX_WINDOWS = 10;

export async function startLive(opts: LiveOptions): Promise<void> {
  const args: string[] = [];
  if (opts.device) args.push(opts.device);
  else args.push("");

  args.push(String(opts.windowSecs));

  if (opts.channels && opts.channels.length > 0) {
    args.push(opts.channels.join(","));
  } else {
    args.push("");
  }

  const py = spawn("python3", [STREAM_SCRIPT, ...args], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  const state: LiveState = { windows: [], currentWindow: null };
  let windowNum = 0;
  let lastLlmTs = Date.now();
  let llmPending = false;

  // Hide cursor during live display
  process.stdout.write("\x1b[?25l");

  const restoreTerminal = () => {
    process.stdout.write("\x1b[?25h\x1b[0m\n");
  };

  const deviceLabel = opts.device ?? "Default Device";

  function secondsUntilLlm(): number {
    if (opts.llmIntervalSecs <= 0) return 0;
    const elapsed = (Date.now() - lastLlmTs) / 1000;
    return Math.max(0, Math.ceil(opts.llmIntervalSecs - elapsed));
  }

  async function triggerLlm(): Promise<void> {
    if (llmPending || state.windows.length === 0) return;
    llmPending = true;
    lastLlmTs = Date.now();

    process.stdout.write("\n\x1b[2K\x1b[G");
    process.stdout.write("─".repeat(76) + "\n");
    process.stdout.write("\x1b[1mLLM Deep-Dive\x1b[0m\n\n");

    try {
      await analyzeStream(state.windows, opts.channelNames ?? []);
    } catch (err) {
      process.stdout.write(`\n[LLM error: ${err}]\n`);
    }

    process.stdout.write("\n" + "─".repeat(76) + "\n\n");
    llmPending = false;

    // Re-render live display after LLM output
    render(state, deviceLabel, windowNum, opts.windowSecs, secondsUntilLlm());
  }

  const rl = createInterface({ input: py.stdout!, crlfDelay: Infinity });

  rl.on("line", (line) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    const data = parsed as Record<string, unknown>;

    if ("error" in data) {
      restoreTerminal();
      console.error(`stream.py error: ${data["error"]}`);
      process.exit(1);
    }

    const win = data as unknown as WindowData;
    windowNum = win.window;

    state.currentWindow = win;
    state.windows.push(win);
    if (state.windows.length > MAX_WINDOWS) {
      state.windows.shift();
    }

    render(state, deviceLabel, windowNum, opts.windowSecs, secondsUntilLlm());

    if (
      opts.llmIntervalSecs > 0 &&
      !llmPending &&
      (Date.now() - lastLlmTs) / 1000 >= opts.llmIntervalSecs
    ) {
      triggerLlm();
    }
  });

  // Stdin keypress handling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (key: string) => {
      if (key === "q" || key === "Q" || key === "\x03") {
        cleanup();
      } else if (key === "l" || key === "L") {
        triggerLlm();
      }
    });
  }

  function cleanup(): void {
    restoreTerminal();
    py.kill();
    process.exit(0);
  }

  py.on("close", (code) => {
    restoreTerminal();
    if (code !== 0 && code !== null) {
      console.error(`stream.py exited with code ${code}`);
      process.exit(1);
    }
    process.exit(0);
  });

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep the process alive
  await new Promise<void>(() => {});
}
