# Rule-narrative template registry and renderer ships as a verification-only pass because the feature already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #834 (feat: rule-narrative template registry and
renderer, foundation story 1 of the #375 templating layer) found that the worktree
already contains the complete merged implementation: origin/main carries commit
444a289 "feat: rule-narrative template registry and renderer (#834) (#841)" and the
checkout is up to date with it. Every acceptance criterion — registered templates
retrievable by rule type, render substituting placeholders from data, missing data
keys rendering as the empty string without throwing, and unregistered rule types
failing with an actionable error — is already satisfied by rule-narrative.ts,
exercised by the colocated 74-line rule-narrative.test.ts, re-exported from the
package index for stories 2-6, and recorded in ADR-0028. A from-scratch
re-implementation would collide with the merged code and its tests, and would churn
a fully tested, already-reviewed surface for zero user-visible gain. This is the
same replay situation that #712/#713 resolved with ADR-0025/0026 and #381 with
ADR-0032, now applied to the templating-layer foundation. The BUILD pass therefore
must not re-implement; it verifies and fixes only concrete regressions in place.

## Decision

Drive issue #834's BUILD pass as verification-only: run the issue's verification
commands (npm run lint --prefix app; npm test --prefix app) plus the workspace-wide
gates (npm test; npm run build), confirm every gate is green and each acceptance
criterion holds against the merged code, and make zero code changes unless a specific
gate genuinely fails (then fix that regression in place, never re-port the surface).
Leave rule-narrative.ts, rule-narrative.test.ts, the index re-exports, and ADR-0028
intact as merged; an empty (or ADR-only) PR diff is the correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the merged
implementation (already following ADR-0028) is preserved byte-for-byte; the BUILD
pass is bounded and quick; and the factory's recorded replay convention
(ADR-0025/0026/0032) is extended to the #375 templating layer. Negative: if a gate
fails on an already-merged state, the cause is environmental or a pre-existing
regression and must be root-caused against the merged #841 diff rather than
attributed to new work; the factory must accept a PR whose diff is empty (or
ADR-only) as the correct outcome for this issue; future factory runs must still
check issue state and git history before planning, or the no-op pass would ship in
place of real work.

## References

- [ADR-0028 — Rule-narrative text is a deterministic rule-type-keyed template registry and pure {name} placeholder renderer in audio-engine — not an LLM path](docs/adr/0028-rule-narrative-text-is-a-deterministic-rule-type-keyed-template-registry-and-pure-name-placeholder-renderer-in-audio-engine-not-an-llm-path.md)
- [ADR-0032 — Harshness Rules Engine ships as a verification-only pass because the feature already landed](docs/adr/0032-harshness-rules-engine-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/834)
