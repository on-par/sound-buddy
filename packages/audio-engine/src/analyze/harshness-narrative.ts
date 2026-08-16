// Troubleshooting-prose narrative for the harshness rule type (#835, story 2
// of #375): flattens a FiredRule hit into the flat RuleNarrativeData record the
// #834 renderer consumes, then renders it through the 'harshness' template it
// registers itself. Deterministic, zero LLM, zero I/O.

import { registerRuleTemplate, renderRuleNarrative } from "./rule-narrative.js";
import type { RuleNarrativeData } from "./rule-narrative.js";
import type { FiredRule } from "./rules.js";
import { formatBandRange } from "./band-format.js";
import { fmt } from "../format.js";

/** Troubleshooting-prose template for the harshness rule type (#835, story 2 of 6). */
export const HARSHNESS_NARRATIVE_TEMPLATE =
  "The mix reads as {symptom}: the {band} region sits {excessDb} dB above the {reference} body (threshold {thresholdDb} dB). {instruction} to tame it.";

/** Maps a FiredRule hit to the flat renderer-ready record: band/reference
 *  edges become plain "2–4 kHz"-style labels, dB values are pre-formatted via
 *  the canonical fmt() as ADR-0028 directs. */
export function harshnessNarrativeData(fired: FiredRule): RuleNarrativeData {
  return {
    symptom: fired.rule.symptom,
    band: formatBandRange(fired.rule.condition.band.lowHz, fired.rule.condition.band.highHz),
    reference: formatBandRange(fired.rule.condition.reference.lowHz, fired.rule.condition.reference.highHz),
    excessDb: fmt(fired.excessDb, 1),
    thresholdDb: fmt(fired.rule.condition.minExcessDb, 0),
    instruction: fired.rule.suggestion.instruction,
  };
}

/** Registers the harshness template (idempotent upsert, so repeated renders
 *  are safe) and renders it from the hit's measured values. */
export function renderHarshnessNarrative(fired: FiredRule): string {
  registerRuleTemplate("harshness", HARSHNESS_NARRATIVE_TEMPLATE);
  return renderRuleNarrative("harshness", harshnessNarrativeData(fired));
}
