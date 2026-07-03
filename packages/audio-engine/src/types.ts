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

/**
 * Fine-grained whole-file frequency response on a fixed log-spaced grid
 * (~1/6-octave, 20 Hz–20 kHz). `freqs[i]` is the center frequency (Hz) and
 * `db[i]` its level (dB). See PRD 02.
 */
export interface SpectrumCurve {
  freqs: number[];
  db: number[];
}

/**
 * A time-sampled snapshot of the spectrum curve (PRD 03). `db` is on the same
 * grid as {@link SpectrumCurve}. `class` is the content classification for the
 * window centered at `t` (PRD 04).
 */
export interface SpectrumFrame {
  /** Window center time, seconds. */
  t: number;
  /** Level per grid point (dB), same grid as SpectrumCurve.freqs. */
  db: number[];
  /** Mean RMS of the window, dB. */
  rms: number;
  /** Content class of this window. */
  class: ContentClass;
}

export type ContentClass = "speech" | "music" | "silence" | "unknown";
export type ContentType = "speech" | "music" | "mixed" | "silence";

/** A contiguous run of same-class frames (PRD 04). */
export interface SpectrumSegment {
  class: ContentClass;
  start: number;
  end: number;
}

export interface SpectrumResult {
  bands: FrequencyBands;
  /** Spectral centroid in Hz */
  spectralCentroid: number;
  /** Spectral rolloff at 85% in Hz */
  spectralRolloff85: number;
  /** Dynamic range computed from RMS (dB) */
  dynamicRange: number;
  /** Fine-grained whole-file frequency response (PRD 02). Optional for back-compat. */
  curve?: SpectrumCurve;
  /** Time-sampled spectrum snapshots (PRD 03). Optional for back-compat. */
  frames?: SpectrumFrame[];
  /** Contiguous same-class segments (PRD 04). Optional for back-compat. */
  segments?: SpectrumSegment[];
  /** Overall content classification (PRD 04). Optional for back-compat. */
  contentType?: ContentType;
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
