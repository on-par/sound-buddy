# Report-card rule-narrative renderers self-register in a renderer-side store keyed by rule type, and lookup returns a miss value instead of throwing

- Status: Accepted
- Date: 2026-08-16

## Context

#861 is story 1 of the #839 report-card Troubleshooting section. The
deterministic template registry and pure flat-data renderer live in
packages/audio-engine (#834, ADR-0028), where getRuleTemplate throws an
actionable error on an unregistered rule type. The report card (story 2)
must render each fired rule's narrative by rule type with no per-template
global wiring (no switch, no central registry edit), and must never crash
when a rule type has no renderer registered — the no-hits empty state
(story 3) and any future rule engine that lands after its renderer both
demand graceful miss handling. The forces: (1) the seam must be
renderer-side (app/renderer), pure and unit-testable without Electron/DOM,
so the report-card HTML module can dispatch through it; (2) the key must
be the closed RuleType union from ADR-0028 so gate/phase/gain slot in
without widening; (3) the render input must stay the generic flat
RuleNarrativeData record ADR-0028 fixed, because the gate/phase/gain
engines and their hit shapes do not exist yet; (4) self-registration on
import (each rule type = one standalone module) is what makes "no
per-template global wiring" true — adding a type is adding a file; and
(5) the miss-must-not-throw contract deliberately diverges from
audio-engine's getRuleTemplate, and that divergence must be recorded so
a later author does not "helpfully" make the lookup throw and reintroduce
a report-card crash path.

## Decision

The report card dispatches rule-narrative rendering through a module-scoped
Map<RuleType, RuleRenderer> store in app/renderer/src/
rule-renderer-store.ts. RuleRenderer is (data: RuleNarrativeData) => string.
Each rule-type renderer module (app/renderer/src/rule-renderers/<type>.ts)
registers itself at module top level via registerRuleRenderer(type,
renderer) and registers its own audio-engine template via
registerRuleTemplate (idempotent upsert), making the module self-sufficient.
getRuleRenderer(type) returns RuleRenderer | null — a miss value, never a
throw — for unknown or not-yet-registered rule types. Story 2 renders
through this seam; a new rule type requires adding one module file and
editing nothing else.

## Consequences

Positive: the report card renders fired-rule narrative with zero
per-template wiring and zero crash path; the store and adapters are pure
and unit-tested with no DOM/Electron; gate/phase/gain renderers follow the
identical one-file pattern when their engines land; divergence from
getRuleTemplate's throw is explicit and auditable.
Negative: the {data: RuleNarrativeData} -> string renderer shape is the
locked contract stories 2-4 build against and would require touching all
registered renderers to change; registering templates at adapter import
time moves that side effect from audio-engine's per-render call into the
renderer modules (still idempotent); because nothing consumes the store
until story 2, the adapter modules are import-only (side-effect) units
that must be imported by name for their registration to run — story 2 owns
those imports.

## References

- [ADR-0028 — Rule-narrative text is a deterministic rule-type-keyed template registry and pure {name} placeholder renderer in audio-engine — not an LLM path](docs/adr/0028-rule-narrative-text-is-a-deterministic-rule-type-keyed-template-registry-and-pure-name-placeholder-renderer-in-audio-engine-not-an-llm-path.md)
- [Issue #861](https://github.com/on-par/sound-buddy/issues/861)
- [Parent issue #839](https://github.com/on-par/sound-buddy/issues/839)