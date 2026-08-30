# Timeline BPM is a separate display-only tempo model; the timeline scale and every coordinate stay in real seconds

- Status: Accepted
- Date: 2026-08-30

## Context

Epic #1260 wants an Ableton-style bars/beats readout on the Session arrangement
ruler, and #1273 is its first slice: the BPM value itself, with a default and
validation. The arrangement already has a shared horizontal scale model
(ADR-0100/0101): `TimelineScale` resolves a zoom state into a pixels-per-second
value and owns the `timeToX`/`xToTime` pair that the ruler, lane gridlines, the
playhead, soundcheck scrub, clip widths and waveform columns all derive from.
There were two places BPM could live. Folding a `bpm` field into `TimelineScale`
would have put tempo one property access away from every coordinate consumer, and
the moment any of them multiplies by it, playback timing, scrub targets and clip
geometry stop being grounded in real seconds — the exact failure #1260 rules out
when it says BPM "must not alter the underlying audio playback clock, waveform
rendering, playhead position, scrub targets, or clip durations." The alternative
was a standalone tempo model. Separately, invalid input needed a defined answer:
`clampTimelineScale` had already settled the house rule for the sibling model —
out-of-range snaps to the nearest bound, non-finite falls back to the default
rather than propagating NaN — and a second, differently-shaped validation rule in
the same subsystem would be drift for its own sake. A store field or a persisted
AppSettings/session.json field was also considered and rejected for this slice:
nothing reads BPM yet, and persistence is a schema-and-migration change with
paid-product risk that no acceptance criterion asks for.

## Decision

`app/renderer/src/timeline-bpm.ts` owns the arrangement's tempo as a model
separate from `timeline-scale.ts`. It exports `TIMELINE_DEFAULT_BPM` (120), the
bounds `TIMELINE_MIN_BPM` (20) and `TIMELINE_MAX_BPM` (300), the pure
`clampTimelineBpm`, the frozen `TimelineTempo` state object, and the
`createTimelineTempo` / `withTimelineBpm` constructors. Validation mirrors
`clampTimelineScale` exactly: a request outside the bounds resolves to the nearest
bound, and a non-finite request resolves to `TIMELINE_DEFAULT_BPM`.

`TimelineScale` does not gain a `bpm` field, and `timeline-bpm.ts` imports neither
`timeline-scale.ts` nor `daw-shell-runtime.ts` — tempo cannot reach a pixels-per-second
value, and a scale consumer cannot reach a tempo. From here on, BPM is a display-only
input to musical labeling: seconds remain the sole time base for the playback clock,
playhead position, scrub target, clip duration, and waveform geometry, and no code
may convert a coordinate or a transport value through BPM. Quantization, snapping,
warping, beat-locked playback and tempo maps remain out of scope and may not be
introduced under cover of this model. Nothing consumes the model in this slice; the
musical ruler labels and the toolbar BPM control are the follow-up slices of #1260
and must build on these exports rather than inventing their own default or bounds.

## Consequences

Positive: the "display BPM never touches real-seconds state" rule is enforced by
module structure rather than by review — a coordinate path that wanted to use tempo
would have to add an import that does not exist today. Default and clamping are
unit-testable with no DOM, no store and no React, and the model lands with zero
shipped behavior change and no persisted-data risk, the same way #1262 landed the
scale model. Sharing `clampTimelineScale`'s validation semantics means one rule to
learn for the whole timeline subsystem.

Negative: a surface that eventually needs both zoom and tempo (the bars/beats ruler)
has to hold two objects instead of one, and keeping them consistent is that caller's
job. The 20–300 range and the 120 default are judgement calls with no persisted data
behind them, so widening them later is a code change rather than a setting. Because
BPM is not persisted, a user-chosen tempo will not survive a restart until a later
issue adds storage deliberately.

## References

- [#1273 — Add BPM value with default and validation to the Session timeline](https://github.com/on-par/sound-buddy/issues/1273)
- [#1260 — feat: Add BPM-backed beats/time ruler display without quantization](https://github.com/on-par/sound-buddy/issues/1260)
- [ADR-0100 — The timeline scale model is a pure state-plus-bounds object](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0100-the-timeline-scale-model-is-a-pure-state-plus-bounds-object-zoomed-in-and-zoomed-out-are-the-clamp-bounds.md)
