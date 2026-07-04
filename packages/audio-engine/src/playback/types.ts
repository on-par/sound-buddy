// JSON-line events emitted by playback.py (one output-path counterpart to the
// stream.py meter/window events). Consumed by the engine wrapper and forwarded
// to the renderer over the Electron `playback-event` channel.

// Emitted once at startup: whether the stereo master mixdown fold is engaged and
// the channel math behind that decision.
export interface MixdownEvent {
  type: "mixdown";
  // true when all tracks fold to a 2-channel master (device too small or --master).
  active: boolean;
  // Channels actually opened on the device (2 in master mode, else `required`).
  outputChannels: number;
  // Channels discrete routing would need (highest routed channel index + 1).
  requiredChannels: number;
  // Channels the chosen output device provides.
  deviceChannels: number;
  // Human-readable reason the fold engaged; "" when discrete routing is used.
  reason: string;
}

// Emitted every --interval: playback position against the session length.
export interface ProgressEvent {
  type: "progress";
  elapsed: number;
  duration: number;
}

// Emitted every --interval: per-track meter feed (RMS/peak in dBFS + clipping).
export interface PlaybackLevelEvent {
  type: "level";
  tracks: PlaybackTrackLevel[];
}

export interface PlaybackTrackLevel {
  label: string;
  rms: number;
  peak: number;
  clipping: boolean;
}

// Emitted once when playback reaches the end of the longest stem (not on stop).
export interface EndedEvent {
  type: "ended";
}

// Emitted on a fatal error (missing dependency, bad manifest/route, device open).
export interface PlaybackErrorEvent {
  error: string;
}

export type PlaybackEvent =
  | MixdownEvent
  | ProgressEvent
  | PlaybackLevelEvent
  | EndedEvent
  | PlaybackErrorEvent;
