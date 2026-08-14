# Coverage-epic gains are enforced by per-project threshold ratchets, not a root merged gate

- Status: Accepted
- Date: 2026-08-14

## Context

Issue #317 targets ≥95% merged statement coverage. The root vitest.config.ts (#237) intentionally
sets no thresholds ("no thresholds are set here — the gate stays where it is"), and the app's
ratchet (#401) showed branches/functions drift measurably between macOS and Ubuntu CI. A merged
gate over all projects would be the most flaky place to enforce the epic's number, and several
package floors (audio-engine 28/28/32/28, cli 70/60/68/72) are stale far below their measured
reality, so today nothing prevents a regression. A previous variant of this issue proposed
excluding packages/shared as "type-only", which is now false — shared is runtime release tooling
at 100% coverage.

## Decision

The ≥95% goal is held by ratcheting each project's coverage floor up to measured-minus-margin
(statements/lines margin 2, branches/functions margin 3 — the #401 convention), in the same PR
that adds the tests that lift the number. No root merged threshold is added, and the root
config's per-project-gate design stays intact. packages/shared is not excluded from coverage.

## Consequences

Positive: gains are locked where CI variance is smallest; the merged report keeps meaning (shared
stays counted at 100%); future coverage work follows the established ratchet-not-alarm pattern.
Negative: an over-tight floor can fail CI until corrected (mitigated by the margin); the merged
≥95% is verified by reading the report rather than by a hard CI gate.

## References

- [vitest.config.ts (root projects fan-out,](https://github.com/on-par/sound-buddy)
- [app/vitest.config.ts thresholds ratchet (#401)](https://github.com/on-par/sound-buddy)
- [Issue #317](https://github.com/on-par/sound-buddy/issues/317)
