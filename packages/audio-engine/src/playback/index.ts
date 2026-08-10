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
