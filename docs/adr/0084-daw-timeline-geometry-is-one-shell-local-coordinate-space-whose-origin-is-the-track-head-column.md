# DAW timeline geometry is one shell-local coordinate space whose origin is the track-head column

- Status: Accepted
- Date: 2026-08-21

## Context

The arrangement view (epic #991, story-set #1026) draws three things that must line up
on the same instant: ruler ticks in a 26px ruler row, minor/major gridlines inside each
lane row, and a playhead line that spans the ruler row and every lane row at once.
Before this change the shell had no shared geometry: `PLAYHEAD_PX_PER_SECOND = 8` was
named after one consumer and informally borrowed by the waveform painter, and
`DAW_TIMELINE_INSET_PX = 4` encoded the old full-width shell's `margin: 8px 4px` ruler
inset purely for playhead clamping. `docs/design/session-tab.md` fixes the horizontal
structure as a 208px track-head column plus a lane column, and states the point
explicitly: one origin, so the ruler and the lanes cannot disagree about where t=0 is.
Two coordinate spaces were possible. Lane-local (origin 0, CSS grid supplies the 208px
offset) is tidy for gridlines but cannot express the playhead, which is not a child of
any single lane — it would need the head width added back in at its own call site,
recreating the second magic offset the epic exists to delete. The mockup's 7.6 px/sec is
an artboard artefact and must not be copied; the app's scale is 8.

## Decision

DAW timeline geometry lives in one shell-local pixel space, exported from
`app/renderer/src/daw-shell-runtime.ts` as exactly three symbols:
`DAW_TIMELINE_PX_PER_SECOND` (8 — the single scale, renamed from
`PLAYHEAD_PX_PER_SECOND` so it is not named after one of its consumers),
`DAW_TIMELINE_ORIGIN_PX` (208 — the track-head column width, the x of t=0), and the
pure `dawTimelineX(timeSecs)` which returns `DAW_TIMELINE_ORIGIN_PX + timeSecs *
DAW_TIMELINE_PX_PER_SECOND`.

Every arrangement-view consumer — ruler ticks, lane gridlines, the playhead — must
derive its horizontal coordinate by calling `dawTimelineX`. No consumer may introduce
its own pixels-per-second value, its own left offset, or a second name aliasing either
constant. `dawTimelineX` stays pure and unclamped; clamping to the visible lane width
remains `dawPlayheadState.offsetPx`'s concern. When the shell markup needs the head
width in CSS it must emit `--daw-head-w` from `DAW_TIMELINE_ORIGIN_PX` rather than
hardcoding 208 in `styles/app.css`.

## Consequences

Positive: the playhead coordinate is provably equal to the matching ruler-tick and
gridline coordinate, because all three are the same function of the same two constants
— the alignment is a unit-testable arithmetic identity, not a visual-inspection
exercise. Zoom, when it lands, becomes one change to one scale. The rename makes the
shared constant impossible to mistake for a playhead-only detail.

Negative: gridline and tick code must add the 208px origin even though CSS could have
supplied it via grid placement, so lane-local rendering must subtract it back out or be
positioned against the shell. Head-column width becomes a TypeScript constant that CSS
mirrors via `--daw-head-w`, a drift risk that only the emit-from-TS rule contains.
`DAW_TIMELINE_INSET_PX` survives temporarily as the old shell's clamp constant and must
be retired when the arrangement layout replaces the full-width lane rows.

## References

- [docs/design/session-tab.md — Horizontal structure](https://github.com/on-par/sound-buddy/blob/main/docs/design/session-tab.md)
- [#1026 — feat: Shared DAW timeline geometry](https://github.com/on-par/sound-buddy/issues/1026)
- [#1031 — feat: Export shared timeline geometry contract](https://github.com/on-par/sound-buddy/issues/1031)
