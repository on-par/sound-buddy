# Already-closed epic #317 is closed by a second empty no-op verification pass, re-verifying at a newer HEAD

- Status: Accepted
- Date: 2026-08-15

## Context

The factory loop handed issue #317 to the PLAN phase again. The epic was closed as
COMPLETED on 2026-08-14 and its acceptance criteria are already satisfied by merged work
(PRs #792/#805, ADR-0017/0018/0019) that is an ancestor of this checkout's HEAD — and a
prior no-op verification pass (PR #814, commit ce6bbb2) is itself already merged into HEAD,
which has since advanced through the #711 renderer slice (#815) and later no-op passes
(#820-#823). ADR-0019 mandates the empty no-op verification PR for an already-closed epic
but does not address the case where a prior no-op pass already exists; the alternative —
treating #317 as "no work remains, ship nothing" — leaves the orchestrator's handoff
unclosed and re-introduces the ambiguity ADR-0019 exists to remove.

## Decision

#317 gets a fresh empty no-op verification pass even though #814 already exists: the build
re-verifies every acceptance criterion against the current (advanced) HEAD, re-measures
merged statement coverage (≥95%, expected ≈97%), and ships an empty commit 'chore: no-op
verification pass for already-closed epic #317 (100% code coverage — valuable tests, not
vanity metrics)' plus the house-format PR with 'Closes #317'. The PR body names PR #814 as
the prior no-op pass and the newer HEAD ancestors as the re-verification baseline, so the
evidence is exact and self-consistent.

## Consequences

Positive: the orchestrator's handoff is closed; the pass confirms the criteria still hold
after the post-#814 feature slice (#815) and records a freshly measured coverage figure at
the current HEAD instead of a stale one; the empty PR is queryable evidence, consistent
with ADR-0019. Negative: an extra empty commit in history (low cost, matches the #814
precedent); two no-op passes for the same epic require future readers to distinguish the
older (#814) from the re-verification (this PR) by body date and HEAD baseline — mitigated
by making that distinction explicit in the PR body.

## References

- [ADR-0019 — Already-closed epics are closed by an empty no-op verification PR, not re-run](docs/adr/0019-already-closed-epics-are-closed-by-an-empty-no-op-verification-pr-not-re-run.md)
- [ADR-0017 — Coverage epic gains are enforced by per-project threshold ratchets, not a root merged gate](docs/adr/0017-coverage-epic-gains-are-enforced-by-per-project-threshold-ratchets-not-a-root-merged-gate.md)
- [ADR-0018 — Epic-closing PRs record verified completion evidence in docs/epics/ instead of re-running the backlog](docs/adr/0018-epic-closing-prs-record-verified-completion-evidence-in-docs-epics-instead-of-re-running-the-backlog.md)
- [Epic completion record #317](docs/epics/e317-100-code-coverage-valuable-tests-not-vanity-metrics.md)
- [Issue #317](https://github.com/on-par/sound-buddy/issues/317)
