// Post-service gain-structure health (#369): a per-channel read of how far the
// recorded RMS sits from a healthy operating level, derived entirely from the
// existing sox stat measurements (rmsDbfs/peakDbfs/clipping) already produced
// by analyzeAudio. No new pipeline, no live console metering — see
// .factory/plans/issue-369.md for the scope decision on trim vs. preamp.

import type { SoxStats } from "../types.js";

/** Reference operating level for gain staging (dBFS RMS). Engineers target ≈ −18 dBFS
 *  to leave healthy headroom above nominal signal. */
export const GAIN_TARGET_DBFS = -18;
/** A channel whose RMS is within ±this many dB of target is considered healthy. */
export const GAIN_TOLERANCE_DB = 6;
/** Health-score points lost per dB the RMS sits *beyond* the tolerance band. */
export const GAIN_PENALTY_PER_DB = 4;
/** Flat health-score penalty applied to a clipping channel. */
export const GAIN_CLIP_PENALTY = 30;
/** Score→label thresholds for the human grade. */
export const GAIN_SCORE_GOOD = 90;
export const GAIN_SCORE_FAIR = 75;
export const GAIN_SCORE_POOR = 60;

export type GainStatus = "healthy" | "hot" | "cold" | "silent";

export interface ChannelGainHealth {
  name: string;
  rmsDbfs: number;
  peakDbfs: number;
  /** rmsDbfs − GAIN_TARGET_DBFS (positive = hotter than target). NaN when silent. */
  distanceFromTargetDb: number;
  status: GainStatus;
  clipping: boolean;
  /** 0–100; 100 = perfectly gain-staged. `undefined` for silent channels. */
  score: number | undefined;
  warnings: string[];
}

export interface GainStructureReport {
  channels: ChannelGainHealth[];
  /** Mean of scored (non-silent) channels, rounded; 100 when none are scorable. */
  overallScore: number;
  targetDbfs: number;
}

// Only inequality comparisons (`>`, `<`) are used against float dB values below —
// never float `===` — so no epsilon tolerance is required (constitution float rule).

/** Per-channel gain-staging health from raw sox stats. Pure — no I/O. */
export function assessChannelGain(name: string, sox: SoxStats): ChannelGainHealth {
  const rms = sox.rmsDbfs;
  const peak = sox.peakDbfs;
  const clipping = sox.clipping;

  // sox emits rmsDbfs = -Infinity for a zero-RMS (silent) channel — must not
  // crash the scoring math or tank the overall average.
  if (!Number.isFinite(rms)) {
    return {
      name,
      rmsDbfs: rms,
      peakDbfs: peak,
      distanceFromTargetDb: NaN,
      status: "silent",
      clipping,
      score: undefined,
      warnings: [],
    };
  }

  const distance = rms - GAIN_TARGET_DBFS;
  const over = Math.max(0, Math.abs(distance) - GAIN_TOLERANCE_DB);
  let score = 100 - GAIN_PENALTY_PER_DB * over;
  if (clipping) score -= GAIN_CLIP_PENALTY;
  score = Math.round(Math.max(0, Math.min(100, score)));

  let status: GainStatus = "healthy";
  const warnings: string[] = [];

  if (clipping) {
    status = "hot";
    warnings.push(
      "Clipping — peaks reach 0 dBFS. Back off preamp gain at the source; trim can't recover clipped samples."
    );
  } else if (distance > GAIN_TOLERANCE_DB) {
    status = "hot";
    warnings.push(
      `Running hot — RMS ${rms.toFixed(1)} dBFS is ${distance.toFixed(1)} dB above the ${GAIN_TARGET_DBFS} dBFS target. Reduce gain at the preamp/source, not with downstream trim.`
    );
  } else if (distance < -GAIN_TOLERANCE_DB) {
    status = "cold";
    warnings.push(
      `Recorded cold — RMS ${rms.toFixed(1)} dBFS is ${(-distance).toFixed(1)} dB below the ${GAIN_TARGET_DBFS} dBFS target. Raise gain at the preamp; pushing trim to compensate lifts the noise floor by the same amount.`
    );
  }

  return { name, rmsDbfs: rms, peakDbfs: peak, distanceFromTargetDb: distance, status, clipping, score, warnings };
}

/** Roll up per-channel gain health into an overall session score. Pure — no I/O. */
export function assessGainStructure(channels: Array<{ name: string; sox: SoxStats }>): GainStructureReport {
  const assessed = channels.map((c) => assessChannelGain(c.name, c.sox));
  const scored = assessed.map((c) => c.score).filter((s): s is number => s !== undefined);
  const overallScore = scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 100;
  return { channels: assessed, overallScore, targetDbfs: GAIN_TARGET_DBFS };
}

/** Human grade for a 0–100 gain health score. */
export function gainHealthLabel(score: number): "Excellent" | "Good" | "Fair" | "Poor" {
  if (score >= GAIN_SCORE_GOOD) return "Excellent";
  if (score >= GAIN_SCORE_FAIR) return "Good";
  if (score >= GAIN_SCORE_POOR) return "Fair";
  return "Poor";
}
