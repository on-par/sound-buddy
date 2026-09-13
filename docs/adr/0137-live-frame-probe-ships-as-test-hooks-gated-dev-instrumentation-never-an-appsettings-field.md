# Live frame probe ships as test-hooks-gated dev instrumentation, never an AppSettings field

- Status: Accepted
- Date: 2026-09-12

## Context

#1406 (Live tab monitoring performance) needs p50/p95 numbers for
`applyLiveTick` (`LiveWorkspace.tsx`) to verify the choppy-monitoring
regression instead of relying on vibes, plus a count of how often
`LiveCapturePanel`'s board shell rebuilds (`dangerouslySetInnerHTML` swap —
each one detaches and replaces every node in the subtree, the exact cost
ADR-0136 and ADR-0135 are already fighting). #1414 carves this probe out as
its own child issue, explicitly scoped to dev-only instrumentation and
automated coverage — the 30-second reference-Mac p95 number is a manual
release-verification step, not something CI can produce, since it needs live
monitoring against Patrick's actual audio hardware.

Two gating mechanisms already exist in this codebase for renderer-only
diagnostic surfaces. One is an `AppSettings` flag rendered in Settings, the
path ADR-0009 retired for `secondaryMeasurementEnabled` specifically because
toggling a checkbox for an internal, non-product-facing concern forces every
user to see and reason about it, persists it to disk, and needs an IPC
whitelist entry. The other is `SOUND_BUDDY_TEST_HOOKS` — the dev/e2e switch
already wired end-to-end (`ipc/settings.ts` → `preload.ts` →
`App.tsx`) and already used by `timeline-scale-harness.ts` to install
`window.__soundBuddyTimelineScale` only when the app is launched with that
env var set. That hook's shape (injected deps → factory → module singleton →
`installXTestHook(target, enabled)`) is a direct precedent for a second
window-gated diagnostic surface.

## Decision

The probe (`live-frame-probe.ts`) is a `timeline-scale-harness.ts`-shaped
module: a pure `createLiveFrameProbeModel` factory wrapping an injectable
clock, a capped ring buffer of `applyLiveTick` durations, a board-rebuild
counter, and pure `percentileMs`/`formatLiveFrameProbeSummary` helpers. It is
`enabled: false` until something calls `start()`, and `start()` is reachable
only through `window.__soundBuddyFrameProbe`, installed by
`installLiveFrameProbeTestHook` in the same `areTestHooksEnabled()` branch
`App.tsx` already uses for the timeline-scale hook — zero new IPC channels,
zero new `AppSettings` fields, zero new Settings UI. `applyLiveTick` calls
`beginTick()`/`endTick()` and `LiveCapturePanel` calls `noteBoardHtml()`
unconditionally on every tick/render; both are one `if (!enabled)` check when
the hook was never installed, so the probe costs nothing in a normal
(non-test-hooks) boot. The probe is never connected to crash reporting,
analytics, or any network path — its data lives in memory for the renderer
process's lifetime and nothing serializes it anywhere but the in-memory
`summary()` plain object a caller reads back via `page.evaluate`/DevTools.

## Consequences

Positive: verifying the #1406 regression needs zero UI, zero settings
migration, and zero new IPC surface — launch with
`SOUND_BUDDY_TEST_HOOKS=1`, call `window.__soundBuddyFrameProbe.start()`,
monitor for 30 seconds, call `stop()`, read `summary()` (or
`formatLiveFrameProbeSummary(summary())` for a release-notes-ready line). The
module is fully unit-testable with an injected fake clock, independent of
`applyLiveTick`'s own DOM-patching logic (which stays e2e-only, per its
existing `/* c8 ignore */` block) — this ADR does not change that boundary.
Negative: because the probe is unreachable from the production UI, nobody
without `SOUND_BUDDY_TEST_HOOKS` set can self-serve these numbers — a future
in-product performance HUD (if #1406 ever wants one) is a separate, explicit
decision, not a natural extension of this module. The ring buffer
(`LIVE_FRAME_PROBE_MAX_SAMPLES = 500`) bounds memory for a long-running probe
but means a session monitored far longer than that window only reflects its
most recent ticks — acceptable for the 30-second reference-Mac check this
issue targets, but a future longer-horizon analysis would need a different
cap or a flush-to-disk path, neither of which this ADR authorizes.

## References

- [Issue #1414 — fix(live): add dev frame-time probe for applyLiveTick](https://github.com/on-par/sound-buddy/issues/1414)
- [Parent issue #1406 — Live tab monitoring performance](https://github.com/on-par/sound-buddy/issues/1406)
- [ADR-0009 — Secondary measurement device is first-class and always visible; the flag is retired, not migrated](0009-secondary-measurement-device-is-first-class-and-always-visible-the-flag-is-retired-not-migrated.md)
- [ADR-0135 — Live window ticks never enter the board shell's render selector](0135-live-window-ticks-never-enter-the-board-shell-s-render-selector.md)
- [ADR-0136 — Per-tick track node caching keys on shell root identity plus boardShapeVersion](0136-per-tick-track-node-caching-keys-on-shell-root-identity-plus-boardshapeversion-never-boardshapeversion-alone.md)
