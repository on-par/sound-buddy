# Lane-background presses route to the insert marker on pointerdown, hit-tested against the painted clip rects

- Status: Accepted
- Date: 2026-08-30

## Context

#1301 gave the arrangement a real insert marker but no way for a user to move it,
and epic #1256's remaining slices (clip selection, drag time-selection, destructive
edits) all have to agree on one question first: what counts as a press on "lane
background", and what does such a press do?

Three facts in this checkout constrain the answer. First, `.daw-take-clip` is
`pointer-events:none` in `app.css` — the clip is a painted overlay, not an
interactive element — so a press over a clip already reports the enclosing
`.daw-lane` as its event target. Any hit-test written as
`e.target.closest('.daw-take-clip')` therefore reports "background" for every press
in the arrangement, and would look correct in review while being unconditionally
wrong. Second, `.daw-lane` is already a scrub surface: `session-ruler-scrub.ts`'s
`canBeginSessionScrub` lets a lane press begin a playhead scrub while a session is
playing, and ADR-0015 commits that scrub's seek on pointer release. A marker route
that fired on click would fire at the release point of a drag, not at the press the
user meant. Third, ADR-0114 keeps both arrangement positions in the pure
`sessionTimelineMarks` model and out of React and zustand (ADR-0005), because the
model notifies on every playhead write — once per animation frame — so any React
subscription to it re-renders the board at frame rate.

## Decision

`app/renderer/src/lane-background-click.ts` owns the lane-background press decision
as a pure module: no DOM types, no store, no React import, all side effects
injected. A press qualifies only when it is the primary button (`button === 0`) and
its `clientX` falls inside none of the pressed lane's take-clip CLIENT RECTS — the
clip's laid-out box is the hit-test's ground truth, never the event target and
never a re-derivation of the clip's shell-local geometry. Every future arrangement
hit-test against a pointer-events:none painted child follows this rule.

A qualifying press resolves its time from the offset between `clientX` and the
pressed `.daw-lane`'s own left edge (the shared t=0 edge, the same reference the
scrub uses), plus the visible range's scroll offset, converted through
`timeline-scale.ts`'s origin-free `timelineSpanSecsAt` at the shared
`pxPerSecond` — it computes no origin and no scale of its own (ADR-0086/0090).
Negative offsets resolve to 0.

The route runs on pointerdown, from `LiveCapturePanel.tsx`'s existing
`onBoardPointerDown`, BEFORE the scrub gate and independently of it: an engineer
places the edit point whether or not the transport is running and whether or not a
scrub follows the same press. Its entire effect surface is the two injected deps
`setInsertMarkerSecs` and `repaintInsertMarker`, so the route is structurally
incapable of touching selection state — the "background clicks never select" rule
is enforced by the type, not by a convention. `LANE_TAKE_CLIP_CLASS` is exported
from this module and consumed by `live-workspace-view.ts`'s take-clip span, so the
painter and the hit-test selector cannot drift.

Because the marker can now move between renders, the `.daw-zoom-btn` branch reads
`sessionTimelineMarks.getInsertMarkerSecs()` at click time rather than the snapshot
captured in the render's `TimelineZoomContext`.

## Consequences

Positive: the routing decision is a pure function with a colocated unit suite and
no DOM environment, so "a press over a clip changes nothing" and "a press after a
pan lands under the cursor" are unit assertions. The clip-selection and
drag-selection slices inherit a hit-test that already works against
pointer-events:none clips, and inherit a marker they can read without adding a
store field. The scrub is untouched: its gate, its capture and its release-commit
are exactly as ADR-0015 left them.

Negative and accepted: a lane press while a session is playing now does two things
— it moves the insert marker AND it may begin a scrub — which is Ableton's
behaviour but is two effects from one gesture, and the marker moves even on the
press that starts a drag the user later cancels. The whole `.daw-lane` row is
treated as background, including the 140px `.daw-lane-name` label at its left edge,
so pressing the label places the marker at the time under it; that is consistent
with the existing scrub's treatment of the same pixels and is left for the
lane-chrome slice to revisit. The scrub's own pointer-to-time conversion
(`soundcheckTimelinePreviewFromPointer`) still ignores the scroll offset — a
pre-existing gap this slice deliberately does not widen its scope to fix, so the
marker and a scrub seek can disagree by the pan distance while the arrangement is
scrolled.

## References

- [Issue #1302](https://github.com/on-par/sound-buddy/issues/1302)
- [Epic #1256](https://github.com/on-par/sound-buddy/issues/1256)
- [ADR-0114 — playhead and insert marker are two independent seconds values](0114-the-arrangement-s-playhead-and-insert-marker-are-two-independent-seconds-values-in-one-shared-pure-model-written-by-the-paint-path-and-never-by-the-store.md)
