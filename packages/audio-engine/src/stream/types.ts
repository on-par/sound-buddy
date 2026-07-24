// Lightweight level/spectrum update, emitted every --interval (real-time meters).
export interface MeterData {
  type: "meter";
  ts: number;
  channels: ChannelWindowData[];
}

// Heavier analysis-window update, emitted every window_secs (LLM trend context).
export interface WindowData {
  type?: "window";
  window: number;
  ts: number;
  channels: ChannelWindowData[];
  masking: MaskingPair[];
}

export type LiveEvent = MeterData | WindowData;

// A configured strip: a single device channel (mono) or a device-channel pair
// metered as one strip (stereo).
export type ChannelKind = "mono" | "stereo";

export interface ChannelWindowData {
  index: number;
  name: string;
  kind?: ChannelKind;
  bands: Record<string, number>;
  /** dB per point of the 48-point log analyzer grid (#667); absent on idle placeholders. */
  curve?: number[];
  rms: number;
  peak: number;
  clipping: boolean;
  centroid: number;
  rolloff: number;
}

export interface MaskingPair {
  band: string;
  channelA: string;
  channelB: string;
  diffDb: number;
}

export interface LiveState {
  windows: WindowData[];
  currentWindow: WindowData | null;
}
