// The serialization-safe boundary contract for the analyze-file IPC seam
// (#748). Mirrors audio-engine's AudioAnalysis (packages/audio-engine/src/
// types.ts) field-for-field so the whole analysis object can cross the
// Electron IPC boundary without dragging audio-engine's node-only types into
// the renderer program. Every field is plain JSON data (primitives, arrays of
// primitives, Record<string,string>, string-literal unions, `null` only where
// the producer emits `null`), which is what makes it a faithful wire shape.
//
// This is NOT the same shape as AudioAnalysisResult (also in this package):
// that is the AI-analyst input summary (epic #656), a flat per-channel
// name/rms/peak/DR/dominantBand subset with zero callers so far. Do not treat
// them as interchangeable — AnalysisPayload is the canonical analyze-file
// boundary contract; AudioAnalysisResult stays the documented-but-unwired
// AI-analyst input.
//
// Kept in lockstep with audio-engine's AudioAnalysis by the producer
// conformance test in packages/audio-engine/src/analyze/orchestrate.test.ts
// and the shared↔api drift test in app/renderer/src/analysis-payload-drift.test.ts.

export interface AnalysisPayloadSox {
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
  rmsDbfs: number;
  peakDbfs: number;
  dynamicRangeDb: number;
  clipping: boolean;
}

export interface AnalysisPayloadFormat {
  filename: string;
  formatName: string;
  formatLongName: string;
  durationSeconds: number;
  sizeBytes: number;
  bitRate: number;
  tags: Record<string, string>;
}

export interface AnalysisPayloadStream {
  codecName: string;
  codecLongName: string;
  channels: number;
  channelLayout: string;
  sampleRate: number;
  bitDepth: number | null;
  bitRate: number | null;
  durationSeconds: number | null;
}

export interface AnalysisPayloadFfprobe {
  format: AnalysisPayloadFormat;
  stream: AnalysisPayloadStream;
}

export interface AnalysisPayloadBands {
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  presence: number;
  brilliance: number;
}

export interface AnalysisPayloadCurve {
  freqs: number[];
  db: number[];
}

export type AnalysisPayloadContentClass = 'speech' | 'music' | 'silence' | 'unknown';
export type AnalysisPayloadContentType = 'speech' | 'music' | 'mixed' | 'silence';

export interface AnalysisPayloadFrame {
  t: number;
  db: number[];
  rms: number;
  class: AnalysisPayloadContentClass;
}

export interface AnalysisPayloadSegment {
  class: AnalysisPayloadContentClass;
  start: number;
  end: number;
}

export interface AnalysisPayloadSpectrum {
  bands: AnalysisPayloadBands;
  spectralCentroid: number;
  spectralRolloff85: number;
  dynamicRange: number;
  curve?: AnalysisPayloadCurve;
  frames?: AnalysisPayloadFrame[];
  segments?: AnalysisPayloadSegment[];
  contentType?: AnalysisPayloadContentType;
}

export interface AnalysisPayloadLoudness {
  integratedLufs: number;
  loudnessRange: number;
  truePeakDbtp: number;
}

export interface AnalysisPayload {
  filePath: string;
  sox: AnalysisPayloadSox;
  ffprobe: AnalysisPayloadFfprobe;
  spectrum: AnalysisPayloadSpectrum;
  loudness: AnalysisPayloadLoudness | null;
}
