# Graceful no-hits empty state for the Troubleshooting section ships as a verification-only pass because the feature already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #863 (feat: graceful no-hits empty
state for the Troubleshooting section, story 3 of the #839 report-card
Troubleshooting work) found that the worktree already contains the complete
merged implementation: origin/main carries commit fceb5e6 "feat: graceful
no-hits empty state for the report-card Troubleshooting section (#863) (#869)"
and the checkout is up to date with it. Every acceptance criterion — the
no-hits case renders gracefully with no error surfaced (ReportCard.tsx's
empty-length branch rendering TROUBLESHOOTING_EMPTY_MESSAGE in
#rc-troubleshooting-empty) and makes no LLM call with the render path
completing without throwing (troubleshootHits skips the renderer on an empty
hit list; pure view code in report-card-troubleshooting.ts) — is already
satisfied by the merged code and its #863 test blocks in ReportCard.test.ts,
ReportCardIsland.test.ts, and report-card-troubleshooting.test.ts. A
from-scratch re-implementation would collide with the merged and already
design-reviewed surface for zero user-visible gain. This is the same replay
situation that #381/#834/#835/#836/#837/#838/#864 resolved with
ADR-0032–0037/0039, now applied to story 3 of #839. The BUILD pass therefore
must not re-implement; it verifies and fixes only concrete regressions in place.

## Decision

Drive issue #863's BUILD pass as verification-only: run the issue's stated
verification command (npm test --prefix app) plus the workspace gates (npm
run lint --prefix app; npm test; npm run build), confirm every gate is green
and each acceptance criterion holds against the merged implementation and its
#863 tests, and make zero code changes unless a specific gate genuinely fails
(then fix that regression in place, never re-port the empty-state surface).
Leave report-card-troubleshooting.ts, ReportCard.tsx, ReportCardIsland.tsx,
and the three #863 test files intact as merged; an empty (or ADR-only) PR
diff is the correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the merged
empty-state render path and its #863 tests are preserved byte-for-byte; the
BUILD pass is bounded and quick; and the factory's recorded replay convention
(ADR-0025/0026/0032–0037/0039) is extended to story 3 of #839. Negative: if a
gate fails on an already-merged state, the cause is environmental or a
pre-existing regression and must be root-caused against the merged #869 diff
rather than attributed to new work; the factory must accept a PR whose diff is
empty (or ADR-only) as the correct outcome for this issue; future factory runs
must still check issue state and git history before planning, or the no-op
pass would ship in place of real work.

## References

- [ADR-0039 — Carve-out compliance gate for the Troubleshooting section ships as a verification-only pass because the feature already landed](docs/adr/0039-carve-out-compliance-gate-for-the-troubleshooting-section-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0033 — Rule-narrative template registry and renderer ships as a verification-only pass because the feature already landed](docs/adr/0033-rule-narrative-template-registry-and-renderer-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/863)