# Skill-Tree Onboarding (full progression system, deferred) ships as a verification-only pass because the feature already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #382 (feat: Skill-Tree Onboarding, full
progression system, deferred — P3 mvp-deferred at council time) found that the
worktree already contains the complete merged implementation: origin/main
carries commit cef01c7 "feat: Skill-Tree Onboarding (full progression system,
deferred) (#382) (#899)" (PR #899, "Closes #382") and the checkout is up to
date with it (HEAD c90fd79 == origin/main). The merged PR delivers every
acceptance criterion: the nine-branch skill tree in the literal MxU teaching
order (app/renderer/skill-tree-state.js's SKILL_TREE), authored content on all
27 levels (non-empty title/body/tip each), localStorage-backed progress
tracking under the versioned KEY sb-skill-tree-progress-v1 via pure
Storage-injected functions (loadProgress/saveProgress/completeLevel/
nextLevelId), derived badges (one per fully completed branch, never stored), a
Zustand store wrapper (skillTreeStore.ts), the SkillTreeDialog portal rendering
tree/content/progress/badges into #skill-tree-island, and the Help ▸ "Skill
Tree…" menu-push entry (main.ts / preload.ts / ipc/api.ts / bridge.ts) — all
content-only with no console integration and no adaptive AI, and with #374's
build-order-state.js / BuildGuidePanel.tsx untouched. Colocated unit tests
(skill-tree-state.test.js, skillTreeStore.test.ts, SkillTreeDialog.test.ts) and
the utility-dialogs.spec.ts named gate prove the behavior. A from-scratch
re-implementation would collide with the merged and already design-reviewed
surface for zero user-visible gain. This is the same replay situation that
#381/#834/#835/#836/#837/#838/#861/#862/#863/#864 resolved with
ADR-0025/0026/0032–0037/0039–0046, now applied to #382 as its first factory
pass. The BUILD pass therefore must not re-implement; it verifies and fixes
only concrete regressions in place.

## Decision

Drive issue #382's BUILD pass as verification-only: run the issue's
verification plus the workspace gates (npm run lint --prefix app; npm test
--prefix app; npm test; npm run build), confirm every acceptance criterion
holds against the merged implementation and its tests — MxU teaching order end
to end, content on every level, progress tracking through the tree, badge
awarding from completed levels, no adaptive AI, and #374 unaffected — and make
zero code changes unless a specific gate genuinely fails (then fix that
regression in place, never re-port the skill-tree surface). Leave
skill-tree-state.js, skillTreeStore.ts, SkillTreeDialog.tsx, App.tsx, main.ts,
preload.ts, ipc/api.ts, index.html, the three colocated skill-tree test files,
and utility-dialogs.spec.ts intact as merged; record ADR-0047 documenting the
verification-only pass. An empty (or ADR-only) PR diff is the correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the merged
skill-tree implementation and its tests are preserved byte-for-byte; the BUILD
pass is bounded and quick; and the factory's recorded replay convention
(ADR-0025/0026/0032–0037/0039–0046) is extended to #382. Negative: if a gate
fails on an already-merged state, the cause is environmental or a pre-existing
regression and must be root-caused against the merged #899 diff rather than
attributed to new work; the factory must accept a PR whose diff is empty (or
ADR-only) as the correct outcome for this issue; future factory runs must still
check issue state and git history before planning, or the no-op pass would ship
in place of real work.

## References

- [ADR-0032 — Harshness Rules Engine ships as a verification-only pass because the feature already landed](docs/adr/0032-harshness-rules-engine-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0040 — Graceful no-hits empty state for the Troubleshooting section ships as a verification-only pass because the feature already landed](docs/adr/0040-graceful-no-hits-empty-state-for-the-troubleshooting-section-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/382)