# Rule-narrative text is a deterministic rule-type-keyed template registry and pure {name} placeholder renderer in audio-engine — not an LLM path

- Status: Accepted
- Date: 2026-08-16

## Context

Parent #375 splits rules-to-narrative into six stories; #834 is the
foundation. Before any per-rule-type copy exists (stories 2-5) or any
renderer consumes it (story 6), the seam between structured rule-hit data
(FiredRule[] and the future gate/phase/gain engines) and human-readable
text must be fixed. The forces: (1) the layer must be deterministic and
free of LLM involvement by issue fiat — template-based, not model-based;
(2) rule types are a small closed set (harshness, gate, phase, gain) that
maps naturally to a string-keyed registry; (3) gate/phase/gain engines do
not exist yet, so the registry cannot depend on their data shapes — the
render input must be a generic flat record; (4) the rules engine lives in
the MIT packages/audio-engine module (ADR-0027), so the narrative layer
belongs there, unit-testable without Electron/DOM; and (5) template copy
quality is deferred to the later stories, so this story must not bake in
wording. The placeholder syntax is an arbitrary convention future stories
must follow, which makes recording it worthwhile.

## Decision

Rule-narrative text is produced by a module-scoped Map<RuleType, string>
registry and a pure render function in
packages/audio-engine/src/analyze/rule-narrative.ts. RuleType is the
closed union 'harshness' | 'gate' | 'phase' | 'gain'. Templates are
registered with registerRuleTemplate(type, template) (upsert, idempotent)
and read with getRuleTemplate(type); renderRuleNarrative(type, data)
replaces every {name} placeholder in the template from a flat
RuleNarrativeData record, rendering missing keys and undefined values as
the empty string and never throwing on absent data. An unregistered rule
type fails with an actionable error that names the type and directs the
caller to registerRuleTemplate. The registry ships empty in story 1 —
stories 2-5 register one template each through this API, and story 6
consumes renderRuleNarrative's output. The {name} placeholder syntax is
the binding convention for all future template copy.

## Consequences

Positive: deterministic, unit-testable, zero-cost narrative generation;
a fixed seam stories 2-6 build against; generic over rule types so the
not-yet-existing gate/phase/gain engines slot in without API change.
Negative: an unregistered type (including every type until its story
lands) throws, so story 1 leaves the registry empty in production until
story 2 registers harshness; the {name} syntax and empty-string-on-missing
behavior are locked in and would require rewriting registered templates to
change; the closed RuleType union must be widened in a later PR if a fifth
rule type ever appears.

## References

- [ADR-0027 — Offline harshness rules are a pure data-driven audio-engine module over the fine spectrum curve](docs/adr/0027-offline-harshness-rules-are-a-pure-data-driven-audio-engine-module-over-the-fine-spectrum-curve-separate-from-the-live-7-band-eq-coaching.md)
- [Issue #834](https://github.com/on-par/sound-buddy/issues/834)
