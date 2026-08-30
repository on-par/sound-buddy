# Live lane waveform columns are one pixel wide at every zoom; the shared scale changes buckets-per-column, never column width

- Status: Accepted
- Date: 2026-08-30

## Context

Epic #1254 converts every time-positioned surface of the arrangement view to the
shared TimelineScale model in timeline-scale.ts. The live waveform lanes are the
last call site: createDawShellRuntime's paintLane passed the fixed
DAW_TIMELINE_PX_PER_SECOND constant into dawWaveformState.columnPeaks, so at any
scale other than 'default' the painted columns would keep the 8 px/s bucketing
and drift out of agreement with the ruler ticks and gridlines drawn above them.

Two constraints shape how the scale can reach that painter. First,
timeline-scale.ts imports DAW_TIMELINE_ORIGIN_PX and DAW_TIMELINE_PX_PER_SECOND
from daw-shell-runtime.ts, so daw-shell-runtime.ts can only import TimelineScale
type-only — it cannot construct a default scale for itself without closing an ESM
cycle. Second, the lane painter is animation-rate (ADR-0005): it runs inside a
requestAnimationFrame-coalesced repaint and must not read React state or the
store, and a scale captured once at construction could never follow a zoom
change without another signature revision.

There is also a geometry question the code alone does not answer:
drawDawWaveformLane strokes one 1px vertical line per column at x + 0.5, and the
lane canvas is sized to its own .daw-lane-body parent. Zooming could plausibly be
expressed either as wider columns or as fewer buckets per column, and the two
choices are not interchangeable — wider columns would break the 1:1 relationship
between a column and a device pixel that the painter and the canvas sizing both
assume.

## Decision

A live waveform column is DAW_WAVEFORM_COLUMN_WIDTH_PX — exactly one device pixel
— at every zoom state. The shared TimelineScale changes only how much arrangement
time a column covers: paintLane passes the resolved scale's pxPerSecond into
dawWaveformState.columnPeaks, and the column-to-time mapping is owned by the pure
exports dawWaveformColumnTimeSecs(columnIndex, scale) and
dawWaveformColumnX(columnIndex) in daw-shell-runtime.ts. No painter may
reintroduce a per-column pixel width derived from the scale.

createDawShellRuntime receives the scale through an optional
getTimelineScale(): TimelineScale accessor on DawShellRuntimeDeps, read once per
paintLane call so a future zoom state reaches the painter with no further
signature change. When the accessor is absent, the runtime falls back to
DAW_TIMELINE_PX_PER_SECOND — the same undefined-scale branch dawRulerTicks and
dawLaneGridlines already use, and the exact pre-change value. daw-shell-runtime.ts
keeps its type-only import of TimelineScale; the concrete scale is always
constructed by the caller (App.tsx passes createTimelineScale('default')).

## Consequences

Positive: the live lanes, the ruler, the gridlines, the playhead and the
loaded-take clips now derive every horizontal coordinate from one scale object, so
a zoom state cannot move one surface without moving the rest. The column geometry
is two pure functions with no DOM, so the fit/default/zoomed-in/zoomed-out
contract is unit-tested rather than eyeballed. The default scale resolves to the
same number the constant did, so this ships as a wiring change with no visual
delta.

Negative: the runtime carries an optional dependency with a fallback branch, which
is one more path to keep tested, and the fallback means a caller that simply
forgets to inject a scale silently renders at the fixed default rather than
failing loudly. Sub-pixel zoom (a column narrower than one device pixel) is
explicitly not expressible under this decision; a future high-DPI or continuous-
zoom story that needs it must revisit both the column width constant and
drawDawWaveformLane's stroke geometry together.

## References

- [Issue #1265 — Wire live waveform column downsampling to the shared timeline scale](https://github.com/on-par/sound-buddy/issues/1265)
- [Epic #1254 — shared arrangement timeline scale](https://github.com/on-par/sound-buddy/issues/1254)
