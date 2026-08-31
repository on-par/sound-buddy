# A visual-verification result record carries no open pending cells; sign-off is attributed and residual manual work is scoped separately

- Status: Accepted
- Date: 2026-08-31

## Context

ADR-0125 established the default-scale Session timeline visual gate as two artifacts kept in step:
a paintedness-only e2e capture spec, and a written runbook whose Result record "a human signs". It
also accepted the consequence that "a PR can be green with an unsigned Result record". In practice
#1295 shipped exactly that — a row ending in "⬜ Pending human reviewer sign-off" plus prose stating
the human half was not satisfied by the record — and it survived into the 0.9.1 RC review, where a
release manager could not distinguish "gate skipped" from "gate passed but never written down"
(#1344). The failure mode is structural: an open cell in a verification record has no owner, no
deadline, and no definition of what would close it, so it silently becomes permanent. Sound Buddy is
a paid product whose release evidence is read by a person deciding whether to ship, so an ambiguous
record is worse than a candid negative one. At the same time, the honest answer is not to declare
the gate automated — ADR-0124 and ADR-0125 both forbid pixel-diff baselines, and the real-rig
variant genuinely needs hardware no CI box has.

## Decision

Every Result-record row in a Sound Buddy verification document ends in a terminal, attributed
sign-off state — reviewed (with date, reviewer identity, and the exact artifact path that was looked
at), explicitly not-required-for-this-release, or superseded by a later row. A row may never be left
in an open "pending" state. Work that automation cannot perform is not tracked as an open cell in the
sign-off column: it is written as its own named, scoped item in a "what is still manual" section
stating who can do it, how long it takes, the command that does it, and whether it blocks the
release. Reviewer identity is stated literally — an automated agent's visual review of a captured
artifact is recorded as such and never attributed to a human. This amends ADR-0125's accepted
consequence that a PR may be green with an unsigned record: the record must be signed, but the
signature must be truthful about who signed and what was and was not covered.

## Consequences

Positive: a release reviewer reading a verification doc gets a yes/no per row instead of an
ambiguous checkbox, and the residual manual work is discoverable as a scoped item with a command
rather than as an orphaned TODO. It stays compatible with ADR-0124/0125 — no screenshot baseline is
introduced, and the machine gate is still the only thing CI enforces. Negative: the standard is
enforced by review, not by a checker, so it can regress; and an agent visual review is weaker
evidence than a human's, which is why the reviewer identity is required to be literal rather than
implied. Writing a candid "not run, needs a rig" line is more work than leaving a box unticked, and
that cost is accepted.

## References

- [Issue #1344](https://github.com/on-par/sound-buddy/issues/1344)
- [ADR-0125 — Default-scale timeline visual verification is a staged-capture harness plus a written human gate, never a pixel-diff baseline](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0125-default-scale-timeline-visual-verification-is-a-staged-capture-harness-plus-a-written-human-gate-never-a-pixel-diff-baseline.md)
- [ADR-0124 — Timeline alignment is proved by one DOM-geometry e2e spec, never by screenshots](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0124-timeline-alignment-is-proved-by-one-dom-geometry-e2e-spec-never-by-screenshots.md)
