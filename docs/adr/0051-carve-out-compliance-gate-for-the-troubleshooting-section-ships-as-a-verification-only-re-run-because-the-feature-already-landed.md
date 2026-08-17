# Carve-out compliance gate for the Troubleshooting section ships as a verification-only re-run because the feature already landed

- Status: Accepted
- Date: 2026-08-17

## Context

The factory's PLAN phase for issue #864 (feat: carve-out compliance gate for the
Troubleshooting section, story 4/final of the #839 report-card Troubleshooting
work) found that the worktree already contains the complete merged
implementation: origin/main carries commit 16f5f13 "feat: carve-out compliance
gate for the Troubleshooting section (#864) (#873)" and the checkout is up to
date with it (HEAD 504ee38 == origin/main, branch
ship-it/864-feat-carve-out-compliance-gate-f, clean tree). Every acceptance
criterion — (1) the carve-out gate scan across UI and settings finds no AI panel
and no AI setting (the #657 removed-surface scan now spread over the eight
TROUBLESHOOTING_FILES plus App.tsx, SettingsPanel.tsx, styles, and stores, and
the electron #659 scan of every .ts under app/electron for aiEnabled/AI_ENABLED);
(2) the carve-out gate scan across CLI flags finds no AI CLI flag
(packages/cli/src/ai-carveout-gate.test.ts scanning every .ts under
packages/cli/src for the removed AI flag/symbol names, asserting the #661-deleted
insights modules stay absent and no @earendil-scoped dependency in
packages/cli/package.json); (3) the gate tests pass against the app with the
Troubleshooting section present (the #864 describe block scanning all eight
section files for AI-configuration and network tokens, with the section's file
list declared once as TROUBLESHOOTING_FILES and reused by the #657 scan) — is
already satisfied by the merged gate tests. A from-scratch re-implementation
would collide with the merged and already design-reviewed tests for zero
user-visible gain. The factory has already shipped two verification-only passes
for this issue as ADR-0039 (PR #896) and ADR-0046 (PR #905); this third run
follows the exact precedent set by #862's third pass, recorded as ADR-0049, and
#863's third pass, recorded as ADR-0050, at this checkout's HEAD. The BUILD
pass therefore must not re-implement; it verifies and fixes only concrete
regressions in place.

## Decision

Drive issue #864's BUILD pass as a verification-only re-run: run the issue's
stated verification commands (npm run lint --prefix app; npm test --prefix app;
npm test) plus the workspace build gate (npm run build), confirm every gate is
green and each acceptance criterion holds against the merged gate tests, and
make zero code changes unless a specific gate genuinely fails (then fix that
regression in place, never re-port the gate surface). Leave
app/renderer/src/ai-carveout-gate.test.ts, app/electron/ai-carveout-gate.test.ts,
and packages/cli/src/ai-carveout-gate.test.ts intact as merged; record ADR-0051
documenting the verification-only re-run; ADR-0039 (the first #864 pass) and
ADR-0046 (the second) are already recorded and must not be duplicated or
amended. An empty (or ADR-only) PR diff is the correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the
merged gate tests (already covering the #657, #658/#659, #660, #661, and
#864 layers) are preserved byte-for-byte; the BUILD pass is bounded and
quick; and the factory's recorded replay convention
(ADR-0025/0026/0032-0050) is extended to this third #864 re-run. Negative:
if a gate fails on an already-merged state, the cause is environmental or a
pre-existing regression and must be root-caused against the merged #873
diff rather than attributed to new work; the factory must accept a PR whose
diff is empty (or ADR-only) as the correct outcome for this issue; repeated
replay of the same issue grows the ADR index with near-duplicate
verification records, so future factory runs must check issue state and
git history before planning to stop re-driving already-merged slices.

## References

- [ADR-0046 — Carve-out compliance gate for the Troubleshooting section ships as a verification-only re-run because the feature already landed (the prior #864 re-run this pass re-runs)](docs/adr/0046-carve-out-compliance-gate-for-the-troubleshooting-section-ships-as-a-verification-only-re-run-because-the-feature-already-landed.md)
- [ADR-0039 — Carve-out compliance gate for the Troubleshooting section ships as a verification-only pass because the feature already landed (the first #864 pass)](docs/adr/0039-carve-out-compliance-gate-for-the-troubleshooting-section-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0050 — Graceful no-hits empty state for the Troubleshooting section ships as a verification-only re-run because the feature already landed (the #863 third-pass precedent this run mirrors)](docs/adr/0050-graceful-no-hits-empty-state-for-the-troubleshooting-section-ships-as-a-verification-only-re-run-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/864)