# Arrangement head rows and lane rows render from one shared ordered track list

- Status: Accepted
- Date: 2026-08-21

## Context

ADR-0087 made the arrangement column-major: `.daw-arrangement` holds a
`.daw-track-heads` column beside a `.daw-timeline` column, and every
per-track row is therefore emitted twice — once as a head row, once as a
lane row. That ADR named the cost explicitly: the two lists must stay
ordered identically and the same length, and nothing in a column-major
DOM enforces it. #1043 is the first story to actually emit both halves, so
it is the moment that risk becomes real. The obvious implementation —
`state.channelConfig.map(...)` in the head builder and again in the lane
builder — leaves two independent derivations of the same list, each
resolving its own display name through `resolveStripLabel` and its own
escaping, and every later story that touches a row (the master row and
status line in #1044, arm/mute/solo in #992, take clips in #994, selection
in #993) doubles the number of places that must agree. The same problem
exists vertically: the two columns are separate flex containers, so no
layout rule can equalise their row heights, and `docs/design/session-tab.md`
already fixes the comfortable track row at 64px.

## Decision

`live-workspace-view.ts` exports one pure `dawTrackRows(state)` that
returns the ordered per-track list — index plus an already-HTML-escaped
display name resolved through `resolveStripLabel` — and `dawShellHTML`
maps that single array twice, once into `.daw-track-heads` and once into
`.daw-lane-column`. `dawShellPatchView`'s `laneSignature` derives from the
same array. No arrangement builder may derive a per-track list from
`state.channelConfig` directly; new per-track data (arm state, colour,
selection, take clips) is added as a field on `DawTrackRow`, not as a
second map. Row heights come from one `--daw-track-row-h` custom property
declared once on `.daw-shell` in `styles/app.css` and applied to both
`.daw-track-head` and `.daw-channel-lane`; neither column may set a row
height of its own. Configured tracks appear in both columns regardless of
arm state — arming governs what records, never what the arrangement shows.

## Consequences

Positive: the "same rows, same order, same count" contract is structural
rather than a convention, and is unit-testable on the emitted string with
no DOM; adding per-track data is a one-line change to one type instead of
an edit to two symmetrical maps; the head/lane vertical alignment #1028
depends on has exactly one source of truth, mirroring how ADR-0086 gave
the horizontal origin one.
Negative: `DawTrackRow` becomes a growth point that every later
arrangement story widens, and it carries pre-escaped strings — a mild
layering smell that means callers must interpolate its `name` raw and
never re-escape it. Row heights stay fixed, so a future variable-height
row (a folded group header, a compact density mode) must change the shared
custom property rather than letting content size the row.

## References

- [#1043 — feat: Render configured track rows and lanes](https://github.com/on-par/sound-buddy/issues/1043)
- [ADR-0087 — The arrangement frame is column-major](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0087-the-arrangement-frame-is-column-major-a-track-head-column-beside-a-timeline-column-that-owns-the-ruler.md)
- [docs/design/session-tab.md — Track head anatomy and row heights](https://github.com/on-par/sound-buddy/blob/main/docs/design/session-tab.md)
