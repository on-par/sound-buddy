// Troubleshooting-prose narrative for the phase rule type (#837, story 4 of
// #375): defines PhaseRuleHit — the forward data contract for the future
// phase-correlation engine — flattens it into the flat RuleNarrativeData
// record the #834 renderer consumes, then renders it through the 'phase'
// template it registers itself. Deterministic, zero LLM, zero I/O.

import { registerRuleTemplate, renderRuleNarrative } from "./rule-narrative.js";
import type { RuleNarrativeData } from "./rule-narrative.js";
import { formatBandRange } from "./band-format.js";

/** Troubleshooting-prose template for the phase rule type (#837, story 4 of 6). */
export const PHASE_NARRATIVE_TEMPLATE =
  "In the {band} range, channels {channelA} and {channelB} are {polarity}, causing audible phase cancellation. {instruction}.";

/** Structured hit from the future phase-correlation engine: the forward data
 *  contract this narrative consumes. The engine does not exist yet
 *  (ADR-0028); when it lands it emits this shape, or the adapter changes in
 *  the same PR. */
export interface PhaseRuleHit {
  /** First channel identifier in the misaligned pair, e.g. "3" or "Kick". */
  channelA: string;
  /** Second channel identifier in the misaligned pair, e.g. "4" or "Kick Sub". */
  channelB: string;
  /** Low edge of the band where the phase issue is audible, Hz. */
  lowHz: number;
  /** High edge of the band where the phase issue is audible, Hz. */
  highHz: number;
  /** Measured polarity relationship in plain language, e.g. "polarity-inverted". */
  polarity: string;
  /** Plain-language remediation, e.g. "Flip the polarity of channel 4". */
  instruction: string;
}

/** Maps a PhaseRuleHit to the flat renderer-ready record; the measured band
 *  edges are formatted via the shared formatBandRange (no raw Hz numbers). */
export function phaseNarrativeData(hit: PhaseRuleHit): RuleNarrativeData {
  return {
    channelA: hit.channelA,
    channelB: hit.channelB,
    band: formatBandRange(hit.lowHz, hit.highHz),
    polarity: hit.polarity,
    instruction: hit.instruction,
  };
}

/** Registers the phase template (idempotent upsert, so repeated renders are
 *  safe) and renders it from the hit's measured values. */
export function renderPhaseNarrative(hit: PhaseRuleHit): string {
  registerRuleTemplate("phase", PHASE_NARRATIVE_TEMPLATE);
  return renderRuleNarrative("phase", phaseNarrativeData(hit));
}