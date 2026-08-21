# The arrangement playhead is two region segments carrying one shell-local x on `left`

- Status: Accepted
- Date: 2026-08-21

## Context

ADR-0086 fixed one shell-local coordinate space for the arrangement and justified
it partly on the playhead: it was a child of `.daw-shell`, belonged to no lane, and
so could not use a lane-local space. ADR-0090 then made the timeline column's
children re-base that shell-local x with one shared CSS translate, and explicitly
exempted the playhead — "it is a child of `.daw-shell`, whose left edge is the
origin's own frame".

That exemption stopped paying rent once the arrangement became the real layout.
The single shell-level line is positioned with `top:48px; bottom:8px` — offsets
tuned to the retired full-width shell — so it spans the transport bar's lower edge
and the status line, which ADR-0089 established is chrome outside the arrangement,
while having no structural relationship to either the ruler row or the lane column
it is supposed to mark. #1049 asks for one indicator readable across both regions,
and the regions now clip their own overflow, so an indicator that lives outside
them cannot participate in the ruler's or the lane column's clipping, scrolling, or
(later, #995) zoom.

Moving the playhead inside the timeline column forces a second choice. Its x was an
inline `transform: translateX(x)`, but inside the column the transform slot is
owned by ADR-0090's shared re-base, and CSS transforms do not compose across
rules. Either the painter re-bases in JavaScript (a second re-base site, which
ADR-0090 exists to prevent), or a per-frame custom property composes both in CSS (a
second `calc` re-base, and animation-rate invalidation of every inheriting
tick/gridline span), or the x moves to the same property every other timeline child
already uses.

## Decision

`dawShellHTML` emits the playhead as two empty region segments — a
`.daw-playhead.daw-playhead-ruler` as the last child of `.daw-ruler` and a
`.daw-playhead.daw-playhead-lanes` as the last child of `.daw-lane-column` — and
emits no `.daw-playhead` child of `.daw-shell`. Each segment spans its own region
vertically (`top:0; bottom:0`); no playhead rule may reintroduce a shell-relative
vertical offset.

`renderPlayhead` computes `dawPlayheadX(elapsed, shell.clientWidth)` exactly once
per frame and writes that one value to every `.daw-playhead` segment as an inline
`left`, toggling `.advancing` on each in the same pass. It may never compute a
per-segment coordinate: one instant is one number, and the segments' agreement is
structural, not asserted.

`.daw-playhead` joins ADR-0090's shared re-base selector list, which becomes
`.daw-ruler-tick, .daw-gridline, .daw-playhead { transform: translateX(calc(-1 * var(--daw-head-w))); }`,
amending that ADR's playhead exemption. The playhead therefore carries the
shell-local x on the same property (`left`) and re-bases through the same single
rule as a ruler tick or a lane gridline; no playhead-specific transform may be
added, because it would shadow the re-base.

`DAW_TIMELINE_INSET_PX` is retained, not retired as ADR-0090 anticipated: the
timeline column's right edge is still the shell's right edge, so the
`shellWidth - inset` clamp still parks the playhead inside the visible
arrangement. Its comment is re-worded to describe the arrangement's right inset
rather than the retired ruler margin.

## Consequences

Positive: the ADR-0086 identity (playhead x = tick x = gridline x for the same
instant) now holds for a playhead that lives inside the regions it marks, and the
two segments cannot drift because one computed number reaches both. Every
absolutely positioned timeline child — ticks, gridlines, playhead, and the take
clips (#994) and markers still to come — obeys one rule: shell-local x on `left`,
one shared translate. Each region clips its own segment, so lane-column scroll and
ruler zoom (#995) stay local changes.

Negative: the per-frame write is now two `left` assignments rather than one
`transform`, so the playhead moves on the layout path instead of the compositor
path. With two absolutely positioned elements per frame this is far below the cost
of the canvas waveform repaints running in the same frame, but a future third or
fourth segment should re-measure rather than assume. A reader of the painter sees a
bare number written to `left` and must know about the CSS re-base rule to know
where it lands — the same trade ADR-0090 already accepted for ticks and gridlines.

## References

- [#1049 — feat: Render the arrangement playhead across timeline regions](https://github.com/on-par/sound-buddy/issues/1049)
- [ADR-0086 — DAW timeline geometry is one shell-local coordinate space whose origin is the track-head column](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0086-daw-timeline-geometry-is-one-shell-local-coordinate-space-whose-origin-is-the-track-head-column.md)
- [ADR-0090 — Timeline-column children re-base the shell-local x with one shared CSS translate of the head width](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0090-timeline-column-children-re-base-the-shell-local-x-with-one-shared-css-translate-of-the-head-width.md)
- [docs/design/session-tab.md — Horizontal structure](https://github.com/on-par/sound-buddy/blob/main/docs/design/session-tab.md)
