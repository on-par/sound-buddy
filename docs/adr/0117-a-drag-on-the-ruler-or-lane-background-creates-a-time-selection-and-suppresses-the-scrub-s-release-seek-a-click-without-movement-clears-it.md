# A drag on the ruler or lane background creates a time selection and suppresses the scrub's release-seek; a click without movement clears it

- Status: Accepted
- Date: 2026-08-31

## Context

The Session arrangement's pointerdown surface already carried three routes before
this issue. ADR-0110 made `.daw-ruler` a scrub zone whose gesture previews on move
and commits one seek on release, and which starts playback from a stopped session.
ADR-0115 made a `.daw-lane` background press place the insert marker on pointerdown.
ADR-0116 made a press on a painted take clip select that clip and return before
anything else runs, and explicitly reserved Shift for "the range-extend for the
drag-selection slice still to come" and Option/Alt for the seek override.

Issue #1304 needs a plain horizontal drag on the ruler or lane background to define
a time range. That collides head-on with ADR-0110: on the ruler, a drag today IS a
scrub, so the same physical gesture would have to mean two things. Three further
forces constrain the answer. ADR-0005/0114 keep arrangement state out of zustand and
React, so a per-pointermove store write is not available. ADR-0114 makes
`renderPlayhead` the single writer of the shared playhead seconds, so nothing here
may write playback position. And the playhead rAF loop only runs while a live
capture is running, so a scrub preview abandoned mid-gesture on a stopped session
would sit at the wrong pixel indefinitely unless something repaints it.

## Decision

Movement, not a modifier, arbitrates. `app/renderer/src/time-selection-drag.ts`'s
`beginTimeSelectionDrag` starts on every qualifying primary-button press on
`.daw-ruler` or `.daw-lane` background and watches the pointer: once the pointer has
moved `TIME_SELECTION_DRAG_THRESHOLD_PX` (4px) horizontally from the press point the
gesture is a time-selection drag, and it stays one for the rest of the gesture even
if the pointer returns inside the threshold. Below the threshold the gesture is a
click and every pre-existing route (ADR-0110's ruler seek, ADR-0115's insert marker)
behaves exactly as before; a click additionally CLEARS any existing time selection,
the standard collapse-to-insert-point behaviour.

A drag suppresses the scrub's release-commit. `session-timeline-scrub.ts` is not
modified: the panel composes through its existing `canCommitSeek` callback, which
now also reads the drag handle's `hasDragged()`. On drag end the panel repaints the
playhead so an abandoned scrub preview can never be left stale. The drag begins
BEFORE the `canBeginSessionScrub` gate in `onBoardPointerDown`, so a time selection
can be drawn on a loaded-but-stopped session and on a lane where the scrub gate
(playing-only) refuses.

The selection itself lives in `app/renderer/src/time-selection.ts`: a pure,
subscribe-on-change `TimeSelectionModel` holding one `{ startSecs, endSecs }` range
or null, in the shared `sessionTimeSelection` instance — the same shape as
`sessionTimelineMarks` and `sessionClipSelection`, never in the store and never in
React state. It is a leaf module importing nothing, because `daw-shell-runtime.ts`
imports it and any relative import from it would close an ESM cycle back into the
painter. `normalizeTimeRange` is the one place that orders the two endpoints, clamps
to t >= 0 and rejects a degenerate or non-finite range.

`TimeSelectionDragDeps` deliberately has no `selectClip` member and no
insert-marker setter, so the drag route is structurally incapable of selecting a
clip — the same "the deps ARE the contract" discipline ADR-0115 and ADR-0116
established. Clearing an existing clip selection when a time selection is committed
is the panel's callback, not a capability of the module. The band is painted
imperatively by `daw-shell-runtime.ts`'s `renderTimeSelection()` through the same
`dawPlayheadX` geometry as the playhead and insert marker, as two region segments
(ruler + lane column) re-based by the one shared `--daw-scroll-x` translate.

## Consequences

Positive: one physical gesture per intent with no modifier to learn, matching the
Ableton interaction model docs/design-reference.md names; every pre-existing click
behaviour is preserved bit-for-bit because the threshold makes a click the strict
complement of a drag; `session-timeline-scrub.ts` is untouched, so ADR-0110's zone
policy, duration chain and one-seek-per-gesture guarantee all still hold; and the
selection model, the range normalisation and the drag decision are all pure and
unit-tested with no DOM.

Negative: dragging on the ruler no longer scrub-seeks — it selects time. That is a
real behaviour change to ADR-0110's gesture (a ruler CLICK still seeks, which is how
an engineer reaches a time). During a ruler drag the scrub still previews the
playhead following the pointer before the commit is suppressed, which is visible
motion that gets corrected on release; removing that preview would require editing
the scrub module and is deferred. The 4px threshold is a magic-feeling constant, so
it is a named exported constant with a comment rather than a literal. Time selection
is in-memory only — it does not survive a session switch or an app restart, matching
the insert marker and clip selection.

## References

- [ADR-0110 — The Session ruler is a scrub zone that starts playback when stopped; lanes stay playing-only](docs/adr/0110-the-session-ruler-is-a-scrub-zone-that-starts-playback-when-stopped-lanes-stay-playing-only.md)
- [ADR-0115 — Lane-background presses route to the insert marker on pointerdown, hit-tested against the painted clip rects](docs/adr/0115-lane-background-presses-route-to-the-insert-marker-on-pointerdown-hit-tested-against-the-painted-clip-rects.md)
- [ADR-0116 — A clip press selects the clip and only the Option/Alt override seeks; the clip route cannot write the insert marker](docs/adr/0116-a-clip-press-selects-the-clip-and-only-the-option-alt-override-seeks-the-clip-route-cannot-write-the-insert-marker.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/1304)
