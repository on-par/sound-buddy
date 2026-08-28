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
export { buildPlaybackArgs } from "./playback/index.js";
export type { PlaybackOptions } from "./playback/index.js";

// Live capture argv mapping — the single source of truth for stream.py's CLI
// contract (#743).
export { buildStreamArgs } from "./stream/index.js";
export type { LiveOptions } from "./stream/index.js";
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

// Harshness rules engine (#381): data-driven symptom-to-frequency rules over
// the shared spectral core. Renderer/narrative consumption is #375.
export { RULE_TABLE, evaluateRules, rulesForInstrument, gradeSymptoms } from "./analyze/rules.js";
export type { HarshnessRule, RuleSuggestion, BandCondition, FiredRule, RuleMove, GradeSymptom } from "./analyze/rules.js";

// Rule-narrative templating layer (#834): deterministic rule-type-keyed
// template registry + pure placeholder renderer. Stories 2-5 register their
// rule type's template through registerRuleTemplate; story 6 consumes
// renderRuleNarrative. Zero LLM involvement.
export { registerRuleTemplate, getRuleTemplate, renderRuleNarrative } from "./analyze/rule-narrative.js";
export type { RuleType, RuleNarrativeData } from "./analyze/rule-narrative.js";

// Harshness narrative (story 2 of #375 / #835): deterministic troubleshooting
// prose registered under the 'harshness' rule type through the #834 registry.
export {
  HARSHNESS_NARRATIVE_TEMPLATE,
  harshnessNarrativeData,
  renderHarshnessNarrative,
} from "./analyze/harshness-narrative.js";

// Gate narrative (story 3 of #375 / #836): deterministic troubleshooting
// prose registered under the 'gate' rule type through the #834 registry.
export {
  GATE_NARRATIVE_TEMPLATE,
  gateNarrativeData,
  renderGateNarrative,
} from "./analyze/gate-narrative.js";
export type { GateRuleHit } from "./analyze/gate-narrative.js";

// Phase narrative (story 4 of #375 / #837): deterministic troubleshooting
// prose registered under the 'phase' rule type through the #834 registry.
export {
  PHASE_NARRATIVE_TEMPLATE,
  phaseNarrativeData,
  renderPhaseNarrative,
} from "./analyze/phase-narrative.js";
export type { PhaseRuleHit } from "./analyze/phase-narrative.js";

// Gain narrative (story 5 of #375 / #838): deterministic troubleshooting
// prose registered under the 'gain' rule type through the #834 registry.
export {
  GAIN_NARRATIVE_TEMPLATE,
  gainNarrativeData,
  renderGainNarrative,
} from "./analyze/gain-narrative.js";
export type { GainRuleHit } from "./analyze/gain-narrative.js";

// Post-service gain-structure health (#369): per-channel RMS-vs-target read
// derived from the existing sox measurements — no live console metering.
export { assessChannelGain, assessGainStructure, gainHealthLabel, GAIN_TARGET_DBFS } from "./analyze/gain-structure.js";
export type { ChannelGainHealth, GainStructureReport, GainStatus } from "./analyze/gain-structure.js";

// AI-analyst input summary (epic #656), not yet wired: the flat per-channel
// shape that will feed the AI-analyst feature. NOT the canonical analyze-file
// boundary contract — that is AnalysisPayload (packages/shared/src/
// analysis-payload.ts), which the Electron app types its IPC seam against.
// Produced here, defined in @sound-buddy/shared.
export { toAnalysisSummary, toChannelResult } from "./summary.js";
export type { AudioAnalysisResult, ChannelResult } from "@sound-buddy/shared";

// Shared AI system prompts (TD-004 slice 2, #426): single source of truth
// for the prompts previously duplicated across audio-engine/ai-analyst.
export { SYSTEM_PROMPT, MULTI_CHANNEL_SYSTEM_PROMPT, buildLiveSystemPrompt } from "./prompts/index.js";
export type { LiveSystemPromptOptions } from "./prompts/index.js";

// Canonical AI-prompt numeric formatter (TD-004 slice 5, #429).
export { fmt } from "./format.js";

// ── NDJSON stream parsing (#279) ──
export { readNdjsonLines, parseOllamaNdjsonStream } from "./ndjson.js";
export type { NdjsonSource, OllamaChatChunk } from "./ndjson.js";

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
