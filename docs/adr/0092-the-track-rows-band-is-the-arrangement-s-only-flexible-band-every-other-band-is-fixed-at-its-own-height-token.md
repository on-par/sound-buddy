# The track-rows band is the arrangement's only flexible band; every other band is fixed at its own height token

- Status: Accepted
- Date: 2026-08-21

## Context

The arrangement columns (.daw-track-heads and .daw-timeline/.daw-lane-column) are
flex columns holding bands of very different natures: a ruler row, a variable
number of track rows, the overall-mix row, and — outside the arrangement — the
status line. Left as default flex items, every one of them is shrinkable, so
whichever band happens to be last gets squeezed or clipped when the track rows
outgrow the shell. #1050's acceptance criteria are precisely that the overall-mix
row renders below all track rows and the status line below it, which is a
statement about laid-out geometry, not source order — source order was already
settled by ADR-0089. docs/design/session-tab.md's vertical-structure table says
the same thing in design terms: every band is a fixed height "except the track
area", whose surplus paints --surface-inset. There are more bands coming (group
header rows, #992/#993 head controls, the #995 zoom/follow gutter), so the rule
needs to be stated once rather than rediscovered per band.

## Decision

The track-rows band — .daw-channel-lanes in the lane column and its new mirror
.daw-head-rows in the head column — is the only flexible band in the arrangement:
it declares flex:1 1 auto; min-height:0; overflow:hidden and absorbs all surplus
vertical space. Every other band declares flex:0 0 var(--daw-<band>-row-h) against
the height token it already owns: .daw-ruler and .daw-ruler-gutter at
--daw-ruler-row-h, .daw-master-head and .daw-mix-lane at --daw-master-row-h,
.daw-status-line at --daw-status-line-h. Rows inside the track band declare
flex:0 0 auto so the band, never a row, is what gives. Any future arrangement
band joins the fixed list with its own token; adding a second flexible band, or
leaving a band's flex unset, is the violation. The track band paints
--surface-inset and the master band paints --surface-raised in both columns, so
the bands are told apart by surface rather than by border alone.

## Consequences

The overall-mix row and the status line are structurally incapable of being
shrunk or clipped by the track rows above them, so the vertical hierarchy holds
at any track count and any window height. The cost is that overflowing track rows
are clipped rather than scrolled: docs/design/session-tab.md calls for the track
area to scroll, and that stays unbuilt here because two independently scrolling
columns would desync head rows from lane rows — a scrolling track area must add
cross-column scroll sync, and when it does it belongs on these same two band
elements, which is exactly why they are named and paired. The lane-column
playhead segment now spans the surplus space below the last row, which is the
intended arrangement-wide indicator (ADR-0091) rather than a row-bounded one.

## References

- [Issue #1050 — feat: Position arrangement master and status bands](https://github.com/patrob/sound-buddy/issues/1050)
- [docs/design/session-tab.md — Vertical structure](https://github.com/patrob/sound-buddy/blob/main/docs/design/session-tab.md)
- [Issue #1050](https://github.com/on-par/sound-buddy/issues/1050)
