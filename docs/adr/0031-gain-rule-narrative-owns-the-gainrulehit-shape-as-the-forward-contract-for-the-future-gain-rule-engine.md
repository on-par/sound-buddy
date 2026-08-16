# Gain-rule narrative owns the GainRuleHit shape as the forward contract for the future gain-rule engine

- Status: Accepted
- Date: 2026-08-16

## Context

Story 5 of #375 (#838) must register a 'gain' template and populate it
from a gain-rule hit's measured data (the issue names "channel, level,
target"). Unlike story 2 (#835), which consumed the landed FiredRule type
from the harshness engine (#381), no gain rule exists in the rules sense
— rules.ts (#381) is the spectral harshness engine only. ADR-0028 kept
the #834 registry generic ("gate/phase/gain engines do not exist yet, so
the registry cannot depend on their data shapes"), the same bind
ADR-0029 (gate) and ADR-0030 (phase) resolved by letting the narrative
module define the hit type as a forward contract. One wrinkle is unique
to gain: a gain *measurement* module does exist — gain-structure.ts
(#369) reads each channel's RMS against the -18 dBFS target and labels it
"hot"/"cold"/"healthy"/"silent". The acceptance criteria still require
the narrative to be populated from the hit's measured values, so the
module must define what a gain hit is, and that shape should stay
aligned with the existing #369 vocabulary so the future engine's adapter
is field-for-field rather than a redesign.

## Decision

gain-narrative.ts defines and exports GainRuleHit { channel: string;
levelDbfs: number; targetDbfs: number; status: "hot" | "cold";
instruction: string } as the single typed input to the gain narrative,
and gainNarrativeData flattens it to the ADR-0028 flat RuleNarrativeData
record (dB values pre-formatted via fmt; distance/direction derived from
level vs target). The status union and target convention deliberately
mirror gain-structure.ts's GainStatus ("hot"/"cold") and GAIN_TARGET_DBFS
(-18 dBFS). The future gain-rule engine is expected to emit this shape
(or a thin adapter over ChannelGainHealth maps onto it); if that engine's
analysis differs, the adapter (and only the adapter, not the #834
registry seam) changes in the same PR as the engine. Story 6 consumes
renderGainNarrative(hit), not the raw record.

## Consequences

Positive: story 5 is buildable and testable before a gain-rule engine
exists; the template's placeholder keys are pinned by this module; story
6 gets a stable, typed renderGainNarrative API consistent with
renderGateNarrative and renderPhaseNarrative; the hit shape stays
compatible with the #369 vocabulary it will be populated from. Negative:
the shape is speculative until the gain engine lands — if that engine
measures different quantities (e.g., a peak-based rather than RMS-based
level, a per-instrument target instead of the fixed -18 dBFS, or a
"silent" status it wants narrated), GainRuleHit's fields, the template
copy, and the tests must be revised in that engine's PR.

## References

- [ADR-0028 — Rule-narrative text is a deterministic rule-type-keyed template registry and pure {name} placeholder renderer in audio-engine — not an LLM path](docs/adr/0028-rule-narrative-text-is-a-deterministic-rule-type-keyed-template-registry-and-pure-name-placeholder-renderer-in-audio-engine-not-an-llm-path.md)
- [ADR-0029 — Gate-rule narrative owns the GateRuleHit shape as the forward contract for the future gate-attack engine](docs/adr/0029-gate-rule-narrative-owns-the-gaterulehit-shape-as-the-forward-contract-for-the-future-gate-attack-engine.md)
- [ADR-0030 — Phase-rule narrative owns the PhaseRuleHit shape as the forward contract for the future phase-correlation engine](docs/adr/0030-phase-rule-narrative-owns-the-phaserulehit-shape-as-the-forward-contract-for-the-future-phase-correlation-engine.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/838)
- [Parent](https://github.com/on-par/sound-buddy/issues/375)
