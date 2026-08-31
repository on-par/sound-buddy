# Follow auto-tracking derives per playback frame but commits the paged visible range discretely through React

- Status: Accepted
- Date: 2026-08-31

## Context

ADR-0111 landed the follow pause/resume policy and the pure paged-follow derivation
`timelineFollowRange()`, but deliberately left it with no production caller: the viewport wiring was
split into #1283, which was parked. The result shipped in 0.9.1 RC as a product/UX mismatch — the
toolbar toggle says "Following the playhead" while no range in the app ever chases it (#1343). Two
constraints had to be reconciled before wiring it. First, ADR-0005 pins animation-rate playback
updates as imperative DOM writes that must not round-trip through React state, and ADR-0111 restated
that as "applies the result imperatively". Second, ADR-0112 pins the visible range's pan to one
shared `--daw-scroll-x` custom property, and in this checkout that property is written by a
LiveCapturePanel render effect from `timelineZoom.range` — the single React-owned visible range that
the zoom toolbar, the `#daw-zoom-range` readout, the overview strip and every scroll-aware scrub
geometry also read. An imperative per-frame write to `--daw-scroll-x` would therefore create a
second, divergent owner of the visible range: the painted offset would say one thing and React's
range another, and the next render would snap the viewport back.

The saving observation is that follow is not actually an animation-rate state change.
`timelineFollowRange` returns the caller's own range reference on every frame where the playhead is
already inside the viewport, so a commit is needed only on a page crossing — roughly once per visible
span, not once per frame.

## Decision

Follow auto-tracking runs its derivation once per coalesced playback progress frame (in
LiveCapturePanel's `createSoundcheckTransportController` `patchPlayhead` callback, reached through a
`followTickRef` so the closure is never stale) and commits the result as ordinary discrete React state
via `setTimelineZoom` — never as an imperative `--daw-scroll-x` write. The pure helper
`timelineFollowPage(model, range, ctx)` in `timeline-follow-scroll.ts` is the one place that decides
"did this frame move the range", returning `null` when `timelineFollowRange` handed back the caller's
own reference; frames that return `null` schedule no React update at all, and the commit re-derives
inside the functional updater so a frame arriving before the re-render cannot page twice. This refines
ADR-0111's "applies the result imperatively" clause: the derivation stays per-frame, the application is
discrete, and `timelineZoom.range` remains the single owner of the visible range, with
`--daw-scroll-x` staying a derived value written only by the existing render effect.

Live-recording follow is explicitly not wired: `timelineOverviewDurationSecs` makes the recording
duration equal the record head's own position, so the paged start would move every frame and the
commit would degenerate into an animation-rate re-render. Any future slice that adds it must first
decide a lead/headroom rule for the growing timeline, not simply call the same helper from the
recording rAF.

## Consequences

Positive: the Follow toggle's "Following the playhead" copy is now true; the viewport, the range
readout, the overview box and every offset-re-based surface can never disagree about where the view
is, because they all still derive from one React-owned range; #1328's pause contract survives
untouched, since a paused model makes the derivation a no-op before any commit is considered.
Negative: a page crossing costs one full board re-render (the DAW shell markup is rebuilt per
render), so a very narrow zoom during playback re-renders more often than a wide one; and follow is
playback-only until the recording-headroom question is answered, which means the wall-clock record
head can still walk off a zoomed-in viewport. Both are named here rather than discovered later. A
further consequence discovered while wiring this: the app boots with a 1-second-wide visible range
(`createTimelineZoomModel(0)`, pinned at `TIMELINE_MIN_VISIBLE_SPAN_SECS`) that nothing re-derives to
the loaded session's real duration, so with follow on by default a playback progress tick can page the
viewport immediately unless something has already widened the range (a `#daw-zoom-fit` click, in
practice). Existing e2e cases that ran playback ticks without first fitting the view had to be updated
to fit first, to keep asserting what they were actually testing rather than incidentally re-testing
follow's paging.

## References

- [Issue #1343](https://github.com/on-par/sound-buddy/issues/1343)
- [ADR-0111 — Follow-scroll pause is source-based, and lives in one pure model the viewport wiring consumes](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0111-follow-scroll-pause-is-source-based-gestures-pause-controls-resume-and-lives-in-one-pure-model-the-viewport-wiring-consumes.md)
- [ADR-0112 — The Session timeline's visible range pans the viewport through one shared --daw-scroll-x offset](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0112-the-session-timeline-s-visible-range-pans-the-viewport-through-one-shared-daw-scroll-x-offset-never-a-per-surface-scroll-origin.md)
- [ADR-0005 — Discrete spectrum state in the store, animation-rate playback updates straight to the DOM](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
