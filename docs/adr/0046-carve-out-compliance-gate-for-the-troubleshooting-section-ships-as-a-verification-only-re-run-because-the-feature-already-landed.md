# Carve-out compliance gate for the Troubleshooting section ships as a verification-only re-run because the feature already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #864 (feat: carve-out compliance gate for the
Troubleshooting section, story 4/final of the #839 report-card Troubleshooting
work) found that the worktree already contains the complete merged
implementation: origin/main carries commit 16f5f13 "feat: carve-out compliance
gate for the Troubleshooting section (#864) (#873)" and the checkout is up to
date with it. Every acceptance criterion — no AI panel / no AI setting across UI
and settings, no AI CLI flag, and the gate tests passing against the app with
the Troubleshooting section present — is already satisfied by the merged
extensions to app/renderer/src/ai-carveout-gate.test.ts (a #864 describe block
scanning all eight #839 section files for AI-configuration and network tokens,
with the section's file list declared once as TROUBLESHOOTING_FILES and reused
by the #657 removed-surface scan) and by the new
packages/cli/src/ai-carveout-gate.test.ts (#661 gate: every .ts under
packages/cli/src scanned for removed AI flag/symbol names, the #661-deleted
insights modules asserted absent, and no @earendil-scoped dependency in
packages/cli/package.json). A from-scratch re-implementation would collide with
the merged and already design-reviewed tests for zero user-visible gain. The
factory has already shipped one verification-only pass for this issue as
ADR-0039 (PR #896); this second run follows the exact re-run pattern established
by #861 (ADR-0041 then ADR-0042), #862 (ADR-0043 then ADR-0044), and #863
(ADR-0040 then ADR-0045). The BUILD pass therefore must not re-implement; it
verifies and fixes only concrete regressions in place.

## Decision

Drive issue #864's BUILD pass as a verification-only re-run: run the issue's
stated verification commands (npm run lint --prefix app; npm test --prefix app;
npm test) plus the workspace build gate (npm run build), confirm every gate is
green and each acceptance criterion holds against the merged gate tests, and
make zero code changes unless a specific gate genuinely fails (then fix that
regression in place, never re-port the gate surface). Leave
app/renderer/src/ai-carveout-gate.test.ts and packages/cli/src/ai-carveout-gate.test.ts
intact as merged; record ADR-0046 documenting the verification-only re-run;
ADR-0039 (the first #864 pass) is already recorded and must not be duplicated.
An empty (or ADR-only) PR diff is the correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the merged
gate tests (already covering the #657, #658/#659, #660, #661, and #864 layers)
are preserved byte-for-byte; the BUILD pass is bounded and quick; and the
factory's recorded replay convention (ADR-0025/0026/0032-0045) is extended to
the #864 re-run. Negative: if a gate fails on an already-merged state, the
cause is environmental or a pre-existing regression and must be root-caused
against the merged #873 diff rather than attributed to new work; the factory
must accept a PR whose diff is empty (or ADR-only) as the correct outcome for
this issue; future factory runs must still check issue state and git history
before planning, or the no-op pass would ship in place of real work.

## References

- [ADR-0039 — Carve-out compliance gate for the Troubleshooting section ships as a verification-only pass because the feature already landed](docs/adr/0039-carve-out-compliance-gate-for-the-troubleshooting-section-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0045 — Graceful no-hits empty state for the Troubleshooting section ships as a verification-only re-run because the feature already landed (the #863 re-run this pass mirrors)](docs/adr/0045-graceful-no-hits-empty-state-for-the-troubleshooting-section-ships-as-a-verification-only-re-run-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/864)