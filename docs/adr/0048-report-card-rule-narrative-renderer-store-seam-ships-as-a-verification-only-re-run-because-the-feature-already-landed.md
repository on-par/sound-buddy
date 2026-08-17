# Report-card rule-narrative renderer-store seam ships as a verification-only re-run because the feature already landed

- Status: Accepted
- Date: 2026-08-17

## Context

The factory's PLAN phase for issue #861 (feat: self-registering
renderer-store seam for rule-narrative templates, story 1 of the #839
report-card Troubleshooting work) found that the worktree already contains
the complete merged implementation: origin/main carries commit eafb5da
"feat: self-registering renderer-store seam for rule-narrative templates
(#861) (#902)" — itself a replay of the originally merged commit beb8dfa
(#867) — and the checkout is up to date with it (HEAD 000a3f7 ==
origin/main; branch ship-it/861-feat-self-registering-renderer-s; clean
tree). Every acceptance criterion — (1) renderer self-registration on
import keyed by rule type with no per-template global wiring (each
rule-renderers/<type>.ts module registers its template and renderer at top
level; rule-renderer-store.test.ts imports the four adapters for their
side effects); (2) lookup returns the registered renderer for a given rule
type (getRuleRenderer over the Map<RuleType, RuleRenderer> store); (3) an
unknown rule type returns a miss value (null) instead of throwing
(registry.get(type) ?? null, deliberately unlike audio-engine's
getRuleTemplate throw) — is already satisfied by the merged code and its
colocated rule-renderer-store.test.ts, and the design decision is already
recorded as ADR-0038. Story 2 (#862) already consumes the seam through
report-card-troubleshooting.ts's bare side-effect import of
./rule-renderers/harshness and its getRuleRenderer('harshness') dispatch.
A from-scratch re-implementation would collide with the merged and already
design-reviewed surface for zero user-visible gain. This is the same
replay situation that #381/#834/#835/#836/#837/#838/#864/#863 resolved
with ADR-0032–0037/0039/0040, now re-applied to #861 itself after
ADR-0041 and ADR-0042 already recorded two prior verification-only passes
for this exact seam. The BUILD pass therefore must not re-implement; it
verifies and fixes only concrete regressions in place.

## Decision

Drive issue #861's BUILD pass as verification-only: run the issue's stated
verification command (npm test --prefix app) plus the workspace gates (npm
run lint --prefix app; npm test; npm run build), confirm every gate is
green and each acceptance criterion holds against the merged
implementation and its rule-renderer-store.test.ts, and make zero code
changes unless a specific gate genuinely fails (then fix that regression
in place, never re-port the store/adapter surface). Leave
rule-renderer-store.ts, the four rule-renderers/ adapters, and
rule-renderer-store.test.ts intact as merged; an empty (or ADR-only) PR
diff is the correct outcome. Record ADR-0048 documenting the
verification-only re-run; ADR-0038 (the #861 design decision) is already
recorded and must not be duplicated.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the
merged store, adapters, and their tests are preserved byte-for-byte; the
BUILD pass is bounded and quick; and the factory's recorded replay
convention (ADR-0025/0026/0032–0040, including this seam's own
ADR-0041/0042) is continued. Negative: if a gate fails on an already-merged
state, the cause is environmental or a pre-existing regression and must be
root-caused against the merged #902 diff rather than attributed to new
work; the factory must accept a PR whose diff is empty (or ADR-only) as
the correct outcome for this issue; repeated replay of the same issue
grows the ADR index with near-duplicate verification records, so future
factory runs must check issue state and git history before planning to
stop re-driving already-merged slices.

## References

- [ADR-0042 — Report-card rule-narrative renderer-store seam ships as a verification-only pass because the feature already landed](docs/adr/0042-report-card-rule-narrative-renderer-store-seam-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0041 — Report-card rule-narrative renderer-store seam ships as a verification-only pass because the feature already landed](docs/adr/0041-report-card-rule-narrative-renderers-self-register-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0038 — Report-card rule-narrative renderers self-register in a renderer-side store keyed by rule type, and lookup returns a miss value instead of throwing](docs/adr/0038-report-card-rule-narrative-renderers-self-register-in-a-renderer-side-store-keyed-by-rule-type-and-lookup-returns-a-miss-value-instead-of-throwing.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/861)