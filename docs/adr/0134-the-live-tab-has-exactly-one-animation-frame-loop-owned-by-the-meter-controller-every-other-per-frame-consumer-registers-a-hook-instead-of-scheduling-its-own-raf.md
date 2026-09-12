# The Live tab has exactly one animation-frame loop, owned by the meter controller; every other per-frame consumer registers a hook instead of scheduling its own rAF

- Status: Accepted
- Date: 2026-09-12

## Context

The Live tab ran three independent `requestAnimationFrame` loops while monitoring:

1. `createLiveMeterController` (`live-meter-controller.ts`, mounted by
   `LiveWorkspace.tsx`) armed a frame on *every* `liveCaptureStore`
   notification, even ones no meter surface reads — an idle board still
   scheduled a frame for an unrelated store mutation.
2. A free-running playhead ticker effect in `LiveCapturePanel.tsx` called
   `requestAnimationFrame(tick)` directly, driving `renderPlayhead` +
   `patchOverview` every frame while capturing — replicating the meter
   controller's own frame cadence in a second loop that knew nothing about
   the first.
3. `daw-shell-runtime.ts`'s `scheduleWaveformRender` ran its own rAF-per-burst
   coalescing for waveform-peaks repaints, a third loop with the same
   per-frame cadence as the other two.

None of the three coordinated with each other. Each was individually
well-behaved (coalesced its own bursts, cancelled on stop), but stacking three
60fps loops during monitoring wastes frame budget for no correctness benefit —
the issue's AC calls for one that fails a test if a second appears — and made
it easy for a fourth future Live surface to add its own loop rather than
noticing the other three.

A strictly tick-driven single loop was rejected: the meter controller only
receives a store notification when a meter tick arrives, and meter/window
events are known to stall briefly (a slow Python meter frame, a paused
window). The playhead must keep advancing through that stall — a purely
tick-armed loop would freeze it, regressing the exact behavior
`LiveCapturePanel.tsx`'s free-running ticker existed to guarantee.

## Decision

`live-meter-controller.ts` is the Live tab's one `requestAnimationFrame`
owner. Its frame function has two arming halves:

- **One-shot**: a store notification arms a frame only when
  `liveMeterSnapshotChanged` (a pure predicate over the fields an
  animation-rate Live surface reads) says something moved. An idle board with
  no capture/playback running and no meter-visible field changing arms
  nothing (AC3).
- **Free-running**: the frame function re-arms itself every time it fires
  while its own `isCapturing` snapshot field is true, independent of further
  store notifications — this is what keeps the playhead moving through a
  stalled meter tick (AC2), the behavior the old ticker existed for.

Every other Live per-frame consumer registers into `live-frame-hooks.ts`
(`registerLiveFrameHook`) instead of scheduling its own frame:
`LiveCapturePanel.tsx`'s playhead work is now a registered hook, and
`daw-shell-runtime.ts` exposes `flushWaveform()` — a direct repaint with no
scheduling of its own — driven by a hook registered in `App.tsx`.
`daw-shell-runtime.ts`'s `ingestPeaks` checks an injected `isFrameLoopActive`
dep (backed by `live-frame-hooks.ts`'s mirrored active flag) and skips its own
`scheduleWaveformRender` while the shared loop is already running, falling
back to its pre-#1412 self-scheduling only when the loop is not active (or the
dep is not injected at all, e.g. a test harness with no meter controller
mounted).

Because the meter patch and the playhead hook now run inside the same
`frame()` call, a throwing consumer could otherwise break the other and the
loop's own re-arm in one shot — a coupling that never existed when they were
separate callbacks on separate frames. `frame()` runs `deps.patch` and
`deps.runFrameHooks` each through a `runSafely` wrapper that logs and swallows
rather than propagates, and re-arms based on `snap.isCapturing` regardless of
whether either call threw.

No future Live module may call `requestAnimationFrame` directly for
per-monitoring-frame work; it registers a hook instead.
`daw-workspace-shell.test.ts`'s "the Live tab has exactly one animation-frame
loop" block pins this by asserting `live-meter-controller.ts` is the only
module invoking `deps.raf(frame)` for this purpose, and that
`LiveCapturePanel.tsx` and `daw-shell-runtime.ts` no longer do.

## Consequences

Positive: exactly one rAF loop runs during Live monitoring instead of three,
and it goes fully idle (AC3) when nothing needs it — no meter frame armed for
an unrelated store mutation on an idle board. The playhead's stall-resilience
(AC2) is preserved because free-running is a property of the one loop, not of
a specific consumer. A thrown exception in any one per-frame consumer can no
longer silently kill the whole loop, which it would have without the
`runSafely` wrapper once the three loops were merged.

Negative: `live-meter-controller.ts` and `live-frame-hooks.ts` are now a
mandatory hop for any new Live per-frame work — a future author who reaches
for `requestAnimationFrame` directly inside a Live-tab module is (deliberately)
going against the grain, and the daw-workspace-shell.test.ts assertions plus
this ADR are the intended friction. `runSafely`'s error handling is a
`console.error`, not a surfaced UI state — a consumer that throws every frame
degrades to a silent, repeating console error rather than a visible failure,
though `LiveWorkspace.tsx`'s patch closure already gates each tick object to
at most one `applyLiveTick` attempt, bounding the retry storm to once per
distinct tick.

## References

- [Issue #1412 — fix(live): consolidate monitoring animation frames without freezing playhead](https://github.com/on-par/sound-buddy/issues/1412)
- Parent: [Issue #1406](https://github.com/on-par/sound-buddy/issues/1406)
