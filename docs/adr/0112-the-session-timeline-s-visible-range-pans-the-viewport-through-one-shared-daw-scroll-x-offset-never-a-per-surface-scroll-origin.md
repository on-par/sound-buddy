# The Session timeline's visible range pans the viewport through one shared --daw-scroll-x offset, never a per-surface scroll origin

- Status: Accepted
- Date: 2026-08-30

## Context

ADR-0109 shipped the Session timeline's visible range as a pure seconds
range and explicitly deferred "resolving a range into pixels-per-second
plus a scroll offset, and repainting the ruler, lanes, clips and
playhead" to #1283, which the factory then parked as oversized and
decomposed; #1292 is its horizontal-scroll slice. Three constraints met
here. First, ADR-0086/0090 already give the arrangement exactly one
coordinate rule: every time-positioned child carries a shell-local x from
the shared scale, and ONE CSS rule re-bases all of them into the timeline
column by var(--daw-head-w). Any scroll implementation that recomputed x
per surface would create a second place where a tick, a gridline, a clip
and the playhead could disagree about where a time sits - the precise
failure those ADRs exist to prevent. Second, ADR-0101 reserves time<->
pixel conversion to timeline-scale.ts, so a gesture module may not divide
a wheel delta by a pixels-per-second value of its own. Third, the
arrangement's timeline column is overflow:hidden with no wider inner
content layer, so a real scrollLeft would mean restructuring the paired
head/lane row layout (ADR-0087) and would introduce browser scroll
position as a second source of truth beside the shared range.

## Decision

The visible range resolves to the viewport through exactly one number: a
scroll offset in pixels, derived from range.startSecs by
timelineScrollOffsetPx (which converts through timeline-scale.ts's
timelineSpanPxAt, never a local multiplication), written as the
--daw-scroll-x custom property on the .daw-shell element by
patchTimelineScrollOffset. app.css's single re-basing translate becomes
translateX(calc(-1 * (var(--daw-head-w) + var(--daw-scroll-x, 0px)))),
and .daw-shell declares --daw-scroll-x:0px so the calc is always valid.
Every current and future absolutely positioned ruler/lane child joins
that one selector list and inherits panning for free - no surface gets
its own scroll origin, and no emitted x is recomputed for scroll. The
gesture itself is pure and lives in timeline-scroll-gesture.ts:
applyTimelineScroll turns a wheel-like object into a new
TimelineVisibleRange, converting pixels to seconds through
timeline-scale.ts's origin-free timelineSpanSecsAt and clamping through
timeline-visible-range.ts's clampVisibleRange - the gesture module owns
no clamp and no scale of its own, and returns the caller's own range
reference unchanged when the gesture is not a horizontal pan or the range
is already at a bound. Horizontal intent is |deltaX| > 0 with no
ctrl/meta modifier, the same rule timelineFollowEventForWheel (#1286)
already uses to pause follow, so panning and follow-pause can never
disagree about what a scroll gesture is.

## Consequences

Positive: the timeline pans with one property write and no repaint of
ticks, labels, gridlines, clips or playhead, so ruler/lanes/clips/
playhead alignment is preserved by construction rather than by four
call sites agreeing. The shared range stays the single source of truth -
zoom actions that move the range's start now pan the viewport through the
same path, for free. The gesture logic is a pure, DOM-free module unit
tested without jsdom, matching timeline-zoom-controls.ts and
timeline-follow-scroll.ts. Reversing the decision is cheap: the property
is one number in one CSS rule.
Negative and accepted: while the range is scrolled away from t=0, the
pointer-driven surfaces that invert x back to time - session-timeline-
scrub.ts and the #1285 ruler scrub zone - still measure from the
unscrolled origin, so a scrub commits a seek that is off by the scroll
offset until the inverse is taught about it; the same holds for the
overview strip's visible-range box, which timelineOverviewView still
derives assuming a start of 0 (both are named out of scope by #1292, and
the offset is 0 until the user scrolls, so the default view is exact).
The playhead also keeps its existing park-clamp against the unscrolled
shell width, so it can be panned off-screen while follow is paused -
which is the point of pausing follow. Because the shell's markup is
rebuilt from dawShellHTML on render, the offset must be re-patched after
every render rather than only when the range changes.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1292)
- [Issue](https://github.com/on-par/sound-buddy/issues/1283)
- [ADR-0109 - The Session timeline's visible range is a seconds range that does not resolve to pixels until scroll exists](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0109-the-session-timeline-s-visible-range-is-a-seconds-range-with-a-single-slot-zoom-back-memory-it-does-not-resolve-to-pixels-until-scroll-exists.md)
