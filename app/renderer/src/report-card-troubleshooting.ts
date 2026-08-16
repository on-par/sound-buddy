// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// #862 troubleshooting-section view (story 2 of #839): dispatches fired
// harshness-rule hits (evaluateRules, #381) through the #861 renderer store to
// deterministic rule-narrative prose for the report card's Troubleshooting
// section. Pure and dependency-free beyond the store + audio-engine
// converters: narrative text is composed entirely from rule-narrative
// templates and rule data — zero LLM calls, zero I/O. Every hit's renderer is
// resolved through the store, and a null miss (a rule type with no registered
// renderer yet) is skipped, never a crash (ADR-0038's consumer-side
// guarantee). The bare side-effect import below is story 2's ownership of the
// #861 registration import: it guarantees the harshness renderer + template
// are registered before any call here.

import { harshnessNarrativeData } from '@sound-buddy/audio-engine/dist/analyze/harshness-narrative.js';
import type { FiredRule } from '@sound-buddy/audio-engine/dist/analyze/rules.js';
import { getRuleRenderer } from './rule-renderer-store';
import type { RuleRenderer } from './rule-renderer-store';
import './rule-renderers/harshness';

/** One deterministic troubleshooting entry for the report card's section. */
export interface TroubleshootingItem {
  ruleId: string;
  narrative: string;
}

/** Calm empty-state copy for a clean mix: a usable curve fired no harshness
 *  rules. Rendered only when the section has a measured curve but zero hits —
 *  never for a card with no curve. Story 3 of #839. */
export const TROUBLESHOOTING_EMPTY_MESSAGE = 'No harshness issues detected — the measured bands sit clean.';

/** Maps each fired rule through the given renderer; a null renderer (the
 *  ADR-0038 miss) returns an empty list — the graceful no-crash path. The
 *  renderer is injected per the constitution, so the miss is unit-testable. */
export function troubleshootHits(fired: FiredRule[], renderer: RuleRenderer | null): TroubleshootingItem[] {
  if (!renderer) return [];
  return fired.map((hit) => ({ ruleId: hit.rule.id, narrative: renderer(harshnessNarrativeData(hit)) }));
}

/** Resolves the 'harshness' renderer from the #861 store and renders every
 *  hit. evaluateRules is the harshness engine, so each hit it produces is a
 *  harshness-type rule; gate/phase/gain engines and their converters are
 *  future stories that would add their own dispatch here when they land. */
export function troubleshootingSectionView(fired: FiredRule[]): TroubleshootingItem[] {
  return troubleshootHits(fired, getRuleRenderer('harshness'));
}