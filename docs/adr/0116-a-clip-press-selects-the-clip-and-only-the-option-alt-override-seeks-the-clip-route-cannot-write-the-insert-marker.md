# A clip press selects the clip and only the Option/Alt override seeks; the clip route cannot write the insert marker

- Status: Accepted
- Date: 2026-08-31

## Context

#1302 (ADR-0115) gave the arrangement one pointerdown route: a press on `.daw-lane`
background places the insert marker, hit-tested against the painted take clips' client
rects because `.daw-take-clip` is `pointer-events:none`. That route deliberately declines
on a clip hit and does nothing else, which left the clip half of epic #1256 undefined:
pressing a clip fell through to `beginSessionTimelineScrub`, so while a session was
playing it moved the transport on release, and nothing anywhere in the renderer recorded
"which clip is selected".

Three existing constraints shape the answer. ADR-0114 makes `renderPlayhead` the single
writer of the shared playhead seconds, so a route that wants to "move playback position"
may not write the model — it must go through `soundcheckStore.seekTo`, ADR-0013's
restart-with-start-offset, which also starts playback when stopped (the same trade
ADR-0110 accepted for the ruler zone). ADR-0005/0114 keep arrangement state out of
zustand and React, so a new selection field in `liveCaptureStore` would re-render the
board on a press and would collide with `selectedChannel`, which already means "strip
inspected in the EQ pane" — a meaning #1302's source gate forbids pointerdown from
touching. And the modifier had to dodge taken keys: Ctrl-click is a macOS secondary
click, Ctrl/Cmd-wheel is the zoom gesture (ADR-0113), and Shift is the conventional
range-extend for the drag-selection slice still to come.

## Decision

`app/renderer/src/clip-click.ts` owns the clip-press decision as a pure module and
`app/renderer/src/clip-selection.ts` owns the selection it writes. A primary-button press
whose clientX falls inside one of the pressed lane's painted take-clip client rects —
tested with ADR-0115's own `laneClipHitAt`, reused rather than re-implemented, so the clip
route and the background route are exact complements — selects that lane's clip. Selection
identity is the lane's channel index today, held in the shared, pure, subscribe-on-change
`sessionClipSelection` model (the `sessionTimelineMarks` shape), never in the store and
never in React state.

A plain clip press moves nothing else: `ClipClickDeps` is exactly `selectClip`,
`repaintClipSelection` and `seekTo`, with no insert-marker member, so the route is
structurally incapable of moving the marker — the mirror image of ADR-0115, where the
background route was structurally incapable of selecting. `LiveCapturePanel`'s
`onBoardPointerDown` runs the clip route first and returns on any non-`none` decision, so a
clip press reaches neither the background route nor the scrub.

Option/Alt (`e.altKey`) is the arrangement's seek-target override. Holding it on a clip
press also seeks the transport to the pressed instant, resolved through the same
lane-left-edge + scroll-offset + `timelineSpanSecsAt` conversion the background route uses,
and gated on the caller-supplied `canSeek` — the panel passes
`canBeginSessionScrub('ruler', gate())`, so an override press is allowed exactly where a
ruler press is. Playback position is moved only through `soundcheckStore.seekTo`; no route
outside `renderPlayhead` writes the playhead model.

Selection is painted imperatively, like the insert marker: `daw-shell-runtime.ts` takes an
optional `clipSelection` dep and its `renderClipSelection()` toggles the
`clip-selected` class on the matching `.daw-channel-lane`. The class goes on the lane, not
the clip span, because the clip class constant lives in `lane-background-click.ts`, whose
import of `timeline-scale.ts` would close an ESM cycle back into the painter.

## Consequences

Positive: "a plain clip press leaves the insert marker alone" is enforced by a type rather
than by review, and both halves of the press are unit assertions over a pure function with
no DOM. The drag-time-selection and destructive-edit slices of #1256 inherit a selection
model they can read without adding a store field, and a hit-test that already agrees with
the background route by construction. The painter stays off the per-frame path — it runs on
a press and after a board rebuild only.

Negative and accepted: pressing a clip while a session is playing no longer starts a scrub,
a behaviour that shipped in #736 — clip pixels are now select-only unless the override is
held, and users who scrubbed by dragging across a clip must drag from lane background or
the ruler. An override press while stopped starts playback at the pressed instant rather
than merely parking a position, because ADR-0013's restart-with-start-offset is the only
seek mechanism; that is the same trade ADR-0110 accepted for the ruler. Selection identity
is a channel index, which is exact only while a lane holds at most one take clip; a
multi-clip lane will have to widen it to a compound id. And Option/Alt is claimed for the
arrangement's seek override, so it is unavailable to a future clip gesture on macOS.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1303)
- [Epic](https://github.com/on-par/sound-buddy/issues/1256)
- [ADR-0115 — lane-background presses route to the insert marker on pointerdown](docs/adr/0115-lane-background-presses-route-to-the-insert-marker-on-pointerdown-hit-tested-against-the-painted-clip-rects.md)
- [ADR-0114 — playhead and insert marker are two independent seconds values](docs/adr/0114-the-arrangement-s-playhead-and-insert-marker-are-two-independent-seconds-values-in-one-shared-pure-model-written-by-the-paint-path-and-never-by-the-store.md)
