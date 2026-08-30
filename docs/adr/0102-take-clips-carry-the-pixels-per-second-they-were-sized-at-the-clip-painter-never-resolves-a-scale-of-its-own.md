# Take clips carry the pixels-per-second they were sized at; the clip painter never resolves a scale of its own

- Status: Accepted
- Date: 2026-08-30

## Context

ADR-0100 made `TimelineScale` the one producer of arrangement x coordinates and
forbade any surface from multiplying by `DAW_TIMELINE_PX_PER_SECOND` itself;
ADR-0101 added the matching `xToTime` inverse and forbade dividing by a scale
constant. Loaded-take clips are the first surface converted onto that rule that is
split across two phases: `sessionTabWaveformView` computes the clip's geometry as
pure data during React render, while `paintSessionTabWaveformClips` paints that
clip's cached peaks imperatively into a canvas in a later effect, and the painter
needs a pixels-per-second value of its own to aggregate peak buckets into pixel
columns (`waveformColumns`). The obvious symmetrical move — give the painter its own
optional `TimelineScale` parameter, exactly as `dawRulerTicks`/`dawLaneGridlines`
(#1263) and `soundcheckTimelinePreviewFromPointer` (#1264) got — reintroduces the
failure ADR-0086 exists to prevent, one level down: two injection points for one
clip means a caller can size a clip at one zoom state and paint it at another, and
at the default scale the two happen to agree, so the bug would be invisible until
zoom UI ships. The same hazard applies to every future imperative arrangement
painter (live lane waveforms, clip labels, region overlays), not just this one.

## Decision

A clip view model carries the scale it was sized at. `SessionTabWaveformClip` gains a
required `pxPerSecond: number`, set from the resolved `TimelineScale.pxPerSecond` at
the moment `sessionTabWaveformView` computes `leftPx` and `widthPx`, and
`paintSessionTabWaveformClips` reads `clip.pxPerSecond` rather than taking a scale
parameter or reading a module constant. Only the model builder resolves or accepts a
`TimelineScale`; the painter is a pure consumer of already-resolved geometry. Clip
width is derived as the difference of the scale's time-to-x outputs at the take's
start and end times — `scale.timeToX(endSecs) - scale.timeToX(startSecs)` — not as a
duration multiplied by `pxPerSecond`, so it stays correct under any future scale that
is not a bare linear multiply. Every future imperative arrangement painter follows
this rule: it receives the resolved scale value on the object it is painting, and
never accepts, resolves, or reads one for itself.

## Consequences

Positive: a clip and its waveform are provably at the same scale at every zoom state,
because the number is resolved once and carried, not re-derived. The painter stays a
signature-stable, side-effect-only function with nothing to configure, and the zoom UI
in #1254 only has to pass a scale in one place. `pxPerSecond` on the clip also makes
the resolved scale visible to tests and to `laneSignature` without exporting a global.
Negative: `SessionTabWaveformClip` is now a slightly wider structure that must be
constructed with a scale — any hand-built clip literal (currently only a test fixture)
must supply `pxPerSecond`, and a caller that mutates a clip's `widthPx` without
updating `pxPerSecond` produces an internally inconsistent clip that no type check
catches. This is a view-model-only field; it is never persisted and never crosses IPC.

## References

- [#1266 — Wire loaded-take clip width and waveform painting to the shared timeline scale](https://github.com/on-par/sound-buddy/issues/1266)
- [#1254 — Shared zoomable timeline scale for ruler, playhead, gridlines, clips, and waveforms](https://github.com/on-par/sound-buddy/issues/1254)
- [ADR-0100 — The timeline scale model is a pure state-plus-bounds object](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0100-the-timeline-scale-model-is-a-pure-state-plus-bounds-object-zoomed-in-and-zoomed-out-are-the-clamp-bounds.md)
- [ADR-0101 — The timeline scale carries its own x-to-time inverse](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0101-the-timeline-scale-carries-its-own-x-to-time-inverse-hit-testing-may-never-divide-by-a-scale-constant.md)
