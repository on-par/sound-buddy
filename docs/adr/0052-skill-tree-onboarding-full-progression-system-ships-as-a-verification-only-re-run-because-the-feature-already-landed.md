# Skill-Tree Onboarding (full progression system, deferred) ships as a verification-only re-run because the feature already landed

- Status: Accepted
- Date: 2026-08-17

## Context

The factory's PLAN phase for issue #382 (feat: Skill-Tree Onboarding, full
progression system, deferred — P3 mvp-deferred at council time, closed on
GitHub) found that the worktree already contains the complete merged
implementation: origin/main carries commit cef01c7 "feat: Skill-Tree Onboarding
(full progression system, deferred) (#382) (#899)" (PR #899, "Closes #382")
and the checkout is up to date with it (HEAD 3778f76 == origin/main, branch
ship-it/382-feat-skill-tree-onboarding-full, clean tree). Every acceptance
criterion is already satisfied by the merged PR: the nine-branch skill tree in
the literal MxU teaching order (app/renderer/skill-tree-state.js's SKILL_TREE),
authored content on all 27 levels (non-empty title/body/tip each),
localStorage-backed progress tracking under the versioned KEY
sb-skill-tree-progress-v1 via pure Storage-injected functions
(loadProgress/saveProgress/completeLevel/nextLevelId), derived badges (one per
fully completed branch, never stored), a Zustand store wrapper
(skillTreeStore.ts), the SkillTreeDialog portal rendering
tree/content/progress/badges into #skill-tree-island, and the Help ▸ "Skill
Tree…" menu-push entry (main.ts / preload.ts / ipc/api.ts) — all content-only
with no console integration and no adaptive AI, and with #374's
build-order-state.js / BuildGuidePanel.tsx untouched. Colocated unit tests
(skill-tree-state.test.js, skillTreeStore.test.ts, SkillTreeDialog.test.ts) and
the utility-dialogs.spec.ts named gate prove the behavior. The factory's first
pass for this issue already shipped as ADR-0047 (PR #906); this second run
follows the exact re-run precedent set by #861/#862/#863/#864's repeats
(ADR-0046/0048/0049/0050/0051). A from-scratch re-implementation would collide
with the merged and already design-reviewed surface for zero user-visible gain.
The BUILD pass therefore must not re-implement; it verifies and fixes only
concrete regressions in place.

## Decision

Drive issue #382's BUILD pass as a verification-only re-run: run the workspace
gates (npm run lint --prefix app; npm test --prefix app; npm test; npm run
build), confirm every gate is green and each of the six acceptance criteria
holds against the merged implementation and its tests — MxU teaching order end
to end, content on every level, progress tracking through the tree, badge
awarding from completed levels, no adaptive AI, and #374 unaffected — and make
zero code changes unless a specific gate genuinely fails (then fix that
regression in place, never re-port the skill-tree surface). Leave
skill-tree-state.js, skillTreeStore.ts, SkillTreeDialog.tsx, App.tsx, main.ts,
preload.ts, ipc/api.ts, index.html, the three colocated skill-tree test files,
and utility-dialogs.spec.ts intact as merged; record ADR-0052 documenting the
verification-only re-run; ADR-0047 (the first #382 pass) is already recorded
and must not be duplicated or amended. An empty (or ADR-only) PR diff is the
correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the merged
skill-tree implementation and its tests are preserved byte-for-byte; the BUILD
pass is bounded and quick; and the factory's recorded replay convention
(ADR-0025/0026/0032-0051) is extended to this second #382 run. Negative: if a
gate fails on an already-merged state, the cause is environmental or a
pre-existing regression and must be root-caused against the merged #899 diff
rather than attributed to new work; the factory must accept a PR whose diff is
empty (or ADR-only) as the correct outcome for this issue; repeated replay of
the same issue grows the ADR index with near-duplicate verification records, so
future factory runs must check issue state and git history before planning to
stop re-driving already-merged slices.

## References

- [ADR-0047 — Skill-Tree Onboarding (full progression system, deferred) ships as a verification-only pass because the feature already landed (the prior #382 pass this run re-runs)](docs/adr/0047-skill-tree-onboarding-full-progression-system-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0051 — Carve-out compliance gate for the Troubleshooting section ships as a verification-only re-run because the feature already landed (the #864 third-pass precedent this run mirrors)](docs/adr/0051-carve-out-compliance-gate-for-the-troubleshooting-section-ships-as-a-verification-only-re-run-because-the-feature-already-landed.md)
- [ADR-0050 — Graceful no-hits empty state for the Troubleshooting section ships as a verification-only re-run because the feature already landed](docs/adr/0050-graceful-no-hits-empty-state-for-the-troubleshooting-section-ships-as-a-verification-only-re-run-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/382)