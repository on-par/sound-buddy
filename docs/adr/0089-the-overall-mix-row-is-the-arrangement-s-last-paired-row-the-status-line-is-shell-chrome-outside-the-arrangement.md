# The overall-mix row is the arrangement's last paired row; the status line is shell chrome outside the arrangement

- Status: Accepted
- Date: 2026-08-21

## Context

docs/design/session-tab.md gives the Session tab two session-wide bands below the
track area: a 60px master row (top border `--border-strong`) and a 26px status
line (track/capture summary left, device right). ADR-0087 already fixes
`.daw-arrangement` at exactly two children — a track-head column and a timeline
column — and requires every arrangement row to be emitted twice, once into each
column, kept aligned by fixed row heights. That leaves two open questions this
story has to answer, and both would be expensive to reverse once #992 (arm /
mute / solo), #1028 (two-column layout, pinned head column, full-height playhead)
and #995 (transport) build on top of them: whether the overall-mix row is a
third, row-major child of the arrangement, and whether the status line belongs
inside the arrangement or beside it. Before this story the mix lane existed as
the FIRST lane in the lane column with no head cell at all, which reads as "the
mix is track zero" — the opposite of the spec's pinned master band.

## Decision

The overall-mix row is emitted like every other arrangement row: twice, once per
column, and last in each — a `.daw-master-head` cell closing `.daw-track-heads`
and the `.daw-mix-lane` closing `.daw-lane-column`. It is deliberately NOT a
`.daw-track-head`/`.daw-channel-lane`: it carries no track index, is never
derived from `dawTrackRows`, and renders even when no tracks are configured, so
per-track features (arm, mute, solo, colour strip, channel selection) must never
sweep it. Its height comes from `--daw-master-row-h`, read by both cells.
The status line is NOT part of the arrangement. `dawShellHTML` emits
`.daw-status-line` as a sibling of `.daw-arrangement` inside `.daw-shell`,
keeping ADR-0087's two-children invariant intact, and derives its three strings
from one pure `dawStatusLineView(state)` — track count from the shared
`dawTrackRows` list (ADR-0088), capture label from `dawShellPatchView`'s
transport chip, device name from the existing `deviceNameFor` — so the status
line can never disagree with the head column, the lane column, or the transport
chip about the same state.

## Consequences

Positive: the arrangement's structural contract stays exactly as ADR-0087 wrote
it, so #1028 can scroll the lane column and pin the head column without a
special case for a row-major master child; the master row's "not a track"
status is visible in the markup, so #992's arm/mute/solo sweep cannot pick it up
by accident; the status line, being shell chrome, survives any arrangement
scroll or zoom the epic later adds; the track count, capture label and device
name have exactly one derivation each.
Negative: the master row is emitted in two places like every other row, so its
height must be changed in both cells (`--daw-master-row-h` is the mitigation,
not a guarantee); the mix lane's body loses its hardcoded 56px height and now
fills the spec'd 60px row, so the mix waveform paints slightly shorter than
before; and the status line sitting outside `.daw-arrangement` means a future
full-height playhead spanning shell chrome would have to opt out of it
explicitly.

## References

- [#1044 — feat: Render overall-mix row and arrangement status](https://github.com/on-par/sound-buddy/issues/1044)
- [ADR-0087 — The arrangement frame is column-major](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0087-the-arrangement-frame-is-column-major-a-track-head-column-beside-a-timeline-column-that-owns-the-ruler.md)
- [ADR-0088 — Arrangement head rows and lane rows render from one shared ordered track list](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0088-arrangement-head-rows-and-lane-rows-render-from-one-shared-ordered-track-list.md)
- [docs/design/session-tab.md — Vertical structure (master row, status line)](https://github.com/on-par/sound-buddy/blob/main/docs/design/session-tab.md)
