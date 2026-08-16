// Troubleshooting-prose narrative for the gain rule type (#838, story 5 of
// #375): defines GainRuleHit — the forward data contract for the future
// gain-rule engine — flattens it into the flat RuleNarrativeData record the
// #834 renderer consumes, then renders it through the 'gain' template it
// registers itself. Deterministic, zero LLM, zero I/O. The status vocabulary
// ("hot" | "cold") and the -18 dBFS target convention mirror gain-structure.ts
// (#369) so the future engine's adapter maps onto the hit field-for-field.

import { registerRuleTemplate, renderRuleNarrative } from "./rule-narrative.js";
import type { RuleNarrativeData } from "./rule-narrative.js";
import { fmt } from "../format.js";

/** Troubleshooting-prose template for the gain rule type (#838, story 5 of 6). */
export const GAIN_NARRATIVE_TEMPLATE =
  "Channel {channel} is running {status}: its recorded level of {levelDbfs} dBFS sits {distanceDb} dB {direction} the {targetDbfs} dBFS target. {instruction}.";

/** Structured hit from the future gain-rule engine: the forward data contract
 *  this narrative consumes. The engine does not exist yet (ADR-0028); when it
 *  lands it emits this shape, or the adapter changes in the same PR. The
 *  status vocabulary and target convention mirror gain-structure.ts (#369). */
export interface GainRuleHit {
  /** Channel identifier in the gain read, e.g. "Kick" or "3". */
  channel: string;
  /** Measured RMS level in dBFS, e.g. -8.2 (running hot) or -30.5 (running cold). */
  levelDbfs: number;
  /** The operating level the channel is measured against, dBFS (GAIN_TARGET_DBFS = -18). */
  targetDbfs: number;
  /** Measured relationship to the target in plain language: too loud or too quiet. */
  status: "hot" | "cold";
  /** Plain-language remediation, e.g. "Reduce gain at the preamp for channel Kick". */
  instruction: string;
}

/** Maps a GainRuleHit to the flat renderer-ready record; distance from the
 *  target and the above/below direction are derived from the measured level
 *  vs target, and every dB value is pre-formatted via fmt() as ADR-0028
 *  directs. */
export function gainNarrativeData(hit: GainRuleHit): RuleNarrativeData {
  const distanceDb = Math.abs(hit.levelDbfs - hit.targetDbfs);
  return {
    channel: hit.channel,
    status: hit.status,
    levelDbfs: fmt(hit.levelDbfs, 1),
    distanceDb: fmt(distanceDb, 1),
    direction: hit.status === "hot" ? "above" : "below",
    targetDbfs: fmt(hit.targetDbfs, 0),
    instruction: hit.instruction,
  };
}

/** Registers the gain template (idempotent upsert, so repeated renders are
 *  safe) and renders it from the hit's measured values. */
export function renderGainNarrative(hit: GainRuleHit): string {
  registerRuleTemplate("gain", GAIN_NARRATIVE_TEMPLATE);
  return renderRuleNarrative("gain", gainNarrativeData(hit));
}