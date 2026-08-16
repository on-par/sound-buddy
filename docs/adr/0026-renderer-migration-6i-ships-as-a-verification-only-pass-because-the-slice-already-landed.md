# Renderer migration 6i ships as a verification-only pass because the slice already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #712 (TD-001 slice 6i, capture lifecycle + rigs)
found that the worktree already contains the complete merged implementation:
origin/main carries commit 0334f7d "Renderer migration 6i: Capture lifecycle + rigs
(#712) (#827)" re-landed as 2566c27 "(#831)", and the checkout is up to date with it.
Every acceptance criterion — the lifecycle state machine and rig management driven by
React/store with no remaining inline-app.js listener for that surface
(capture-lifecycle.ts's createCaptureLifecycle installed on window.liveCaptureRuntime,
post-stop chrome in LiveStatusLine/LiveSessionOffers/WindowBadge islands,
rigDialogStore.ts + RigDialog.tsx keeping the window.rigDialog promise API), the
corresponding inline-app.js code deleted in the same PR with the file measurably
smaller (1270 -> 813 LOC in the 6i diff; 626 now after 6j), existing tests green with
focused new coverage (capture-lifecycle.test.ts 555 lines + island/store tests +
re-pointed gates), and the full app e2e suite pinned by named-channel-groups.spec.ts /
live-capture*.spec.ts) — is already satisfied. A from-scratch re-port would collide
with the merged code and its pinning gate tests, and would churn the behavior-
preserving lifecycle ordering (#776 resume, #458 promote, #757 preflight guards) for
no user-visible gain. The BUILD phase therefore must not re-implement; it verifies
and fixes only concrete regressions in place. This is the same replay situation the
sibling 6j slice (#713) already resolved with ADR-0025.

## Decision

Drive issue #712's BUILD pass as verification-only: run the issue's four verification
commands plus the app e2e suite, confirm every gate is green, and make zero code
changes unless a specific gate genuinely fails (then fix that regression in place,
never re-port the surface). Leave inline-app.js intact at its 626-line post-6j
size — the final deletion stays with #424 — and record the Electron-dyld e2e caveat
explicitly if the suite still cannot boot headless.

## Consequences

Positive: no redundant churn on a behavior-preserving lifecycle/rig surface; the
merged implementation (already following the ADR-0005 store-factory pattern) is
preserved byte-for-byte; the BUILD pass is bounded and quick; and the factory has a
consistent, recorded replay path for already-landed TD-001 slices (ADR-0025 for 6j,
this ADR for 6i). Negative: if a gate does fail on an already-merged state, the cause
is environmental or a pre-existing regression and must be root-caused against the
merged diff rather than attributed to new work; the factory must accept a PR whose
diff is empty (or no-op) as the correct outcome for this issue; the e2e gate may
remain environmentally unverifiable on hosts where Electron cannot boot.

## References

- [ADR-0005 — Discrete spectrum state in the store, animation-rate playback updates straight to the DOM](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
- [ADR-0025 — Renderer migration 6j ships as a verification-only pass because the slice already landed](docs/adr/0025-renderer-migration-6j-ships-as-a-verification-only-pass-because-the-slice-already-landed.md)
- [Issue #712](https://github.com/on-par/sound-buddy/issues/712)
