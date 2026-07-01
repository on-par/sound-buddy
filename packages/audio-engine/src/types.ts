export interface SoxStats {
  samplesRead: number;
  lengthSeconds: number;
  scaledBy: number;
  maximumAmplitude: number;
  minimumAmplitude: number;
  midlineAmplitude: number;
  meanNorm: number;
  meanAmplitude: number;
  rmsAmplitude: number;
  maximumDelta: number;
  minimumDelta: number;
  meanDelta: number;
  rmsDelta: number;
  roughFrequency: number;
  volumeAdjustment: number;
  /** Computed: RMS in dBFS */
  rmsDbfs: number;
  /** Computed: Peak in dBFS */
  peakDbfs: number;
  /** Computed: dynamic range estimate (dB) */
  dynamicRangeDb: number;
  /** Whether signal clips (|amplitude| >= 1.0) */
  clipping: boolean;
}

export interface AudioStream {
  codecName: string;
  codecLongName: string;
  channels: number;
  channelLayout: string;
  sampleRate: number;
  /** Bit depth for PCM (e.g. 16, 24, 32); null for lossy */
  bitDepth: number | null;
  bitRate: number | null;
  durationSeconds: number | null;
}

export interface AudioFormat {
  filename: string;
  formatName: string;
  formatLongName: string;
  durationSeconds: number;
  sizeBytes: number;
  bitRate: number;
  tags: Record<string, string>;
}

export interface FfprobeResult {
  format: AudioFormat;
  stream: AudioStream;
}

export interface FrequencyBands {
  /** Sub-bass 20–60 Hz */
  subBass: number;
  /** Bass 60–250 Hz */
  bass: number;
  /** Low-mid 250–500 Hz */
  lowMid: number;
  /** Mid 500–2000 Hz */
  mid: number;
  /** High-mid 2000–4000 Hz */
  highMid: number;
  /** Presence 4000–6000 Hz */
  presence: number;
  /** Brilliance 6000–20000 Hz */
  brilliance: number;
}

export interface SpectrumResult {
  bands: FrequencyBands;
  /** Spectral centroid in Hz */
  spectralCentroid: number;
  /** Spectral rolloff at 85% in Hz */
  spectralRolloff85: number;
  /** Dynamic range computed from RMS (dB) */
  dynamicRange: number;
}

export interface AudioAnalysis {
  filePath: string;
  sox: SoxStats;
  ffprobe: FfprobeResult;
  spectrum: SpectrumResult;
}

export interface ChannelFile {
  index: number;
  name: string;
  tmpPath: string;
  needsCleanup: boolean;
}

export interface ChannelAnalysis {
  channel: ChannelFile;
  analysis: AudioAnalysis;
}

export interface MaskingPair {
  bandName: string;
  channelA: string;
  channelB: string;
  energyDiff: number;
}

export interface ChannelComparison {
  bandRankings: Record<string, string[]>;
  maskingPairs: MaskingPair[];
  subBassOffenders: string[];
  mixBandEnergy: Record<string, number>;
}
