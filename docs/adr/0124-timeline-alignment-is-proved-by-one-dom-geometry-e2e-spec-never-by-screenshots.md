# Timeline alignment is proved by one DOM-geometry e2e spec, never by screenshots

- Status: Accepted
- Date: 2026-08-31

## Context

The Session arrangement resolves a timestamp to an x in five independent painted
surfaces: the ruler tick (dawRulerTicks), the lane gridline (dawLaneGridlines), the
cached take clip (sessionTabWaveformView's leftPx/widthPx), the scrub gesture
(soundcheckTimelinePreviewFromPointer), and the playhead (dawPlayheadX). ADR-0086
makes them share one origin and one px-per-second, and ADR-0090 re-bases all of them
into the timeline column with a single CSS translate — but those are unit-level and
CSS-level guarantees. Nothing measured the five painted surfaces against each other in
a running app, so a lane padding change, a clip geometry regression, or a scrub origin
that stopped subtracting DAW_TIMELINE_ORIGIN_PX could ship green. Epic #1258 will add
zoom, scroll, resize, playback, and loop coverage of the same invariant, so the shape
of the first slice sets the pattern the rest inherit. Screenshot comparison was the
obvious alternative and is rejected: it is non-deterministic across the headless boxes
CI runs on, and it reports "the picture changed" rather than "these two surfaces
disagree by N pixels".

## Decision

app/tests/e2e/timeline-alignment.spec.ts is the single home for the arrangement's
timeline alignment invariant. Every alignment assertion in it reads numeric DOM/canvas
geometry — Locator.boundingBox(), computed style values, and the pointer coordinates the
test itself dispatched — and compares them with an explicit named pixel tolerance
(ALIGNMENT_TOLERANCE_PX). No screenshot, visual diff, or toHaveScreenshot assertion may
be added to it. The spec stays IPC-stubbed (open-dir-dialog, generate-session-peaks,
list-output-devices, start-playback) so it needs no sox/ffprobe/python and no packaged
.app, and is therefore NOT listed in playwright.config.ts's MEDIA_SPECS. Sibling slices
of #1258 (zoom in/out, fit-full, scroll, resize, playback, follow-scroll, loop brace,
time selection) extend this file with additional test cases rather than starting a
parallel alignment spec, and each reuses the same tolerance constant. A failure of an
alignment assertion is a geometry defect to be fixed in the arrangement code; widening
ALIGNMENT_TOLERANCE_PX to make a case pass is not an accepted resolution.

## Consequences

Positive: drift between the ruler, lanes, clips, scrub, and playhead becomes a hard CI
failure with an actionable message (two numbers and their delta) instead of an
unreviewable image diff. The spec runs on any box, including CI's SB_E2E_STUBBED_ONLY
lane, because it needs no media tools. Future zoom/scroll slices get a ready-made
fixture and a settled assertion style, so they are small additions rather than new
designs. Negative: the spec depends on stubbed peaks whose bucket count encodes the
take's duration, so a change to ADR-0004's peaks document shape or to
sessionTabWaveformView's strip-matching rules requires updating the fixture; and it
depends on the default channelConfig seeding two mono strips (a=0, a=1) so manifest
track 0 claims exactly one strip. Both are named in comments in the spec so the
coupling is visible at the point of failure.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1325)
- [Issue](https://github.com/on-par/sound-buddy/issues/1258)
