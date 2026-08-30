# Session timeline zoom gestures are ctrl/meta wheels that scale the shared span around the playhead-or-centre anchor, never around the pointer

- Status: Accepted
- Date: 2026-08-30

## Context

#1292 shipped the pan half of the Session timeline's gesture layer:
timeline-scroll-gesture.ts turns an unmodified horizontal wheel into a new
TimelineVisibleRange and resolves the result to the viewport through the
single --daw-scroll-x offset (ADR-0112). #1291 is the zoom half, and three
forces shape it.

First, gesture classification must stay single-sourced. Three modules
already inspect the same wheel: timelineFollowEventForWheel (#1286) reads
ctrl/meta as 'manual-zoom', and timelineScrollDeltaPx (#1292) explicitly
returns null for ctrl/meta so the pan path never fires on a zoom. A zoom
predicate that disagreed with either would let a single wheel both pan and
zoom, or pause follow for a gesture that changed nothing. It also happens
to be how a macOS trackpad pinch reaches the renderer, so honouring the
existing rule is what makes the issue's "pinch-zoom where supported"
requirement free rather than a second code path.

Second, the obvious DAW behaviour — zoom around the time under the pointer
— needs an x-to-time inverse that accounts for the current scroll offset.
ADR-0112 records that no such inverse exists yet: session-timeline-scrub.ts
and the #1285 ruler scrub zone still measure from the unscrolled origin and
are knowingly off by the offset once the user has panned. Building a
pointer-anchored zoom on top of that would silently inherit the same error
and would make the gesture disagree with the #1284 zoom-in/zoom-out
buttons, which anchor at the playhead-or-centre.

Third, ADR-0109 deferred resolving a visible range into a pixels-per-second
plus a repaint, and #1292 did not close that gap either. The whole
arrangement is still emitted at the one SESSION_TIMELINE_SCALE, and the
playhead painter (dawPlayheadX) has no scale parameter at all, so changing
the effective scale from a gesture would need a cross-module current-scale
holder that App.tsx's boot-time runtime could read — a change of a
different size than a gesture slice.

## Decision

A Session timeline zoom gesture is a wheel event carrying ctrlKey or
metaKey and a non-zero deltaY — the exact complement of
timelineScrollDeltaPx's pan rule and the same condition
timelineFollowEventForWheel already treats as 'manual-zoom', so pan, zoom
and follow-pause classify every wheel identically. Trackpad pinch is
served by that one rule, not by a separate pinch handler. Drag-zoom is not
implemented: no drag-zoom pattern exists in the Session timeline controls,
and the issue scoped it conditionally on one existing.

The gesture lives in the pure app/renderer/src/timeline-zoom-gesture.ts.
timelineZoomDeltaPx converts the wheel's deltaMode units to CSS pixels
using timeline-scroll-gesture.ts's TIMELINE_SCROLL_LINE_PX and
TIMELINE_SCROLL_PAGE_PX — imported, never re-declared.
timelineZoomSpanFactor turns that pixel delta into a multiplicative span
factor, exp(deltaPx * TIMELINE_ZOOM_WHEEL_RATE) bounded to one
TIMELINE_ZOOM_MAX_STEP_FACTOR step per event, so a single large wheel
cannot jump the whole range. applyTimelineZoomGesture multiplies the
current span by that factor and resolves the result through
timeline-visible-range.ts's visibleRangeOfSpan: the gesture module owns no
clamp of its own, exactly as the pan module owns none, so
TIMELINE_MIN_VISIBLE_SPAN_SECS and the full duration are the only bounds
in the app. At a bound it returns the caller's own range reference, so the
React state updater can return the previous model and re-render nothing.

Zoom is anchored at the playhead when the playhead is finite and inside
the current range, and at the range's own centre otherwise — never at the
pointer. That rule is hoisted out of timeline-zoom-controls.ts's private
helper into timeline-visible-range.ts as the exported
visibleRangeAnchorSecs, so the #1284 toolbar buttons and the gesture are
the same rule by construction rather than by two copies agreeing. Pointer-
anchored zoom is permitted only after a scroll-aware x-to-time inverse
exists and session-timeline-scrub.ts uses it too.

The gesture changes the range's span only. Resolving a span to a
pixels-per-second and repainting the ruler, lanes, clips and playhead at
it remains deferred, as ADR-0109 left it; ruler/lane/clip/playhead
alignment is preserved because every surface still reads the one
SESSION_TIMELINE_SCALE and re-bases through the one --daw-scroll-x
translate (ADR-0086/0090/0112).

## Consequences

Positive: one wheel classification rule across pan, zoom and follow-pause,
so no gesture can be two things at once. Pinch support costs nothing.
One anchor rule and one clamp rule for both the buttons and the gesture,
so the toolbar and the trackpad can never drift apart. The gesture module
is pure and DOM-free, unit-tested without jsdom, matching
timeline-scroll-gesture.ts, timeline-zoom-controls.ts and
timeline-follow-scroll.ts. Alignment across ruler, lanes, clips and the
playhead is preserved by construction, not by four call sites agreeing.

Negative and accepted: zoom is not yet visible on screen — the span, the
toolbar range readout and the scroll offset change, but the arrangement is
still drawn at the fixed default scale until the deferred span-to-scale
repaint lands. Zoom is not centred on the pointer, which is less
Ableton-like than the design reference; that is a deliberate consequence
of ADR-0112's known scroll-aware-inverse gap and is revisitable once the
inverse exists. A real ctrl+wheel is not preventDefault'ed, because React
19's onWheel is a passive root listener; if Electron ever surfaces browser
page zoom on that gesture it will need a non-passive native listener.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1291)
- [Issue](https://github.com/on-par/sound-buddy/issues/1283)
- [ADR-0109 - The Session timeline's visible range is a seconds range with a single-slot zoom-back memory](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0109-the-session-timeline-s-visible-range-is-a-seconds-range-with-a-single-slot-zoom-back-memory-it-does-not-resolve-to-pixels-until-scroll-exists.md)
- [ADR-0112 - The Session timeline's visible range pans the viewport through one shared --daw-scroll-x offset](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0112-the-session-timeline-s-visible-range-pans-the-viewport-through-one-shared-daw-scroll-x-offset-never-a-per-surface-scroll-origin.md)
