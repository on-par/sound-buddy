# The timeline scale model is a pure state-plus-bounds object; zoomed-in and zoomed-out ARE the clamp bounds

- Status: Accepted
- Date: 2026-08-30

## Context

ADR-0086 made `DAW_TIMELINE_PX_PER_SECOND` (8) the single arrangement scale and
required every time-positioned surface — ruler ticks, lane gridlines, the playhead,
soundcheck scrub, clip widths, waveform columns — to derive its x by calling
`dawTimelineX`. That gave alignment for free but left the scale a module constant,
so #1254's zoom work has nowhere to put a second scale value without each call site
inventing its own pixels-per-second math (exactly the drift ADR-0086 exists to
prevent). Epic #1254 asks for at least fit / default / zoomed-in / zoomed-out states
with clamped bounds, no persisted-data change, and the current fixed behavior as the
default until zoom UI lands. Two shapes were available: parameterize `dawTimelineX`
with a scale argument immediately (which forces every existing caller to change in
the same PR, and leaves the bounds and the fit computation homeless), or introduce a
standalone scale model first and convert call sites in a follow-up slice. A third
question was whether the clamp bounds should be independent numbers or the zoom
states themselves; independent bounds would add a degree of freedom no acceptance
criterion exercises.

## Decision

`app/renderer/src/timeline-scale.ts` owns the arrangement's horizontal scale model.
It exports a `TimelineZoomState` union of exactly `'fit' | 'default' | 'zoomed-in' |
'zoomed-out'`, the derived bounds `TIMELINE_SCALE_MIN_PX_PER_SECOND` and
`TIMELINE_SCALE_MAX_PX_PER_SECOND`, and the pure functions `clampTimelineScale`,
`timelineScaleValue`, `timelineXAt` and the `createTimelineScale` factory, which
returns a frozen `{ state, pxPerSecond, timeToX }`.

The zoomed-out scale IS the minimum bound and the zoomed-in scale IS the maximum
bound — both derived from the default by a single named `TIMELINE_ZOOM_STEP` factor.
There is no second pair of clamp numbers. `'default'` resolves to
`DAW_TIMELINE_PX_PER_SECOND` exactly, and `timelineXAt` uses
`DAW_TIMELINE_ORIGIN_PX` as t=0, both imported from `daw-shell-runtime.ts` — this
module never redefines, aliases, or hardcodes either number, and ADR-0086's
one-origin/one-default rule stands unchanged. `'fit'` is the only state computed
from runtime inputs (`viewportWidthPx / durationSecs`, clamped), and it degrades to
the default scale when the fit request is missing or degenerate.

From here on, every arrangement surface that needs a horizontal coordinate at a
non-default zoom must consume a `TimelineScale` — it may not multiply by
`DAW_TIMELINE_PX_PER_SECOND` itself, and it may not introduce its own bounds or its
own fit computation. Converting the existing `dawTimelineX` call sites onto this
model is the follow-up slice of #1254; until then `dawTimelineX` remains the correct
call for fixed-scale geometry, because `createTimelineScale('default').timeToX` is
provably identical to it.

## Consequences

Positive: zoom becomes a value a caller passes rather than a constant a caller
reads, so the ruler / gridline / playhead / clip / waveform alignment invariant stays
a single arithmetic identity at every zoom level. Clamping is unit-testable with no
DOM, no store and no React. Because 'default' is the untouched existing constant,
the model can land with zero shipped behavior change and no persisted-data risk.
Bounds cannot silently disagree with the zoom states, because they are the same two
numbers.

Negative: for the duration of the follow-up slice the codebase has two ways to ask
for an x coordinate (`dawTimelineX` and `TimelineScale.timeToX`), a duplication that
is only acceptable because they are provably equal at the default scale and the
second slice deletes the ambiguity. Tying the bounds to the zoom states means widening
the zoom range later is a change to `TIMELINE_ZOOM_STEP` (or to the bound constants)
rather than a free UI decision. A `fit` scale is a float, so any future comparison
against it needs an epsilon rather than equality.

## References

- [#1262 — Introduce shared timeline scale model with zoom states and clamping](https://github.com/on-par/sound-buddy/issues/1262)
- [#1254 — feat: Shared zoomable timeline scale for ruler, playhead, gridlines, clips, and waveforms](https://github.com/on-par/sound-buddy/issues/1254)
- [ADR-0086 — DAW timeline geometry is one shell-local coordinate space](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0086-daw-timeline-geometry-is-one-shell-local-coordinate-space-whose-origin-is-the-track-head-column.md)
