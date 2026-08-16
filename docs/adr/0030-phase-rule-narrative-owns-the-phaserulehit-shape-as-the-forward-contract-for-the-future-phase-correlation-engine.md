# Phase-rule narrative owns the PhaseRuleHit shape as the forward contract for the future phase-correlation engine

- Status: Accepted
- Date: 2026-08-16

## Context

Story 4 of #375 (#837) must register a 'phase' template and populate it
from a phase-rule hit's measured data (the issue names "channels,
frequency range, polarity"). Unlike story 2 (#835), which consumed the
landed FiredRule type from the harshness engine (#381), no
phase-correlation engine exists anywhere in the repo, and no phase rule
is in the current backlog. ADR-0028 deliberately kept the #834 registry
generic ("gate/phase/gain engines do not exist yet, so the registry
cannot depend on their data shapes"), so the story's adapter cannot
import a hit type that exists — the same bind ADR-0029 resolved for the
gate story. Yet the acceptance criteria require the narrative to be
populated from the hit's measured values, so the module must define what
a phase hit is before the engine that produces it exists.

## Decision

phase-narrative.ts defines and exports PhaseRuleHit { channelA: string;
channelB: string; lowHz: number; highHz: number; polarity: string;
instruction: string } as the single typed input to the phase narrative,
and phaseNarrativeData flattens it to the ADR-0028 flat RuleNarrativeData
record (band rendered via the shared formatBandRange). The future
phase-correlation engine is expected to emit this shape; if that engine's
analysis differs, the adapter (and only the adapter, not the #834
registry seam) changes in the same PR as the engine. Story 6 consumes
renderPhaseNarrative(hit), not the raw record.

## Consequences

Positive: story 4 is buildable and testable before the phase-correlation
engine exists; the template's placeholder keys are pinned by this module;
story 6 gets a stable, typed renderPhaseNarrative API. Negative: the
shape is speculative until the phase engine lands — if that engine
measures different quantities (e.g., a correlation coefficient instead of
a plain-language polarity label, a single band edge rather than a range,
channel pairs that need more than two identifiers), PhaseRuleHit's
fields, the template copy, and the tests must be revised in that engine's
PR.

## References

- [ADR-0028 — Rule-narrative text is a deterministic rule-type-keyed template registry and pure {name} placeholder renderer in audio-engine — not an LLM path](docs/adr/0028-rule-narrative-text-is-a-deterministic-rule-type-keyed-template-registry-and-pure-name-placeholder-renderer-in-audio-engine-not-an-llm-path.md)
- [ADR-0029 — Gate-rule narrative owns the GateRuleHit shape as the forward contract for the future gate-attack engine](docs/adr/0029-gate-rule-narrative-owns-the-gaterulehit-shape-as-the-forward-contract-for-the-future-gate-attack-engine.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/837)
- [Parent](https://github.com/on-par/sound-buddy/issues/375)