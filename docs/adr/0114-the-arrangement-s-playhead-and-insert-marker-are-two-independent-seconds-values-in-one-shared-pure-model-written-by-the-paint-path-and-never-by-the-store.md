# The arrangement's playhead and insert marker are two independent seconds values in one shared pure model, written by the paint path and never by the store

- Status: Accepted
- Date: 2026-08-30

## Context

Epic #1256 needs click routing, drag time-selection and destructive edits on the
Session arrangement, and none of them can be specified while "the playhead" doubles
as "where the next action starts". Before this change the arrangement had one
indicator and no shared position value at all:
daw-shell-runtime.ts's renderPlayhead resolved the instant to paint per frame — the
soundcheck progress tick when a session is playing, daw-playhead-state.js's wall
clock otherwise — wrote it to every .daw-playhead segment and discarded it. The only
consumer that needed an insert point, timeline-zoom-controls.ts's zoom-to-selection
fallback, therefore centred its window on ctx.playheadSecs and ADR-0109 documented
that as "the insert-marker behaviour Ableton has when no time range is selected" —
an explicit stand-in for a marker that did not exist yet.
Three constraints shaped the fix. ADR-0005 forbids animation-rate values in
zustand or React state (the playhead ticks every frame; #720's flicker defect came
from exactly that), so a store field was not available. ADR-0086/0090 require every
absolutely positioned arrangement child to take its x from the one shared geometry
and to re-base through the one shared translate, so a second indicator cannot invent
its own coordinate. And the playhead's value is genuinely resolved in only one
place — the paint function that already picks between the tick and the clock — so
any other writer would be a second, drifting source of truth.

## Decision

app/renderer/src/timeline-state.ts owns both arrangement positions. It exports the
frozen TimelineMarks value ({ playheadSecs, insertMarkerSecs }), a clamped
read/update/subscribe surface (TimelineMarksModel), the pure factory
createTimelineMarksModel(), and one shared sessionTimelineMarks instance — the same
shape and the same "pure, no DOM, no store, no React" rule
timeline-visible-range.ts follows. Both values are real seconds from t=0; the module
computes no pixels and must not import daw-shell-runtime.
daw-shell-runtime.ts's renderPlayhead is the ONE writer of playheadSecs: it writes
the instant it just painted, so the shared value can never disagree with the pixels
on screen, and no other module may call setPlayheadSecs. insertMarkerSecs is written
only by user intent (session load resets it to
TIMELINE_INSERT_MARKER_DEFAULT_SECS = 0; the click-routing and selection slices of
#1256 will write it from gestures). The marker renders as .daw-insert-marker
segments in the ruler and over the lane column, painted by renderInsertMarker
through the same dawPlayheadX geometry and joined to the shared re-base rule, with a
deliberately different treatment from the playhead (1px azure line plus a ruler flag
head, against the playhead's 2px muted/gold bar).
Neither value is persisted and neither enters zustand. timeline-zoom-controls.ts's
zoom-to-selection fallback now centres on TimelineZoomContext.insertMarkerSecs when
one is supplied, falling back to the playhead only for callers that supply none —
this supersedes ADR-0109's "window centred on the playhead" clause, which was a
stand-in for this marker.

## Consequences

Positive: the two positions are independently testable with no DOM and no React, so
"the playhead advanced but the insert point did not" is a unit assertion rather than
a manual observation. Every later #1256 slice has one obvious place to write a
clicked or dragged position, and one obvious place to read it, instead of adding a
store field per interaction. The insert marker and the playhead cannot disagree
about where a second sits, because both resolve through dawPlayheadX. The
zoom-to-selection fallback finally means what its name says.
Negative and accepted: a module-level singleton (sessionTimelineMarks) is shared
mutable state outside React — justified by the same reasoning as
SESSION_TIMELINE_SCALE and required by ADR-0005, but it means tests that care about
cross-test isolation must build their own createTimelineMarksModel() rather than
touch the singleton. Making renderPlayhead the sole writer means the shared
playheadSecs is only as fresh as the last paint: a reader that runs before the first
renderPlayhead of a session sees 0. And the insert marker ships in this slice with
no way for a user to move it — it sits at t=0 until #1256's click-routing slice
lands, which is deliberate scope, and the PR says so.

## References

- [Issue #1301](https://github.com/on-par/sound-buddy/issues/1301)
- [Epic #1256](https://github.com/on-par/sound-buddy/issues/1256)
