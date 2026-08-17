# Deterministic report-card Troubleshooting section from rule-narrative templates ships as a verification-only re-run because the feature already landed

- Status: Accepted
- Date: 2026-08-17

## Context

The factory's PLAN phase for issue #862 (feat: deterministic report card
Troubleshooting section from rule-narrative templates, story 2 of the #839
report-card Troubleshooting work) found that the worktree already contains
the complete merged implementation: origin/main carries commit 0b4f95f
"feat: deterministic report-card Troubleshooting section from rule-narrative
templates (#862) (#868)", itself later replayed as commit fc2412f (#903),
and the checkout is up to date with it (HEAD b775950 == origin/main, branch
ship-it/862-feat-deterministic-report-card-t, clean tree). Every acceptance
criterion — (1) the section appears on the report card with each hit mapped
to its rule-type template narrative (ReportCardIsland.tsx:415 wiring
evaluateRules hits through the #861 store's 'harshness' renderer,
ReportCard.tsx:285-294 rendering #rc-troubleshooting-section); (2) existing
grading content is unchanged and still present (the section is additive,
asserted alongside rc-metrics-section/rc-why-section/rc-recommendations in
ReportCard.test.ts and ReportCardIsland.test.ts); (3) no LLM call is invoked
(the text is pure renderRuleNarrative template output from rule data, zero
I/O in report-card-troubleshooting.ts, with troubleshootHits([], spy) pinning
that the renderer is never invoked for an empty hit list) — is already
satisfied by the merged code and its #862 test blocks. Three prior
verification-only passes for this exact feature are already recorded as
ADR-0043, ADR-0044, and ADR-0049 (PR #909). A from-scratch
re-implementation would collide with the merged and already
design-reviewed surface for zero user-visible gain. This run follows the
exact precedent set by the sibling stories' third passes at this
checkout's HEAD (#863 as ADR-0050, #864 as ADR-0051, #861 as ADR-0054).
The BUILD pass therefore must not re-implement; it verifies and fixes
only concrete regressions in place.

## Decision

Drive issue #862's BUILD pass as a verification-only re-run: run the
issue's stated verification commands (npm run lint --prefix app; npm test
--prefix app) plus the workspace gates (npm test; npm run build), confirm
every gate is green and each acceptance criterion holds against the
merged implementation and its #862 tests, and make zero code changes
unless a specific gate genuinely fails (then fix that regression in
place, never re-port the section surface). Leave
report-card-troubleshooting.ts, rule-renderer-store.ts, the
rule-renderers/* adapters, ReportCard.tsx, ReportCardIsland.tsx, and the
#862 test files intact as merged; an empty (or ADR-only) PR diff is the
correct outcome. Record ADR-0055 documenting the verification-only
re-run; ADR-0043, ADR-0044, and ADR-0049 already record this same
feature's prior passes and must not be duplicated or amended.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the
merged Troubleshooting-section render path and its #862 tests are
preserved byte-for-byte; the BUILD pass is bounded and quick; and the
factory's recorded replay convention (ADR-0025/0026/0032-0054, including
this feature's own ADR-0043/0044/0049) is continued. Negative: if a gate
fails on an already-merged state, the cause is environmental or a
pre-existing regression and must be root-caused against the merged
#868/#903 diff rather than attributed to new work; the factory must
accept a PR whose diff is empty (or ADR-only) as the correct outcome for
this issue; repeated replay of the same issue grows the ADR index with
near-duplicate verification records, so future factory runs must check
issue state and git history before planning to stop re-driving
already-merged slices.

## References

- [ADR-0049 — Deterministic report-card Troubleshooting section from rule-narrative templates ships as a verification-only re-run because the feature already landed](docs/adr/0049-deterministic-report-card-troubleshooting-section-from-rule-narrative-templates-ships-as-a-verification-only-re-run-because-the-feature-already-landed.md)
- [ADR-0044 — Deterministic report-card Troubleshooting section from rule-narrative templates ships as a verification-only pass because the feature already landed](docs/adr/0044-deterministic-report-card-troubleshooting-section-from-rule-narrative-templates-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0043 — Deterministic report-card Troubleshooting section ships as a verification-only pass because the feature already landed](docs/adr/0043-deterministic-report-card-troubleshooting-section-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/862)