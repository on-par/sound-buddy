# The arrangement frame is column-major — a track-head column beside a timeline column that owns the ruler

- Status: Accepted
- Date: 2026-08-21

## Context

Epic #991's arrangement view has to place, per track, a header (index, name, meter, and
later arm/mute/solo) at a fixed 208px column width and a lane on a shared time axis,
with a ruler above the lanes and a playhead crossing both. Two DOM shapes can express
that. Row-major emits one element per track containing both cells and lets a CSS grid
supply the column boundary: row heights self-align for free, but the "track-header
column" and "lane column" exist only as grid tracks, so nothing in the markup names
them, and making the lanes scroll or zoom horizontally under a pinned header column
later means restructuring every row. Column-major emits one head column element and one
timeline column element, each holding its own per-track rows: the columns are real
elements that can be scrolled, styled and asserted on independently, at the cost of
requiring the two columns' row heights to be kept in lockstep by fixed row heights
rather than by layout.

`docs/design/session-tab.md` already fixes those heights (track row 64px comfortable /
44px compact, group header 28px, master row 60px) and describes the horizontal
structure as two columns with one shared origin, and #1042's acceptance criteria
require the ruler to be structurally associated with the lane region rather than the
header column — a distinction that only exists if the columns are markup.
ADR-0086 already settled the coordinate space: one shell-local space whose origin is
the 208px head column, emitted to CSS as `--daw-head-w`.

## Decision

`dawShellHTML` renders the arrangement column-major. `.daw-arrangement` contains
exactly two children: `.daw-track-heads`, the track-header column, and `.daw-timeline`,
the lane/timeline region, which itself contains `.daw-ruler` followed by
`.daw-lane-column`. The ruler always lives in the timeline region, never in the head
column. Every per-track row is emitted twice — a head row into `.daw-track-heads` and a
lane row into `.daw-lane-column`, in the same order — and the two are kept vertically
aligned by fixed row heights from `docs/design/session-tab.md`, never by relying on
layout to equalise them. The head column's width comes from `var(--daw-head-w)`, which
`dawShellHTML` emits on the `.daw-shell` root from `DAW_TIMELINE_ORIGIN_PX`;
`styles/app.css` never hardcodes 208px.

## Consequences

Positive: the ruler, the head column and the lane column are addressable elements, so
the structural contract is unit-testable on the emitted string with no DOM; the lane
column can later scroll and zoom horizontally under a pinned head column as one
overflow rule; the head width has exactly one source of truth, shared with ADR-0086's
timeline origin.

Negative: head rows and lane rows are emitted in two places, so #1043 must keep the two
lists ordered identically and any row-height change must be applied to both — a drift
risk that row-major would not have. Row heights must stay fixed per the design spec; a
content-sized track row would silently break head/lane alignment.

## References

- [#1042 — feat: Render semantic arrangement frame](https://github.com/on-par/sound-buddy/issues/1042)
- [#1027 — feat: Arrangement shell markup for configured tracks](https://github.com/on-par/sound-buddy/issues/1027)
- [docs/design/session-tab.md — Horizontal structure](https://github.com/on-par/sound-buddy/blob/main/docs/design/session-tab.md)
- [ADR-0086 — DAW timeline geometry is one shell-local coordinate space](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0086-daw-timeline-geometry-is-one-shell-local-coordinate-space-whose-origin-is-the-track-head-column.md)
