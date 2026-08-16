// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// #861 seam for the #839 report-card Troubleshooting section: rule-narrative
// renderers self-register here on module import, keyed by the ADR-0028 RuleType
// union, and the report card dispatches fired rules through this store with no
// per-template global wiring. getRuleRenderer deliberately returns a miss value
// (null) instead of throwing — unlike audio-engine's getRuleTemplate — so the
// report card never crashes on a rule type with no renderer registered yet (the
// no-hits empty state and future rule engines). The render input is the flat
// RuleNarrativeData record ADR-0028 fixed as the generic render contract.
import type { RuleType, RuleNarrativeData } from '@sound-buddy/audio-engine/dist/analyze/rule-narrative.js';

/** Renders a flat rule-hit record to narrative text for the report card. */
export type RuleRenderer = (data: RuleNarrativeData) => string;

const registry = new Map<RuleType, RuleRenderer>();

/** Upsert. Called from the renderer module's own top level — self-registration. */
export function registerRuleRenderer(type: RuleType, renderer: RuleRenderer): void {
  registry.set(type, renderer);
}

/** Miss value (null), never throws — unlike audio-engine's getRuleTemplate. */
export function getRuleRenderer(type: RuleType): RuleRenderer | null {
  return registry.get(type) ?? null;
}