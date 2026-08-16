# Harshness Rules Engine ships as a verification-only pass because the feature already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #381 (feat: Harshness Rules Engine, P3 post-launch
feature sharing the #376 spectral core) found that the worktree already contains the
complete merged implementation: origin/main carries commit a501f6e "feat: Harshness
Rules Engine (post-launch, shares spectral core with #15) (#381) (#840)" and the
checkout is up to date with it. Every acceptance criterion — a data-driven per-instrument
rules table (RULE_TABLE), rules consuming the shared spectral core via bandEnergy rather
than re-deriving spectra, fired rules yielding a symptom-to-frequency suggestion with the
target band (FiredRule/RuleSuggestion), no ML, and unit tests covering each rule type
against fixture spectra asserting both fire and no-fire cases (rules.test.ts, ~250 lines)
— is already satisfied, and ADR-0027 already records the design decision. A from-scratch
re-implementation would collide with the merged code and its test suite, and would churn
a fully-tested, already-reviewed surface for no user-visible gain. This is the same replay
situation the already-landed slices #713 and #712 resolved with ADR-0025 and ADR-0026,
extended here to a non-migration feature issue. The BUILD phase therefore must not
re-implement; it verifies and fixes only concrete regressions in place.

## Decision

Drive issue #381's BUILD pass as verification-only: run the issue's verification commands
(npm run lint --prefix app; npm test --prefix app; npm test), confirm every gate is green,
and make zero code changes unless a specific gate genuinely fails (then fix that regression
in place, never re-port the surface). Leave packages/audio-engine/src/analyze/rules.ts,
rules.test.ts, the index re-export, and ADR-0027 intact as merged; an empty (or no-op)
PR diff is the correct outcome.

## Consequences

Positive: no redundant churn on a fully-tested, reviewed surface; the merged implementation
(already following ADR-0027) is preserved byte-for-byte; the BUILD pass is bounded and
quick; and the factory's recorded replay convention (ADR-0025/0026) now explicitly covers
feature issues, not just TD-001 migration slices. Negative: if a gate does fail on an
already-merged state, the cause is environmental or a pre-existing regression and must be
root-caused against the merged #840 diff rather than attributed to new work; the factory
must accept a PR whose diff is empty (or no-op) as the correct outcome for this issue;
future factory runs must still check issue state and git history before planning, or the
no-op pass would ship in place of real work.

## References

- [ADR-0027 — Offline harshness rules are a pure data-driven audio-engine module over the fine spectrum curve, separate from the live 7-band EQ coaching](docs/adr/0027-offline-harshness-rules-are-a-pure-data-driven-audio-engine-module-over-the-fine-spectrum-curve-separate-from-the-live-7-band-eq-coaching.md)
- [ADR-0025 — Renderer migration 6j ships as a verification-only pass because the slice already landed](docs/adr/0025-renderer-migration-6j-ships-as-a-verification-only-pass-because-the-slice-already-landed.md)
- [ADR-0026 — Renderer migration 6i ships as a verification-only pass because the slice already landed](docs/adr/0026-renderer-migration-6i-ships-as-a-verification-only-pass-because-the-slice-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/381)
