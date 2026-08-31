# Session toolbar controls are emitted as named semantic groups, and every compact control carries both aria-label and title

- Status: Accepted
- Date: 2026-08-31

## Context

The Session timeline's transport row grew one control at a time through the
0.9.1 timeline work (#1275 BPM, #1282 overview, #1284 zoom, #1286 follow, #1313/#1317
loop and loop-from-selection, plus the pre-existing session picker, record and
routing controls). Each story appended its markup as another direct child of the
single flex-wrap `.daw-transport` div. With no grouping, the browser wraps wherever
the width happens to run out, so related controls (a zoom button and its range
readout, Play and Stop) end up on different lines and the toolbar reads as ragged
sprawl rather than as clusters. Width pressure also pushed several stories toward
abbreviations — `Sel`, `Back` — that are unreadable without hovering, and toward
long labels like `Loop Selection` that consume the width that caused the problem.
Separately, several of these buttons carried an `aria-label` but no `title`, so a
sighted mouse user got no explanation at all while a screen-reader user did.

## Decision

Every control in the Session transport is emitted inside one of a fixed set of
named groups produced by `sessionToolbarGroupHTML` (app/renderer/src/session-toolbar-groups.ts).
A group is a `role="group"` div with an `aria-label` from `SESSION_TOOLBAR_GROUP_LABELS`,
`flex-wrap: nowrap`, and a hairline divider before it; `.daw-transport` wraps only
between groups. Any future control added to the Session toolbar is added inside an
existing group, or by adding a new key to `SessionToolbarGroupKey` and its label —
never as a bare direct child of `.daw-transport`.
Any control rendered without visible text (icon-only) must carry BOTH an `aria-label`
and a `title` with the same string, so the accessible name and the tooltip cannot
drift. Icons come from report-card.ts's shared Lucide `ICON_PATHS` subset via
`iconSvg`; the toolbar does not introduce a second icon vocabulary.

## Consequences

Positive: wrapping is predictable and semantic, related controls stay together at
any width, the accessible-name and tooltip contract is uniform and machine-checkable,
and a responsive e2e spec can assert group cohesion instead of pixel positions.
Negative: adding a control now costs one extra decision (which group), the group
divider adds a few pixels per cluster, and icon-only commands are less immediately
readable for a first-time user than text was — mitigated by the mandatory tooltip
and by keeping the two least-guessable clusters (Fit / - / + and the track workspace
controls) textual.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1347)
- [docs/design-reference.md — Ableton Live as the interaction model](https://github.com/on-par/sound-buddy/blob/main/docs/design-reference.md)
