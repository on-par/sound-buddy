import { rmSync } from "node:fs";
import { analyzeAudio } from "./analyze/index.js";
import { extractChannels, loadChannelFiles } from "./analyze/channels.js";
import { compareChannels } from "./analyze/compare.js";
import { formatMultiChannelReport } from "./report.js";
import type { ChannelFile } from "./types.js";

// Public library API — consumed by other @sound-buddy packages.
export { analyzeAudio, extractChannels, loadChannelFiles, compareChannels, formatMultiChannelReport };
export { cleanup as cleanupChannelFiles };
export type { AudioAnalysis, LoudnessStats, ChannelFile, ChannelAnalysis } from "./types.js";

// Multitrack session playback (output path) — #45.
export { buildPlaybackArgs, startPlayback } from "./playback/index.js";
export type { PlaybackOptions, PlaybackHandle } from "./playback/index.js";
export type {
  PlaybackEvent,
  MixdownEvent,
  ProgressEvent,
  PlaybackLevelEvent,
  PlaybackTrackLevel,
  EndedEvent,
  PlaybackErrorEvent,
} from "./playback/types.js";

// Ideal EQ profiles + level-invariant comparison (PRD 05).
export {
  PROFILES,
  GRID_FREQS,
  GRID_POINTS,
  getProfile,
  defaultProfileForContentType,
  compareToProfile,
  PENALTY_PER_DB,
} from "./profiles/index.js";
export type { IdealProfile, ProfileComparison, BandDeviation } from "./profiles/index.js";

// Canonical band metadata + presentation helpers (TD-005): single source of
// truth for band labels/bounds and the per-channel summary table, replacing
// four duplicated copies across audio-engine/cli.
export { BAND_METADATA, BAND_LABELS, dominantBandLabel, formatChannelTable } from "./bands.js";
export type { BandKey, BandMeta } from "./bands.js";

// Shared spectral-analysis primitives (#376): peak-picking for #15 feedback
// ring-out, band-energy for the future #2 harshness engine.
export { findSpectralPeaks, bandEnergy, localEnvelope } from "./analyze/spectral.js";
export type { SpectralPeak, FindPeaksOptions } from "./analyze/spectral.js";

// Post-service gain-structure health (#369): per-channel RMS-vs-target read
// derived from the existing sox measurements — no live console metering.
export { assessChannelGain, assessGainStructure, gainHealthLabel, GAIN_TARGET_DBFS } from "./analyze/gain-structure.js";
export type { ChannelGainHealth, GainStructureReport, GainStatus } from "./analyze/gain-structure.js";

// Canonical IPC-safe analysis summary (TD-015): the flat, serialization-safe
// per-channel shape that crosses package boundaries. Produced here, defined
// in @sound-buddy/shared.
export { toAnalysisSummary, toChannelResult } from "./summary.js";
export type { AudioAnalysisResult, ChannelResult } from "@sound-buddy/shared";

// Shared AI system prompts (TD-004 slice 2, #426): single source of truth
// for the three prompts previously duplicated across audio-engine/ai-analyst.
export { SYSTEM_PROMPT, MULTI_CHANNEL_SYSTEM_PROMPT, ANALYST_SYSTEM_PROMPT } from "./prompts/index.js";

function cleanup(chFiles: ChannelFile[]): void {
  for (const ch of chFiles) {
    if (ch.needsCleanup) {
      try {
        rmSync(ch.tmpPath);
      } catch {
        // non-fatal
      }
    }
  }
}
