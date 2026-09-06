# Wall-clock capture time is quantized to whole seconds before it enters the React render path, and the post-rebuild lane repaint is a layout effect

- Status: Accepted
- Date: 2026-09-06

## Context

ADR-0005 established that animation-rate values bypass the store and React and are patched
straight to the DOM. The Live/Session board obeys that for the playhead and the meters, but
the board's markup is still built as one HTML string (dawShellHTML) and handed to React via
dangerouslySetInnerHTML, and two render-time reads of the raw wall-clock playhead leaked
back into that string: the seeded M:SS transport readout, and zoomContext.durationSecs (via
timelineOverviewDurationSecs). Because React rewrites the whole board's innerHTML whenever
that string differs, every such render destroyed and recreated every waveform canvas. Past
the 60s TIMELINE_OVERVIEW_MIN_DURATION_SECS floor the un-quantized duration also changed on
every render, so the nextDurationTrackedZoom effect set state on every render — an
unbounded render/rebuild loop with a sub-pixel-different paint scale each pass. The repaint
that followed a rebuild lived in a passive useEffect, which React flushes after the browser
has painted, so each rebuild put a blank canvas frame on screen: the #1376 flicker.

## Decision

Two rules govern the Session board's render path from now on.
1. Any wall-clock capture value read at React render time passes through
   renderStableElapsedMs (app/renderer/src/recording-elapsed.ts), which floors it to whole
   seconds — the coarsest resolution anything in the markup actually displays. Render-time
   code reads the quantized value; imperative per-frame painters (patchOverview, the rAF
   playhead ticker, renderPlayhead) keep reading the raw clock and stay smooth.
2. Any repaint that must follow a rebuild of the board's innerHTML runs in a
   useLayoutEffect, never a useEffect, so the canvases are repainted in the same commit as
   the DOM swap and no blank frame can reach the screen.

## Consequences

Positive: a steady recording produces a byte-identical markup string within each second, so
React does no innerHTML work and the canvases are never destroyed; the >60s render loop is
closed; and every future cause of a rebuild is tear-free by construction rather than by
luck. Negative: a value seeded into the markup can be up to one second stale at the instant
of a rebuild (harmless — the imperative painters patch it in the same commit); the layout
effect makes the repaint synchronous with the commit, so heavy paint work there would now
block the frame; and rendering the panel through renderToString in unit tests emits React's
one-time "useLayoutEffect does nothing on the server" dev warning.

## References

- [Issue #1376 — bug(live): recording waveforms flicker during capture](https://github.com/on-par/sound-buddy/issues/1376)
- [ADR-0005 — Discrete spectrum state in the store, animation-rate playback updates straight to the DOM](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
