# Live window ticks never enter the board shell's render selector

- Status: Accepted
- Date: 2026-09-12

## Context

The Live tab's DAW board is a single dangerouslySetInnerHTML string built by
dawShellHTML and rendered by LiveCapturePanel. Every re-render that changes
that string replaces the board's entire subtree — including the
.daw-channel-waveform and .daw-mix-waveform canvases, whose painted contents
are imperative state the daw-shell-runtime painters own (ADR-0005). Until
#1411, LiveCapturePanel's useStoreShallow selector included liveCaptureStore's
`liveWindows` array and `lapCoaching` object. liveCaptureStore.bindIpcEvents
replaces both — and the mainsHum tracker — on every analysis-window frame, so
the board was being torn down and rebuilt several times a second purely so two
window-rate surfaces (the Live-adjustments panel and the #1407 mains-hum badge)
could refresh. The board shell is the most expensive markup in the app and the
only place in the Live tab holding canvas state, so it is the one subtree that
must not ride a tick-rate subscription.

## Decision

LiveCapturePanel subscribes through one exported pure selector,
`liveBoardSelection(st)`, and that selector carries only discrete board-SHAPE
values. No animation-rate or window-rate store field — `lastTick`,
`lastLiveChannels`, `liveWindows`, `lapCoaching`, `secondaryWindows`, the
`mainsHum` tracker object — may be added to it. A surface that must refresh at
window rate gets its own leaf component with its own subscription, rendered as
a child of the existing delegating `.live-board-root` div so the board's
delegated click/change/drag handlers keep reaching it by bubbling;
`<LiveAdjustmentsPanel>` is the first such leaf. When a window-rate value must
influence the board markup itself, it enters the selector only as a
value-stable primitive fingerprint (`mainsHumWarningsSignature` is the
reference implementation), never as the object it was derived from. Anything
the board rebuild was implicitly refreshing moves to an explicit per-tick DOM
patch driven by LiveWorkspace's applyLiveTick, expressed as a pure
`*PatchView` derivation plus a structural-`*ShellLike` applier so both halves
are unit-testable without jsdom (`dawTrackLevelPatchView` /
`patchTrackHeadLevels`).

## Consequences

Positive: the board container and its waveform canvases keep their DOM
identity across an arbitrary number of window ticks, so monitoring no longer
stutters and canvas paint state survives; the subscription boundary is now a
named, testable, pure function instead of an inline closure, so a regression
is caught by a unit test rather than by eyeballing frame rate; the
adjustments panel's re-render cost is proportional to its own markup.
Negative: the board's freshness is now explicit rather than incidental — any
future board input that happens to change only on a window tick will go stale
unless it is given a signature entry or a per-tick patch, and reviewers must
treat additions to liveBoardSelection as load-bearing. Splitting the markup
into two child divs also adds one wrapper element on each side inside
.live-board-root, so future CSS must not assume a direct-child relationship
between .live-board-root and .daw-shell or .live-adjustments-panel.

## References

- [Issue #1411 — fix(live): keep DAW board stable across live window ticks](https://github.com/on-par/sound-buddy/issues/1411)
- [Parent issue #1406 — Live tab monitoring performance](https://github.com/on-par/sound-buddy/issues/1406)
