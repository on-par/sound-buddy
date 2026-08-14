# Epic-closing PRs record verified completion evidence in docs/epics/ instead of re-running the backlog

- Status: Accepted
- Date: 2026-08-14

## Context

Issue #383 is a tracking epic whose ten mvp-in sub-issues were all already shipped and
closed (COMPLETED) by earlier factory runs under their own issue numbers, several of them with
the epic transcript's numbers swapped against the actual GitHub issue titles. The epic itself
remained open with no code left to build. The #317 epic set the precedent that an epic is
closed by a PR whose diff is the proof — but unlike #317 there is no residual test/code tail
here, so the factory needed a documented, verifiable convention for closing an already-satisfied
tracking epic without fabricating duplicate work.

## Decision

An epic whose acceptance criteria are already fully satisfied by previously merged sub-issue
PRs is closed by a single verification PR that (a) asserts every criterion from the checkout
(git log for the merged PRs, gh issue state, file reads for the features and governing
conditions), (b) records the issue→PR→feature-file mapping in a completion record under
docs/epics/, and (c) carries `Closes #<epic>` in the body. No sub-issue is re-implemented or
re-queued, and no product code changes. Discrepancies between an epic transcript and the
actual issue titles are recorded in the completion record, not escalated, when every feature
shipped and the dependency order holds.

## Consequences

Positive: closed epics keep a repo-homed, queryable evidence trail; the factory never
fabricates duplicate feature work to manufacture a diff; transcript↔issue title drift is
documented instead of silently absorbed. Negative: a doc-only closing PR has no code diff to
review, so the verification evidence must be exact (wrong PR numbers would be recorded as
truth); future factory runs must check for prior sub-issue completion before planning an
epic's work, or risk planning already-done features.

## References

- [docs/epics/e18-waitlist-mode-copy.md (docs/epics/ precedent)](https://github.com/on-par/sound-buddy)
- [Epic](https://github.com/on-par/sound-buddy)
- [Issue #383](https://github.com/on-par/sound-buddy/issues/383)
