// Troubleshooting-prose narrative for the gate rule type (#836, story 3 of
// #375): defines GateRuleHit — the forward data contract for the future
// gate-attack engine — flattens it into the flat RuleNarrativeData record the
// #834 renderer consumes, then renders it through the 'gate' template it
// registers itself. Deterministic, zero LLM, zero I/O.

import { registerRuleTemplate, renderRuleNarrative } from "./rule-narrative.js";
import type { RuleNarrativeData } from "./rule-narrative.js";
import { fmt } from "../format.js";

/** Troubleshooting-prose template for the gate rule type (#836, story 3 of 6). */
export const GATE_NARRATIVE_TEMPLATE =
  "The gate {behavior}: it responds {timingMs} ms after the signal onset at the {thresholdDb} dB threshold. {instruction}.";

/** Structured hit from the future gate-attack engine (#9 "gate attack"): the
 *  forward data contract this narrative consumes. The engine does not exist
 *  yet (ADR-0028); when it lands it emits this shape, or the adapter changes
 *  in the same PR. */
export interface GateRuleHit {
  /** How the gate misfires in plain language, e.g. "closes over the first syllable of every word". */
  behavior: string;
  /** Measured gate response timing, ms after signal onset. */
  timingMs: number;
  /** The gate's threshold setting that caused the misfire, dB. */
  thresholdDb: number;
  /** Plain-language remediation, e.g. "Lower the threshold to -40 dB and shorten the attack time". */
  instruction: string;
}

/** Maps a GateRuleHit to the flat renderer-ready record; timing and threshold
 *  are pre-formatted via fmt() as ADR-0028 directs. */
export function gateNarrativeData(hit: GateRuleHit): RuleNarrativeData {
  return {
    behavior: hit.behavior,
    timingMs: fmt(hit.timingMs, 0),
    thresholdDb: fmt(hit.thresholdDb, 0),
    instruction: hit.instruction,
  };
}

/** Registers the gate template (idempotent upsert, so repeated renders are
 *  safe) and renders it from the hit's measured values. */
export function renderGateNarrative(hit: GateRuleHit): string {
  registerRuleTemplate("gate", GATE_NARRATIVE_TEMPLATE);
  return renderRuleNarrative("gate", gateNarrativeData(hit));
}