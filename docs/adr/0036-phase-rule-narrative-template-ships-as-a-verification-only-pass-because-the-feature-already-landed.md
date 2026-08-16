# Phase-rule narrative template ships as a verification-only pass because the feature already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #837 (feat: phase-rule narrative template,
story 4 of the #375 templating layer) found that the worktree already contains the
complete merged implementation: origin/main carries commit 61ae713 "feat: phase-rule
narrative template (#837) (#845)" and the checkout is up to date with it. Every
acceptance criterion — template registered under 'phase' in the #834 registry,
narrative populated from data and differing per hit, and prose that describes the
phase issue in plain language — is already satisfied by phase-narrative.ts
(self-registering render through registerRuleTemplate, PhaseRuleHit → flat-data
adapter formatting the measured band edges via the shared band-format.ts formatter
extracted from #835), exercised by the colocated 92-line phase-narrative.test.ts,
re-exported from the audio-engine package index for story 6 and the CLI, and
recorded in its own design ADR-0030 (the PhaseRuleHit forward contract for the
future phase-correlation engine, ADR-0028 keeping the registry generic). A
from-scratch re-implementation would collide with the merged code and its tests,
and would churn a fully tested, already-reviewed surface for zero user-visible
gain. This is the same replay situation that #836 resolved with ADR-0035, #835
with ADR-0034, #834 with ADR-0033, #381 with ADR-0032, and #712/#713 with
ADR-0025/0026. The BUILD pass therefore must not re-implement; it verifies and
fixes only concrete regressions in place.

## Decision

Drive issue #837's BUILD pass as verification-only: run the issue's verification
commands (npm test --prefix app; npm test) plus the workspace-wide gates (npm run
lint --prefix app; npm run build), confirm every gate is green and each acceptance
criterion holds against the merged code, and make zero code changes unless a specific
gate genuinely fails (then fix that regression in place, never re-port the surface).
Leave phase-narrative.ts, phase-narrative.test.ts, band-format.ts, the index
re-exports, and ADR-0028/0030/0033/0034/0035 intact as merged; an empty (or ADR-only)
PR diff is the correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the merged
implementation (already following ADR-0028's registry seam, its own ADR-0030 data
contract, and the shared band-format.ts label formatter) is preserved byte-for-byte;
the BUILD pass is bounded and quick; and the factory's recorded replay convention
(ADR-0025/0026/0032/0033/0034/0035) is extended to the phase narrative story.
Negative: if a gate fails on an already-merged state, the cause is environmental or a
pre-existing regression and must be root-caused against the merged #845 diff rather
than attributed to new work; the factory must accept a PR whose diff is empty (or
ADR-only) as the correct outcome for this issue; future factory runs must still check
issue state and git history before planning, or the no-op pass would ship in place of
real work.

## References

- [ADR-0028 — Rule-narrative text is a deterministic rule-type-keyed template registry and pure {name} placeholder renderer in audio-engine — not an LLM path](docs/adr/0028-rule-narrative-text-is-a-deterministic-rule-type-keyed-template-registry-and-pure-name-placeholder-renderer-in-audio-engine-not-an-llm-path.md)
- [ADR-0030 — Phase-rule narrative owns the PhaseRuleHit shape as the forward contract for the future phase-correlation engine](docs/adr/0030-phase-rule-narrative-owns-the-phaserulehit-shape-as-the-forward-contract-for-the-future-phase-correlation-engine.md)
- [ADR-0035 — Gate-rule narrative template ships as a verification-only pass because the feature already landed](docs/adr/0035-gate-rule-narrative-template-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0034 — Harshness-rule narrative template ships as a verification-only pass because the feature already landed](docs/adr/0034-harshness-rule-narrative-template-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0033 — Rule-narrative template registry and renderer ships as a verification-only pass because the feature already landed](docs/adr/0033-rule-narrative-template-registry-and-renderer-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/837)
