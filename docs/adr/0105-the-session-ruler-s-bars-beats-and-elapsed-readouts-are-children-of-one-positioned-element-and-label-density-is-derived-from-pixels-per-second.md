# The Session ruler's bars/beats and elapsed readouts are children of one positioned element, and label density is derived from pixels-per-second

- Status: Accepted
- Date: 2026-08-30

## Context

Epic #1260's ruler slice (#1275) has to put two readouts — musical bars/beats and
elapsed M:SS — on the same arrangement ruler and keep them agreeing about position
while the timeline zooms or scrolls. The arrangement already has one shared
horizontal scale (ADR-0100/0101: `TimelineScale` owns `timeToX`/`xToTime` for the
ruler, gridlines, playhead, clips and waveform columns) and one display-only tempo
model (ADR-0104: `timeline-bpm.ts`, deliberately unable to reach a
pixels-per-second value). ADR-0104 closed by naming the open cost it left behind:
"a surface that eventually needs both zoom and tempo (the bars/beats ruler) has to
hold two objects instead of one, and keeping them consistent is that caller's job."
This is that caller, and there were two ways to discharge the job. Emitting the two
readouts as sibling positioned elements would mean two `left` values that a future
refactor could compute from different times or different scales — a drift that only
a test would catch, and only if someone wrote it. Emitting them as children of a
single positioned element makes the agreement structural: there is one `left`, so
there is nothing to keep in sync. Separately, label density needed a rule. The only
scale that ships today is `'default'` (8 px/s), where the reference mock's 10-second
0:00/0:10/0:20 cadence is legible, so a hardcoded 10s interval would have passed
review — but at the `'zoomed-out'` clamp bound (2 px/s, ADR-0100) 10-second labels
sit 20px apart and overlap into noise, and the zoom UI (#1254) is already scheduled.

## Decision

`app/renderer/src/timeline-ruler-labels.ts` composes a `TimelineScale` and a
`TimelineTempo` into `TimelineRulerLabel[]`. It is the only module that holds both,
and it holds them one-directionally: `scale.timeToX` is the sole source of every
label's `xPx`, and `tempo.bpm` reaches text alone through `barsBeatsAt` — no
coordinate, transport value, clip duration or waveform bucket may ever be computed
through BPM, exactly as ADR-0104 requires.

`dawShellHTML` emits one `<span class="daw-ruler-label" style="left:…">` per label,
carrying `.daw-ruler-label-bars` and `.daw-ruler-label-time` as children. The two
readouts share that one element's `left`, so their agreement about the underlying
position is a structural property, not an asserted one. Any future ruler readout
(a third format, a marker name, a loop-brace label) joins that element as another
child rather than becoming a sibling with its own offset, and `.daw-ruler-label`
joins the single shared re-base selector in `app.css` as that rule's comment
already mandates (ADR-0090) instead of carrying a numeric offset.

Label density is derived, never hardcoded: `rulerLabelIntervalSecs(pxPerSecond)`
picks the first interval from the ladder `[5, 10, 30, 60, 120, 300]` seconds that
is at least `RULER_LABEL_MIN_SPACING_PX` (64) wide at that scale, falling back to
the sparsest choice for a non-finite or non-positive scale. At the shipped
`'default'` scale this resolves to 10 seconds, reproducing the mock exactly; at the
zoom bounds it resolves to 5 and 60 seconds respectively.

Bars/beats are 4/4, 1-based, formatted `bar.beat`, and the beat count is floored
through an explicit epsilon so float error in `timeSecs * bpm / 60` cannot label a
tick one beat early. The elapsed label is a local `M:SS` formatter rather than the
`window.dawPlayheadState.formatElapsed` global seam, kept honest by a drift test
against that implementation — the same trade ADR-0011 made for `isAbortError`.

## Consequences

Positive: the "both readouts point at the same position" acceptance criterion is
satisfied by DOM structure, so it cannot regress under a refactor that forgets a
test. The label layer needs no knowledge of tick positions and no second geometry
constant — it reads the same shared scale the ticks read, so the ruler cannot
disagree with the gridlines, the playhead or a clip edge. The readout is already
correct at the zoom states #1254 will expose, so that slice ships zoom UI without
reopening ruler labelling. The tempo model stays display-only by module structure
rather than by review.

Negative: the interval ladder and the 64px minimum spacing are judgement calls with
no measurement behind them — a much wider or narrower label font would want
different numbers, and changing them is a code change. Bars/beats assume 4/4 with
no time-signature model; a future 3/4 or 6/8 arrangement needs a real signature
value, not a constant. Because the tempo is constructed fresh inside `dawShellHTML`
via `createTimelineTempo()`, every ruler renders at 120 BPM until the toolbar BPM
control lands and threads a real value through — the labels are correct but not yet
user-controllable. And the local `M:SS` formatter is a second copy of a five-line
function, defended by a drift test rather than by there being only one of it.

## References

- [#1275 — Display bars/beats and elapsed time readouts on the Session ruler](https://github.com/on-par/sound-buddy/issues/1275)
- [#1260 — feat: Add BPM-backed beats/time ruler display without quantization](https://github.com/on-par/sound-buddy/issues/1260)
- [ADR-0104 — Timeline BPM is a separate display-only tempo model](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0104-timeline-bpm-is-a-separate-display-only-tempo-model-the-timeline-scale-and-every-coordinate-stay-in-real-seconds.md)
- [ADR-0100 — The timeline scale model is a pure state-plus-bounds object](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0100-the-timeline-scale-model-is-a-pure-state-plus-bounds-object-zoomed-in-and-zoomed-out-are-the-clamp-bounds.md)
