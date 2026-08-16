# Gate-rule narrative owns the GateRuleHit shape as the forward contract for the future gate-attack engine

- Status: Accepted
- Date: 2026-08-16

## Context

Story 3 of #375 (#836) must register a 'gate' template and populate it
from a gate-rule hit's measured data (the issue names "open/close
behavior, timing, thresholds"). Unlike story 2 (#835), which consumed the
landed FiredRule type from the harshness engine (#381), no gate-attack
engine exists anywhere in the repo, and the #9 "gate attack" rule is not
in the current backlog. ADR-0028 deliberately kept the #834 registry
generic ("gate/phase/gain engines do not exist yet, so the registry
cannot depend on their data shapes"), so the story's adapter cannot
import a hit type that exists. Yet the acceptance criteria require the
narrative to be populated from the hit's measured values, so the module
must define what a gate hit is before the engine that produces it exists.

## Decision

gate-narrative.ts defines and exports GateRuleHit { behavior: string;
timingMs: number; thresholdDb: number; instruction: string } as the single
typed input to the gate narrative, and gateNarrativeData flattens it to
the ADR-0028 flat RuleNarrativeData record. The future gate-attack engine
is expected to emit this shape; if that engine's analysis differs, the
adapter (and only the adapter, not the #834 registry seam) changes in the
same PR as the engine. Story 6 consumes renderGateNarrative(hit), not the
raw record.

## Consequences

Positive: story 3 is buildable and testable before the gate-attack engine
exists; the template's placeholder keys are pinned by this module; story 6
gets a stable, typed renderGateNarrative API. Negative: the shape is
speculative until the gate-attack engine lands — if that engine measures
different quantities (e.g., separate attack/release times, a range rather
than a single response time, different units), GateRuleHit's fields, the
template copy, and the tests must be revised in that engine's PR.

## References

- [ADR-0028 — Rule-narrative text is a deterministic rule-type-keyed template registry and pure {name} placeholder renderer in audio-engine — not an LLM path](docs/adr/0028-rule-narrative-text-is-a-deterministic-rule-type-keyed-template-registry-and-pure-name-placeholder-renderer-in-audio-engine-not-an-llm-path.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/836)
- [Parent](https://github.com/on-par/sound-buddy/issues/375)
