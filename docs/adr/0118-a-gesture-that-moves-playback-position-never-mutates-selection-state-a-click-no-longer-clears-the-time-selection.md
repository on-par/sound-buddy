# A gesture that moves playback position never mutates selection state; a click no longer clears the time selection

- Status: Accepted
- Date: 2026-08-30

## Context

Three routes share the Session arrangement's pointerdown surface. ADR-0110
made `.daw-ruler` a scrub zone that previews on move and commits one seek on
release. ADR-0115 made a `.daw-lane` background press place the insert
marker. ADR-0116 made a press on a painted clip select that clip. ADR-0117
then armed `beginTimeSelectionDrag` on every ruler / lane-background press
and, for a press that never crossed the 4px threshold, had it CLEAR any
existing time selection — "the standard collapse-to-insert-point behaviour".

That clause and the scrub's commit-on-release are the same physical gesture.
A ruler click seeks; under ADR-0117 it also wiped the time-range selection.
Issue #1305 states the opposite requirement outright: a scrub or seek must
update playback position and nothing else, because a selection that
disappears when the engineer moves the playhead makes the whole selection
model untrustworthy — the exact trust failure the paid-product standard
treats as a failed change regardless of test status. The two cannot both
hold, so one had to give, and the issue is the later authority.

A secondary force: the clear also fired on a pointercancel that never
crossed the threshold — an OS-level gesture interruption destroying user
state that the gesture had never written.

## Decision

A press on the arrangement that does not become a drag calls no selection
dep at all. `beginTimeSelectionDrag`'s pointerup path no longer calls
`clearSelection()`/`repaint()` when `dragged` is false — it only reports
`onDragEnd(false)` — and its pointercancel path clears only when the
gesture had already crossed `TIME_SELECTION_DRAG_THRESHOLD_PX` and
therefore already overwrote the selection.

This narrows ADR-0117: the threshold still arbitrates drag-vs-click and a
drag still creates a time selection and suppresses the scrub's
release-commit, but the click half is now inert with respect to selection
rather than a collapse-to-insert-point clear. ADR-0117's other clauses
stand unchanged.

The invariant this generalises to, binding on every future arrangement
gesture: a route that writes playback position (the scrub's `seekTo`, the
clip route's Option/Alt seek) must carry no clip-selection or
time-selection writer in its deps, so the "the deps ARE the contract"
discipline of ADR-0115/0116/0117 makes the preservation structural rather
than a rule someone must remember. `session-timeline-scrub.ts` already
satisfies this and a source gate in `daw-workspace-shell.test.ts` now
holds it there.

## Consequences

Positive: a clip stays visibly selected and a time range stays painted
across any number of scrubs and seeks, which is what makes the selection
model worth having; an interrupted (cancelled) press can no longer destroy
state it never wrote; the preservation is proven by a composition test that
wires the real scrub and drag gestures against the real shared selection
singletons, so a future re-wiring of `onBoardPointerDown` that reintroduces
the clobber fails a test rather than shipping.

Negative: there is no longer a one-click way to clear a time selection. The
remaining clears are a degenerate drag (release back on the anchor) and a
session load/switch. A dedicated deselect affordance (Escape, or a click in
a non-arrangement region) is follow-up work, not part of this decision.
ADR-0117's written text now overstates the click's effect and must be read
together with this ADR.

## References

- [ADR-0117 — A drag on the ruler or lane background creates a time selection and suppresses the scrub's release-seek; a click without movement clears it](docs/adr/0117-a-drag-on-the-ruler-or-lane-background-creates-a-time-selection-and-suppresses-the-scrub-s-release-seek-a-click-without-movement-clears-it.md)
- [ADR-0110 — The Session ruler is a scrub zone that starts playback when stopped; lanes stay playing-only](docs/adr/0110-the-session-ruler-is-a-scrub-zone-that-starts-playback-when-stopped-lanes-stay-playing-only.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/1305)
