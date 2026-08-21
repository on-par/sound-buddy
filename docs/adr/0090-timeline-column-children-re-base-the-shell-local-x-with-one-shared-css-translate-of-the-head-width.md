# Timeline-column children re-base the shell-local x with one shared CSS translate of the head width

- Status: Accepted
- Date: 2026-08-21

## Context

ADR-0086 fixed DAW arrangement geometry as a single shell-local pixel space whose
origin is the 208px track-head column, because the playhead is a child of the shell
rather than of any lane and so cannot use a lane-local space without adding the head
width back at its own call site. ADR-0087 then made the frame column-major: a real
`.daw-track-heads` element beside a real `.daw-timeline` element that owns the ruler
and the lane column. Until #1048 the two columns still stacked, so the ruler and lane
rows were full-shell-width boxes and each tick/gridline's inline `left` — a shell-local
x that already includes the 208px origin — landed correctly by accident.

Laying the columns out side by side moves those boxes' left edge to exactly
`--daw-head-w` from the shell's left edge, so a shell-local `left` would now paint one
head width too far right. ADR-0086 named the two ways out ("lane-local rendering must
subtract it back out or be positioned against the shell") but did not pick one, and the
choice is not local: every future absolutely-positioned timeline child — labelled ruler
ticks (#1028), take clips (#994), markers, loop brace — inherits it. Emitting
column-local x from the builders was rejected as a re-litigation of ADR-0086 that would
strand the playhead. Negative margins on the row boxes were rejected because they
re-flow layout and let the grid overlay spill over the head column.

## Decision

`dawShellHTML` keeps emitting shell-local x from `dawTimelineX` for every timeline
child, and `styles/app.css` re-bases them into the timeline column with exactly one
rule — `.daw-ruler-tick, .daw-gridline { transform: translateX(calc(-1 * var(--daw-head-w))); }`.
Every future absolutely-positioned child of the ruler row or a lane row must join that
selector list rather than introducing its own offset, its own `calc`, or a second
re-base value; the translate is exact because the timeline column's left edge is
`var(--daw-head-w)` by construction, from the same `DAW_TIMELINE_ORIGIN_PX` the
coordinates use. The shell-level playhead is deliberately excluded: it is a child of
`.daw-shell`, whose left edge is the origin's own frame, so it consumes the shell-local
value unmodified.

Because the columns are now side by side, each column's rows must line up by fixed
heights rather than by layout (ADR-0087). The head column therefore carries a real
`.daw-ruler-gutter` cell as its first child, and the ruler row's height is a single
`--daw-ruler-row-h` custom property read by both the ruler and the gutter — the ruler
carries no vertical margin of its own. The zero-track empty state is emitted as a
paired row too: an empty head cell opposite `.daw-empty-state`, so the master row stays
aligned when nothing is configured.

## Consequences

Positive: one coordinate space survives the two-column layout, so the ADR-0086
identity — playhead x equals tick x equals gridline x for the same instant — stays a
unit-testable arithmetic fact rather than a visual check. The re-base has exactly one
site, so it cannot drift per consumer, and horizontal scroll/zoom of the lane column
later becomes one transform on `.daw-timeline` rather than a coordinate rewrite. The
ruler gutter is a real element, so the toolbar-side controls the design spec puts there
(zoom, follow) have a home.

Negative: a reader of the emitted markup sees `left:208px` on the t=0 tick and must
know about the CSS translate to understand where it actually paints — the coordinate
is only meaningful together with its re-base rule. Any new absolutely-positioned
timeline child that forgets the selector list is off by exactly 208px, which is a
plausible-looking layout rather than an obvious crash. `DAW_TIMELINE_INSET_PX` still
encodes the retired full-width shell's clamp and now outlives the layout it described;
retiring it moves to #1049 with the playhead.

## References

- [#1048 — feat: Set the arrangement header and lane-column boundary](https://github.com/on-par/sound-buddy/issues/1048)
- [ADR-0086 — DAW timeline geometry is one shell-local coordinate space whose origin is the track-head column](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0086-daw-timeline-geometry-is-one-shell-local-coordinate-space-whose-origin-is-the-track-head-column.md)
- [ADR-0087 — The arrangement frame is column-major](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0087-the-arrangement-frame-is-column-major-a-track-head-column-beside-a-timeline-column-that-owns-the-ruler.md)
- [docs/design/session-tab.md — Horizontal structure](https://github.com/on-par/sound-buddy/blob/main/docs/design/session-tab.md)
