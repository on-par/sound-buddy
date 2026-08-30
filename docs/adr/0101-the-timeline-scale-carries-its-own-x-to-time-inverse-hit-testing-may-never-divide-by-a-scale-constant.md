# The timeline scale carries its own x-to-time inverse; hit testing may never divide by a scale constant

- Status: Accepted
- Date: 2026-08-30

## Context

ADR-0086 made `DAW_TIMELINE_PX_PER_SECOND` the single arrangement scale and required
every time-positioned surface to derive its x from `dawTimelineX`. ADR-0100 then
introduced `app/renderer/src/timeline-scale.ts` with zoom states, clamped bounds and a
one-way `timeToX`, and deferred converting the existing call sites. That left one
direction unmodelled: pointer hit testing needs x-to-time, and the only existing
implementation — `soundcheckTimelinePreviewFromPointer` — divided a surface-relative
pointer offset by the module constant while computing its playhead pixel through
`dawTimelineX`. Two conversions written in two places against two different anchors is
precisely the drift ADR-0086 exists to prevent: at any non-default scale the
hit-tested time and the pixel the playhead is drawn at would disagree, and the
disagreement would be invisible at the default scale where the numbers happen to
line up. The scrub surface is also not in the same coordinate space as the playhead —
the pointer offset is measured from the timeline column's left edge, while the
playhead's left is shell-local, and the two differ by exactly the shared
`DAW_TIMELINE_ORIGIN_PX` track-head column width. Making the inverse a separate local
helper per surface would let each surface re-derive that relationship, and get it
wrong, independently.

## Decision

`TimelineScale` owns both directions. `timeline-scale.ts` exports
`timelineTimeAt(pxPerSecond, xPx)` as the exact inverse of `timelineXAt` — same
`DAW_TIMELINE_ORIGIN_PX` anchor, unclamped in time, resolving to 0 rather than NaN or
Infinity for a non-finite x or a non-finite/non-positive scale — and the frozen
object returned by `createTimelineScale` carries a matching `xToTime` member alongside
`timeToX`. Every arrangement surface that maps a pointer to a time calls
`TimelineScale.xToTime`; no surface may divide a pixel distance by
`DAW_TIMELINE_PX_PER_SECOND`, by `scale.pxPerSecond`, or by any other scale value of its
own. A surface whose pointer coordinates are measured from the timeline column edge
re-bases into shell-local space by adding `DAW_TIMELINE_ORIGIN_PX` before calling
`xToTime`, so that `scale.xToTime(scale.timeToX(t)) === t` is an enforced identity rather
than an accident of the default numbers.

`app/renderer/src/soundcheck-playhead.ts`'s `soundcheckTimelinePreviewFromPointer` is
converted onto this rule as part of #1264 and takes an optional trailing `TimelineScale`
defaulting to `createTimelineScale('default')`, so shipped behavior is unchanged until
zoom UI supplies a different scale.

## Consequences

Positive: the scrub target and the playhead pixel are provably the same point at every
zoom state, testable as a round-trip identity with no DOM and no React. The 208px
track-head offset is named once, in the model's anchor, instead of being re-derived by
each hit-testing surface. Future zoom work passes a value rather than editing a
constant.

Negative: `TimelineScale` is now a two-method interface, so any future hand-built scale
literal must implement both directions — `createTimelineScale` is the only sanctioned
producer. `timelineTimeAt`'s non-finite guards return 0, a silent fallback rather than a
thrown error, which is consistent with `timelineXAt` but means a caller that passes
garbage gets a plausible-looking t=0 instead of a diagnostic. And because `'fit'` is a
float scale, the round-trip is exact only up to floating-point representation — tests
of it need an epsilon, never equality.

## References

- [#1264 — Wire playhead position and scrub target to the shared timeline scale](https://github.com/on-par/sound-buddy/issues/1264)
- [#1254 — Shared zoomable timeline scale for ruler, playhead, gridlines, clips, and waveforms](https://github.com/on-par/sound-buddy/issues/1254)
- [ADR-0100 — The timeline scale model is a pure state-plus-bounds object](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0100-the-timeline-scale-model-is-a-pure-state-plus-bounds-object-zoomed-in-and-zoomed-out-are-the-clamp-bounds.md)
- [ADR-0086 — DAW timeline geometry is one shell-local coordinate space](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0086-daw-timeline-geometry-is-one-shell-local-coordinate-space-whose-origin-is-the-track-head-column.md)
