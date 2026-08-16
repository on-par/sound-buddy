# Gain-rule narrative template ships as a verification-only pass because the feature already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #838 (feat: gain-rule narrative template,
story 5 of the #375 templating layer) found that the worktree already contains the
complete merged implementation: origin/main carries commit f748416 "feat: gain-rule
narrative template (#838) (#851)" and the checkout is up to date with it. Every
acceptance criterion — template registered under 'gain' in the #834 registry,
narrative populated from data and differing per hit, and prose that describes the
gain issue in plain language — is already satisfied by gain-narrative.ts
(self-registering render through registerRuleTemplate, GainRuleHit → flat-data
adapter deriving distance/direction from the measured level vs target and
pre-formatting dB values via fmt), exercised by the colocated 91-line
gain-narrative.test.ts, re-exported from the audio-engine package index for story 6
and the CLI, and recorded in its own design ADR-0031 (the GainRuleHit forward
contract for the future gain-rule engine, ADR-0028 keeping the registry generic). A
from-scratch re-implementation would collide with the merged code and its tests,
and would churn a fully tested, already-reviewed surface for zero user-visible
gain. This is the same replay situation that #837 resolved with ADR-0036, #836
with ADR-0035, #835 with ADR-0034, #834 with ADR-0033, #381 with ADR-0032, and
#712/#713 with ADR-0025/0026. The BUILD pass therefore must not re-implement; it
verifies and fixes only concrete regressions in place.

## Decision

Drive issue #838's BUILD pass as verification-only: run the issue's verification
commands (npm test --prefix app; npm test) plus the workspace-wide gates (npm run
lint --prefix app; npm run build), confirm every gate is green and each acceptance
criterion holds against the merged code, and make zero code changes unless a specific
gate genuinely fails (then fix that regression in place, never re-port the surface).
Leave gain-narrative.ts, gain-narrative.test.ts, the index re-exports, and
ADR-0028/0031/0033/0034/0035/0036 intact as merged; an empty (or ADR-only) PR diff
is the correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the merged
implementation (already following ADR-0028's registry seam and its own ADR-0031
data contract) is preserved byte-for-byte; the BUILD pass is bounded and quick; and
the factory's recorded replay convention (ADR-0025/0026/0032/0033/0034/0035/0036)
is extended to the gain narrative story.
Negative: if a gate fails on an already-merged state, the cause is environmental or a
pre-existing regression and must be root-caused against the merged #851 diff rather
than attributed to new work; the factory must accept a PR whose diff is empty (or
ADR-only) as the correct outcome for this issue; future factory runs must still check
issue state and git history before planning, or the no-op pass would ship in place of
real work.

## References

- [ADR-0028 — Rule-narrative text is a deterministic rule-type-keyed template registry and pure {name} placeholder renderer in audio-engine — not an LLM path](docs/adr/0028-rule-narrative-text-is-a-deterministic-rule-type-keyed-template-registry-and-pure-name-placeholder-renderer-in-audio-engine-not-an-llm-path.md)
- [ADR-0031 — Gain-rule narrative owns the GainRuleHit shape as the forward contract for the future gain-rule engine](docs/adr/0031-gain-rule-narrative-owns-the-gainrulehit-shape-as-the-forward-contract-for-the-future-gain-rule-engine.md)
- [ADR-0036 — Phase-rule narrative template ships as a verification-only pass because the feature already landed](docs/adr/0036-phase-rule-narrative-template-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0035 — Gate-rule narrative template ships as a verification-only pass because the feature already landed](docs/adr/0035-gate-rule-narrative-template-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0034 — Harshness-rule narrative template ships as a verification-only pass because the feature already landed](docs/adr/0034-harshness-rule-narrative-template-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0033 — Rule-narrative template registry and renderer ships as a verification-only pass because the feature already landed](docs/adr/0033-rule-narrative-template-registry-and-renderer-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/838)
