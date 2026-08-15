# Already-closed epics are closed by an empty no-op verification PR, not re-run

- Status: Accepted
- Date: 2026-08-15

## Context

The software factory loop picks up epics from the backlog by number. Issue #317 is a coverage epic whose acceptance criteria were already fully satisfied by accumulated, merged work: the AI carve-out (#659) deleted four of the issue's named files, PR #792 shipped the last colocated tests and ratcheted every per-project coverage floor (ADR-0017), and PR #805 committed the repo-homed completion record asserting every criterion (merged statements 97.21% vs the ≥95% target). Re-planning the epic's original scope would fabricate duplicate test work, which ADR-0018 forbids. The factory needs a repeatable, documented convention for the specific case where an epic is already closed in the tree: three prior no-op passes (#806, #804, #807) were shipped as empty commits, but the convention was never written down as an ADR.

## Decision

When a factory PLAN phase discovers that an epic issue's acceptance criteria are already fully satisfied in the checkout (its merged PRs and, where one exists, its docs/epics completion record are ancestors of the current HEAD), the worker ships an empty commit titled 'chore: no-op verification pass for already-closed epic #<N>' and opens the house-format PR with 'Closes #<N>'. The verification evidence is recorded in the PR body (git log hashes of the merged epic PR and completion record, the per-project floor grep, the deleted-file absence check), backed by './scripts/verify.sh --no-e2e'. No product code, test, coverage-config, or doc file changes. This complements ADR-0018, which governs the case where a completion record must still be written; this ADR governs the case where it already exists.

## Consequences

Positive: the factory stops re-planning closed epics; closed epics get a queryable, empty, evidence-bearing closing PR; the verify gate still runs so a genuinely broken main is surfaced rather than masked by a doc-only close. Negative: an empty PR has no code diff to review, so the PR body's verification evidence must be exact (wrong hashes or numbers would be recorded as truth); future factory runs must still check issue state and git history before planning an epic, or the no-op pass would be shipped in place of real work.

## References

- [ADR-0018 — Epic-closing PRs record verified completion evidence in docs/epics/ instead of re-running the backlog](docs/adr/0018-epic-closing-prs-record-verified-completion-evidence-in-docs-epics-instead-of-re-running-the-backlog.md)
- [Epic](docs/epics/e317-100-code-coverage-valuable-tests-not-vanity-metrics.md)
- [Issue #317](https://github.com/on-par/sound-buddy/issues/317)
