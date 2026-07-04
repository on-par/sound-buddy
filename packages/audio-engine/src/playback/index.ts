import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { PlaybackEvent } from "./types.js";

export interface PlaybackOptions {
  // Folder holding session.json + stem WAVs (from stream.py --session-dir).
  sessionDir: string;
  // Output device index or name. Omitted ⇒ playback.py uses the default output.
  device?: string;
  // Routing spec mapping track → output channel(s), e.g. "0:0,1:1,2:2-3".
  // Optional only when `master` is set (the fold ignores discrete routing).
  route?: string;
  // Progress/level cadence in seconds (default 0.1 in playback.py).
  intervalSecs?: number;
  // Force the stereo master mixdown fold even on a big-enough device.
  master?: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYBACK_SCRIPT = resolve(__dirname, "../../scripts/playback.py");

// Map playback options to playback.py's CLI argv. Pure (no spawn) so the arg
// mapping is unit-testable. Positional session_dir first, then flags, mirroring
// the script's own parser.
export function buildPlaybackArgs(opts: PlaybackOptions): string[] {
  const args: string[] = [opts.sessionDir];
  if (opts.device) {
    args.push("--device", opts.device);
  }
  if (opts.route) {
    args.push("--route", opts.route);
  }
  if (opts.intervalSecs && opts.intervalSecs > 0) {
    args.push("--interval", String(opts.intervalSecs));
  }
  if (opts.master) {
    args.push("--master");
  }
  return args;
}

export interface PlaybackHandle {
  // The underlying playback.py process (SIGTERM triggers its clean finalize()).
  process: ChildProcess;
  // Stop playback: SIGTERM the process so its signal handler closes the stream.
  stop: () => void;
}

// Headless playback driver: spawn playback.py and deliver each JSON-line event
// to `onEvent`. Unlike startLive there is no TUI — the renderer (via IPC) owns
// the transport/meters UI (#46); this is the library-side counterpart used for
// tests and non-Electron consumers.
export function startPlayback(
  opts: PlaybackOptions,
  onEvent: (event: PlaybackEvent) => void,
  python = "python3",
): PlaybackHandle {
  const args = buildPlaybackArgs(opts);
  const py = spawn(python, [PLAYBACK_SCRIPT, ...args], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  const rl = createInterface({ input: py.stdout!, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed) as PlaybackEvent);
    } catch {
      // ignore non-JSON lines
    }
  });

  return {
    process: py,
    stop: () => {
      py.kill(); // SIGTERM → playback.py finalize()
    },
  };
}
