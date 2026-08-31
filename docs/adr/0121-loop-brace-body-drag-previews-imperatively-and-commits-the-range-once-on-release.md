# Loop brace body drag previews imperatively and commits the range once on release

- Status: Accepted
- Date: 2026-08-31

## Context

#1313 painted the loop brace from `sessionLoopRegion` through the shell runtime's
`renderLoopBrace`, and ADR-0120 pinned `LoopRegionModel` as a range-only model with no
enablement or gesture state. #1315 makes the brace body draggable, which forces a choice
about where an in-flight, not-yet-committed loop range lives and who paints it.

Two forces pull against each other. The brace must track the pointer at pointer-move
rate to feel direct, and every arrangement surface must stay pixel-aligned with the
ruler ticks — the alignment e2e from #1313 asserts that across scroll and zoom, and it
holds only because one function (`dawPlayheadX`, via `renderLoopBrace`) owns the
geometry. Writing each intermediate range into `sessionLoopRegion` would satisfy the
first at the cost of notifying every subscriber per move and putting transient state in
a shared model; computing the preview's pixels in the panel would satisfy the first at
the cost of a second, drift-prone copy of the geometry.

The repo has already settled the same trade twice: ADR-0005 keeps animation-rate updates
out of the store and out of React, and ADR-0015 has the soundcheck scrub follow the
pointer via imperative writes and commit a single seek on pointer release.
`time-selection-drag.ts` (#1304) additionally established the gesture shape this shell
uses — a pure module with a structural window type, pointerId matching, a 4px
click-vs-drag threshold, and all effects injected. The remaining question was only how
the preview reaches the pixels without duplicating the painter, and how far a dragged
range may travel.

## Decision

The loop brace body drag previews imperatively and commits once. `beginLoopBodyDrag`
(app/renderer/src/loopBrace.bodyDrag.ts) is a pure leaf gesture module: it holds the
anchor region captured at pointerdown, converts each pointer delta to seconds through
`timelineSpanSecsAt`, and calls its injected `previewRegion` on every move past
`LOOP_BODY_DRAG_THRESHOLD_PX`. It writes `sessionLoopRegion` through its injected
`commitRegion` exactly once, on pointerup, and only when the threshold was crossed; a
pointercancel previews the anchor region back and commits nothing.

The preview reaches pixels only through the shell runtime. `DawShellRuntime` gains
`previewLoopBrace(region)`, and both it and `renderLoopBrace()` delegate to one internal
`paintLoopBrace(region)` — so a previewed brace is painted by the same `dawPlayheadX`
geometry as a committed one and cannot drift from the ruler.

Clamping is the pure, tested `movedLoopRegion(region, deltaSecs, maxSecs?)`: it
translates both endpoints by the delta, never changes the length, holds `startSecs` at
or above 0, and holds `endSecs` at or below `maxSecs` when a bound is supplied, with the
minimum winning if the two clamps conflict. A dragged loop stops at the bound; it never
shrinks to fit.

Future loop gestures — handle/edge resize, promoting a time selection to a loop — must
follow this shape: preview through `previewLoopBrace`, commit through
`LoopRegionModel.setRegion` on release, keep clamp math in a pure function, and add no
gesture state to `LoopRegionModel`.

## Consequences

Positive: the shared loop model is written once per gesture, so subscribers never see a
stream of intermediate ranges and a cancelled drag leaves no trace. All the interesting
logic — length preservation, clamping, threshold, commit-once — is pure and unit-tested
with no DOM, no store and no Electron. Preview and commit cannot disagree about where a
second sits, because they are the same painter. The next slice (edge resize) inherits a
finished pattern rather than inventing one.

Negative: the in-flight range is invisible to anything that reads `sessionLoopRegion`
mid-drag (an accessibility label or a playback engine would announce or loop the stale
range until release) — acceptable while the brace is a decorative, aria-hidden
affordance, but a future live-announcing or loop-playback slice must revisit it. The
runtime grows a second brace entry point that a caller could use to paint a range the
model does not hold, so a bug could leave the brace showing a range that was never
committed until the next `renderLoopBrace`. And enabling pointer events on the brace
takes a 6px strip of the ruler away from the seek/scrub and time-selection routes while
Loop is on.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1315)
- [ADR-0015 — Soundcheck scrub commits seeks on pointer release, not per pointer-move](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0015-soundcheck-scrub-commits-seeks-on-pointer-release-not-per-pointer-move.md)
- [ADR-0120 — Loop enablement lives in soundcheckStore.looping; the loop region model stays enablement-free](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0120-loop-enablement-lives-in-soundcheckstore-looping-the-loop-region-model-stays-enablement-free.md)
