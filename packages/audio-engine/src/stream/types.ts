export interface WindowData {
  window: number;
  ts: number;
  channels: ChannelWindowData[];
  masking: MaskingPair[];
}

export interface ChannelWindowData {
  index: number;
  name: string;
  bands: Record<string, number>;
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
