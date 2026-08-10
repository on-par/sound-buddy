export interface LiveOptions {
  device?: string;
  // Channel-config tokens: "N" (mono) or "N-M" (stereo pair), e.g. ["0","1-2"].
  channels?: string[];
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
  // Record mode: per-strip display labels aligned index-for-index with
  // `channels`; '' = unlabeled. Emitted only when at least one label is
  // non-blank (#482 parity).
  labels?: string[];
}

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
  if (opts.labels && opts.labels.some((l) => typeof l === "string" && l.trim() !== "")) {
    args.push("--labels", JSON.stringify(opts.labels));
  }
  return args;
}
