# Discrete spectrum state in the store, animation-rate playback updates straight to the DOM

- Status: Accepted
- Date: 2026-08-04

## Context

The TD-001 renderer migration moves `app/renderer/src/inline-app.js`'s runtime
behavior into React components and Zustand stores slice by slice. Slice 6a (#695)
is the first slice whose surface mixes two very different update rates in one
panel: discrete, user-driven state (which spectrogram frame is pinned, whether the
panel shows empty/loading/error/curve/meters, which file is loaded) and a ~60 Hz
playback stream (playhead position, elapsed/total readout, per-frame band levels,
the highlighted heatmap column).

Two constraints make "put it all in the store" wrong. First, the band bars animate
via CSS height/value transitions; the existing `patchBarsAndLabels` applier exists
precisely because rebuilding `#spectrum-chart`'s innerHTML restarts those
transitions on every repaint. Re-rendering React 60 times a second would do exactly
that, which the issue's "no user-visible change" requirement forbids. Second, the
app's unit harness has no jsdom - renderer tests use `renderToString` only, and the
constitution says to use the existing harness rather than add a framework - so
whatever touches DOM cannot be unit-tested and has to be small, obviously correct,
`/* c8 ignore */`-ed with a named e2e gate, and fed by fully unit-tested pure
functions. That precedent already exists in `spectrum-display.ts`.

## Decision

Split the spectrum surface by update frequency.

Discrete state lives in `spectrumStore`: `panelState`/`panelText`, `stagesDone`,
`selectedFrame`, `filePath`, `fallbackDuration`. React renders from it, and pure
view functions (`spectrum-chrome.ts`, `spectrum-transport.ts`'s helpers,
`spectrum-display.ts`'s `spectrumChartModel`) derive everything shown, so the
logic is unit-tested with no DOM.

Animation-rate playback updates bypass both the store and React state. The
`spectrumTransport` singleton (`createSpectrumTransport`, all side effects
injected) drives a `requestAnimationFrame` loop whose listener writes directly to
`#spectro-playhead`, `#spectro-time`, `#scrub-readout`, `.hm-col.sel` and
`patchBarsAndLabels(#spectrum-chart)` through refs held by
`SpectrogramScrubber`. Only discrete transitions (play, pause, ended, metadata,
seek, a new file) notify React, and the pause/ended transition re-renders to
restore the resting chart, readout and selection.

Where a container is still owned by the not-yet-migrated imperative code (live
meters, soundcheck meters, the DAW shell in `#spectrum-imperative`), that handoff
is explicit: `panelState: 'meters'` means "inline-app.js owns this container right
now" and `SpectrumPanel` renders null, instead of the two implementations racing
on `style.display`.

## Consequences

Positive: CSS transitions keep animating and playback stays smooth; the audio
lifecycle, seek clamping and frame math become unit-testable for the first time
(they were entirely e2e-gated inside `inline-app.js`); the imperative DOM surface
shrinks to a handful of small, `/* c8 ignore */`-ed appliers with named e2e gates;
and the store stays free of high-churn values that would make every subscriber
re-render.

Negative: the panel is not "pure React" - a reader has to know that some DOM under
`#spectrum-heatmap` and `#spectrum-chart` is written imperatively, and that React
tolerates it only because `dangerouslySetInnerHTML` re-assigns innerHTML solely
when the `__html` string itself changes. Restoring the resting state on pause is an
explicit step rather than a free consequence of re-rendering. Slices 6b-6f (live
meters, soundcheck, DAW shell) inherit this rule and must apply the same split
rather than pushing meter ticks through the store.

## References

- [Issue #695 - Renderer migration 6a: Spectrum interaction and playback transport](https://github.com/on-par/sound-buddy/issues/695)
- [Epic #395 - TD-001 renderer migration](https://github.com/on-par/sound-buddy/issues/395)
- [#424 - final inline-app.js deletion and coverage-floor raise (parked)](https://github.com/on-par/sound-buddy/issues/424)
