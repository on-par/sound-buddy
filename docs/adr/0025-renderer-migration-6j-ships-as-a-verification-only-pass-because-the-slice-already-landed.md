# Renderer migration 6j ships as a verification-only pass because the slice already landed

- Status: Accepted
- Date: 2026-08-16

## Context

The factory's PLAN phase for issue #713 (TD-001 slice 6j, DAW playback + waveform rendering) found that the worktree already contains the complete merged implementation: origin/main carries commit 7057b0f "Renderer migration 6j: DAW playback + waveform rendering (#713) (#829)", and the checkout is up to date with it. Every acceptance criterion — React-owned playhead/waveform surface, corresponding inline-app.js code deleted with the file measurably smaller (626 lines), focused unit coverage (daw-shell-runtime.test.ts) + migration gate (daw-workspace-shell.test.ts), and a new timing-sensitive e2e (daw-shell.spec.ts) — is already satisfied. A from-scratch re-port would collide with the merged code and its pinning gate tests, and would churn a canvas-heavy, perf-sensitive surface for no user-visible gain. The BUILD phase therefore must not re-implement; it verifies and fixes only concrete regressions in place.

## Decision

Drive issue #713's BUILD pass as verification-only: run the issue's four verification commands plus the app e2e suite, confirm every gate is green, and make zero code changes unless a specific gate genuinely fails (then fix that regression in place, never re-port the surface). Leave inline-app.js intact at its 626-line post-6j size — the final deletion stays with #424, and no new migration or ADR is introduced.

## Consequences

Positive: no redundant churn on a timing-sensitive rendering surface; the merged implementation (already following ADR-0005 / ADR-0020) is preserved byte-for-byte; the BUILD pass is bounded and quick. Negative: if a gate does fail on an already-merged state, the cause is environmental or a pre-existing regression and must be root-caused against the merged diff rather than attributed to new work; the factory must accept a PR whose diff is empty (or no-op) as the correct outcome for this issue.

## References

- [ADR-0005 — Discrete spectrum state in the store, animation-rate playback updates straight to the DOM](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
- [ADR-0020 — The live-capture workspace board renders from discrete store state](docs/adr/0020-the-live-capture-workspace-board-renders-from-discrete-store-state-per-tick-values-patch-straight-to-the-dom-via-the-existing-meter-controller-adr-0005-extension.md)
- [Issue #713](https://github.com/on-par/sound-buddy/issues/713)
