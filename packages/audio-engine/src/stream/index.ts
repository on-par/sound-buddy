import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { WindowData, LiveEvent, LiveState } from "./types.js";
import { render } from "./display.js";

export interface LiveOptions {
  device?: string;
  channels?: number[];
  channelNames?: string[];
  windowSecs: number;
  // Meter cadence in seconds (lightweight real-time updates). Default 0.1.
  intervalSecs?: number;
  // When set, stream.py records all device channels to this single WAV path.
  recordPath?: string;
  // When set, stream.py records a multitrack session (one stem WAV per armed
  // strip + session.json) into this directory, forwarded as --session-dir.
  sessionDir?: string;
  // Which strips to arm for the session, as channel-config tokens (e.g.
  // ["0", "2-3"]), forwarded as --arm. Omitted ⇒ stream.py arms all strips.
  armTokens?: string[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const STREAM_SCRIPT = resolve(__dirname, "../../scripts/stream.py");
const MAX_WINDOWS = 10;

// Map live options to stream.py's CLI argv. Pure (no spawn) so the arg mapping —
// including the record/session/arm branches — is unit-testable.
export function buildStreamArgs(opts: LiveOptions): string[] {
  const args: string[] = [];
  args.push(opts.device ? opts.device : "");

  args.push(String(opts.windowSecs));

  if (opts.channels && opts.channels.length > 0) {
    args.push(opts.channels.join(","));
  } else {
    args.push("");
  }

  if (opts.intervalSecs && opts.intervalSecs > 0) {
    args.push("--interval", String(opts.intervalSecs));
  }
  if (opts.recordPath) {
    args.push("--record", opts.recordPath);
  }
  if (opts.sessionDir) {
    args.push("--session-dir", opts.sessionDir);
  }
  if (opts.armTokens && opts.armTokens.length > 0) {
    args.push("--arm", opts.armTokens.join(","));
  }
  return args;
}

export async function startLive(opts: LiveOptions): Promise<void> {
  const args = buildStreamArgs(opts);

  const py = spawn("python3", [STREAM_SCRIPT, ...args], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  const state: LiveState = { windows: [], currentWindow: null };
  let windowNum = 0;

  // Hide cursor during live display
  process.stdout.write("\x1b[?25l");

  const restoreTerminal = () => {
    process.stdout.write("\x1b[?25h\x1b[0m\n");
  };

  const deviceLabel = opts.device ?? "Default Device";

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

    const ev = data as unknown as LiveEvent;

    // Meter ticks drive the real-time display; only the heavier window ticks
    // carry masking data. Carry the last window's masking forward on meter
    // ticks so the MASKING ALERTS section isn't blanked ~10×/s between windows.
    if (ev.type === "meter") {
      state.currentWindow = {
        window: windowNum,
        ts: ev.ts,
        channels: ev.channels,
        masking: state.currentWindow?.masking ?? [],
      };
    } else {
      const win = ev as WindowData;
      windowNum = win.window;
      state.currentWindow = win;
      state.windows.push(win);
      if (state.windows.length > MAX_WINDOWS) {
        state.windows.shift();
      }
    }

    render(state, deviceLabel, windowNum, opts.windowSecs);
  });

  // Stdin keypress handling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (key: string) => {
      if (key === "q" || key === "Q" || key === "\x03") {
        cleanup();
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
