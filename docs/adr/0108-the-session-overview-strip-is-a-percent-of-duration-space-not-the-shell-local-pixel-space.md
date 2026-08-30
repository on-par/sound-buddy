# The Session overview strip is a percent-of-duration space, not the shell-local pixel space

- Status: Accepted
- Date: 2026-08-30

## Context

ADR-0086 makes every time-positioned surface in the Session arrangement — ruler ticks,
ruler labels, lane gridlines, take clips, the playhead — share one shell-local pixel
coordinate space whose origin is the track-head column's right edge, and ADR-0090 re-bases
those children into the timeline column with one shared CSS translate. ADR-0100/0101 add a
zoomable scale on top of that space, with `TimelineScale.xToTime` as the only sanctioned
inverse. That space is deliberately the ZOOMED arrangement: one second is
`pxPerSecond` pixels wide and the timeline column clips whatever does not fit.

#1282's overview strip is the opposite surface by definition. It must show the WHOLE
session duration inside a fixed-width band regardless of zoom, and mark which slice of it
the zoomed lane column is currently showing. Reusing shell-local pixels for the strip
would make its contents scale with zoom and overflow exactly like the lanes do — the one
thing an overview must not do. At the same time, letting it invent its own seconds-to-x
arithmetic would re-open the "two surfaces disagree about a time" defect class ADR-0086
exists to close.

## Decision

`app/renderer/src/timeline-overview.ts` positions the overview strip's visible-range box in
PERCENTAGES OF THE RESOLVED SESSION DURATION, not in shell-local pixels. It is therefore
the one time-positioned Session surface that is NOT added to app.css's shared
`translateX(calc(-1 * var(--daw-head-w)))` re-base list (ADR-0090), and it is rendered as a
child of `.daw-shell` between `.daw-transport` and `.daw-arrangement` rather than as a
child of the timeline column.

The two spaces are joined in exactly one place: `timelineOverviewView` obtains the visible
range by converting the timeline column's own visible x window —
`[DAW_TIMELINE_ORIGIN_PX, shellWidthPx - DAW_TIMELINE_INSET_PX]`, the same window
`dawPlayheadX` clamps the playhead to — back into seconds through timeline-scale.ts's
shared `timelineTimeAt` inverse. No overview code may divide an x by a pixels-per-second
value of its own (ADR-0101), and no overview percentage may be fed back into a ruler,
lane, clip, playhead or seek coordinate.

The strip's full-timeline duration is resolved by `timelineOverviewDurationSecs` as the
maximum of the loaded take's duration, the elapsed recording time, and a named minimum
floor — so the representation grows as a recording extends, and a short or empty session
still gets a sane strip instead of a degenerate zero-width one.

## Consequences

Positive: the overview stays correct at every zoom state without any change to it, because
zoom only moves the visible-range box, never the strip's own extent. The strip cannot
corrupt arrangement geometry — it writes only its own two elements and produces no
coordinate any other surface reads. Head/lane row alignment (ADR-0087) is untouched
because the strip lives outside `.daw-arrangement`.

Negative: there are now two coordinate spaces in the Session view, and a future reader must
not "fix" the overview by adding it to ADR-0090's translate list — doing so would shift the
strip left by the head width for no reason. Any future interactive overview work (#1282's
out-of-scope dragging, and zoom/fit buttons) must convert percent -> seconds ->
`TimelineScale`, and may never treat an overview pixel as a shell-local pixel. Because the
box is patched imperatively from a measured `clientWidth` rather than from store state
(ADR-0005), it is correct only after the first patch; the build-time markup therefore
defaults to a full-width box rather than a zero-width one.

## References

- [Issue #1282 — Add overview/fit strip showing full timeline and visible range](https://github.com/on-par/sound-buddy/issues/1282)
- [ADR-0086 — DAW timeline geometry is one shell-local coordinate space](docs/adr/0086-daw-timeline-geometry-is-one-shell-local-coordinate-space-whose-origin-is-the-track-head-column.md)
- [ADR-0090 — Timeline column children re-base the shell-local x with one shared CSS translate](docs/adr/0090-timeline-column-children-re-base-the-shell-local-x-with-one-shared-css-translate-of-the-head-width.md)
- [ADR-0101 — The timeline scale carries its own x-to-time inverse](docs/adr/0101-the-timeline-scale-carries-its-own-x-to-time-inverse-hit-testing-may-never-divide-by-a-scale-constant.md)
