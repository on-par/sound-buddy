# Line-check capture is engineer-triggered only, and its per-tick sample buffer never enters React state

- Status: Accepted
- Date: 2026-09-20

## Context

`lc-01` (#1464, ADR-0139) deterministically identifies the "currently checking" channel as the
sole soloed channel. `lc-02` (#1465) provides `captureLineCheckProfile`, a pure-deps capture-to-
profile write. Neither is reachable by an engineer yet. `lc-04` (#1467, this slice) adds the
"Capture this channel" start/stop control that connects them: while capturing, it buffers one
curve sample per live tick (via the shared frame loop, ADR-0134) and reduces the buffer to one
curve on stop.

Two design questions came up while building the control:

1. Should the control (or some other part of the system) ever start a capture on its own — for
   example, the moment `lc-01` reports a new sole-soloed channel — so the engineer doesn't have
   to click a button per channel during a line check?
2. Where should the per-tick sample buffer live — store state (so a progress readout could show
   "12 ticks captured") or a closure variable private to the store module?

## Decision

Capture start/stop is engineer-triggered only. Soloing a channel (or un-soloing it, or soloing
a different one) never starts, stops, or otherwise affects an in-progress capture — the control
reads the current `lineCheckCaptureTarget` purely to decide what a *future* click would target
and, once capturing, stays enabled as a Stop affordance regardless of the live solo state. No
listener may be added anywhere in the line-check epic that treats a solo transition as an
implicit "start capturing" or "stop capturing" signal.

The per-tick sample buffer (the array of curves accumulated between `start()` and `stop()`) is a
closure variable inside `lineCheckCaptureStore.ts`'s factory, not store state. The store exposes
only `capturing` (boolean) and `status` (string) — nothing about buffer contents, sample count,
or tick timing is readable from outside `start()`/`stop()`. This mirrors `liveCaptureStore.ts`'s
existing convention of keeping ephemeral coordination state (its restart-coalescing promise/flag)
in closures rather than the store, reserved for state a React consumer never needs to render.

## Consequences

Positive: the control's behavior is exactly as predictable as `lc-01`'s indicator — a capture
starts and stops only when the engineer clicks, never as a side effect of console solo activity
that a mix engineer might trigger for unrelated reasons (e.g., soloing two channels to compare
them, ADR-0139's own noted tradeoff). The sample buffer's closure-only lifetime also means it is
structurally impossible for it to leak into a render path, get serialized into a store snapshot,
or be mutated by anything other than this module's own frame-tick callback.

Negative: no live "N ticks captured" progress readout is possible without either exposing the
buffer's length as store state (reopening the question this ADR closes) or wiring a separate
tick counter. Any future slice that wants such a readout must supersede this ADR's "store state
carries no buffer information" clause explicitly, not add a side-channel that reads the closure
variable from outside the module.

## References

- [Issue #1467](https://github.com/on-par/sound-buddy/issues/1467)
- [ADR-0139](./0139-the-line-check-subject-is-the-sole-soloed-channel-zero-or-many-is-silent.md) (the sole-soloed-channel signal this control reuses for enablement)
- [ADR-0134](./0134-the-live-tab-has-exactly-one-animation-frame-loop-owned-by-the-meter-controller-every-other-per-frame-consumer-registers-a-hook-instead-of-scheduling-its-own-raf.md) (the shared frame loop the capture buffer taps via `registerLiveFrameHook`)
- [Epic #1462](https://github.com/on-par/sound-buddy/issues/1462) (`line-check-calibration`)
