# The Session timeline's visible range is a seconds range with a single-slot zoom-back memory; it does not resolve to pixels until scroll exists

- Status: Accepted
- Date: 2026-08-30

## Context

#1284 adds fit-full / zoom-in / zoom-out / zoom-to-selection / zoom-back controls to the
Session toolbar. The arrangement already has a shared horizontal scale (timeline-scale.ts,
ADR-0101) whose zoom states are a four-value enum ('fit' | 'default' | 'zoomed-in' |
'zoomed-out') resolving to a clamped pixels-per-second, and #1282's overview strip already
derives a read-only visible range from that one pixels-per-second value in
percent-of-duration space (ADR-0108). Three forces met here. First, the four-state enum
cannot express repeated zoom steps, an arbitrary selection span, or "the range that was
showing a moment ago" - the issue asks for all three. Second, the timeline column has no
horizontal scroll offset: every surface still measures x from the one shared t=0 origin
(ADR-0086/0090), so a visible range whose start is not 0 has no way to be rendered
correctly, and #1283 (parked) is the issue that owns wiring scroll and gestures to the
shared visible-range model. Third, the Session tab has no time-selection surface at all,
so a zoom-to-selection control with a strict selection requirement would ship permanently
disabled and untestable by hand.

## Decision

The Session timeline's visible range is modelled as a TimelineVisibleRange of two real
seconds ({ startSecs, endSecs }) in app/renderer/src/timeline-zoom-controls.ts, and every
navigation intent is a pure reducer over it: applyTimelineZoom(model, action, ctx). The
range model computes no x and imports nothing from daw-shell-runtime.ts - it is the input a
future scale resolution reads, not a second coordinate system, so ADR-0101's rule that only
the shared scale converts between time and pixels is preserved. #1284 ships the model, the
handlers and the toolbar controls only; resolving a range into pixels-per-second plus a
scroll offset, and repainting the ruler, lanes, clips and playhead at that range, belongs
to #1283 and must consume this model rather than introduce another.
Two behaviours are fixed here. Zoom-back is a single-slot memory written by exactly one
action: zoom-to-selection records the range it replaced, every other action clears the
slot, and zoom-back restores that one range and clears it again. It is not an undo stack,
and no future action may start writing to the slot without changing this ADR. And
zoom-to-selection degrades in two documented steps instead of being gated off: it uses the
caller-supplied selection span when there is one, otherwise the loaded take's span, and
otherwise a fixed TIMELINE_ZOOM_INSERT_SPAN_SECS window centred on the playhead - the
insert-marker behaviour Ableton has when no time range is selected.
Fit-full's "entire loaded/recording duration" is timelineOverviewDurationSecs (#1282), not
a second duration rule, so the fit control and the overview strip can never disagree about
how long the session is.

## Consequences

Positive: the five intent handlers are pure, total and unit-testable with no DOM, no store
and no React, which is what the issue's verification asks for. #1283 inherits a model that
is already specified and covered instead of inventing one under gesture pressure. The
overview strip and the fit control share one duration rule by construction. Zoom-to-selection
is a live, hand-verifiable control on day one rather than a disabled placeholder.
Negative and accepted: for the duration of this slice the controls change the toolbar's
range readout and the controls' own enabled states but do not move the ruler, lanes, clips
or playhead - the visible feedback is deliberately partial until #1283 lands, and the PR
says so. Carrying a range in seconds alongside a pixels-per-second scale means two
representations of "zoom" coexist until #1283 makes the scale a function of the range; the
guard against drift is that the range model is forbidden from computing an x, so nothing
can render from it by accident. A single-slot zoom-back also means a second
zoom-to-selection overwrites the first one's memory, which is the intended shallow
behaviour, not a bug to be fixed by adding a stack.

## References

- [Issue #1284 - Add compact fit-full, zoom-in, zoom-out, and zoom-to-selection controls](https://github.com/on-par/sound-buddy/issues/1284)
- [Issue #1283 - Wire horizontal scroll and zoom gestures to the shared visible-range model](https://github.com/on-par/sound-buddy/issues/1283)
- [Issue #1255 - feat: Add DAW-style overview, scrub zone, and fit/zoom controls](https://github.com/on-par/sound-buddy/issues/1255)
