# The live-capture workspace board renders from discrete store state; per-tick values patch straight to the DOM via the existing meter controller (ADR-0005 extension)

- Status: Accepted
- Date: 2026-08-15

## Context

Slice 6c (#701) established that liveCaptureStore is the single source of
truth for the live surface and that per-tick meter values bypass React via
createLiveMeterController. What stayed imperative was the board's own
rendering: renderLiveWorkspace/renderLiveMeters/renderDawShell/
syncLiveAdjustmentsPanel and the EQ pane (renderEqPane/patchEqPaneSection)
rebuilt #live-island / #live-eq-pane-body from inline-app.js, bridged to
React through window.liveWorkspaceRuntime, and the patch-vs-rebuild decision
was made by querying the current DOM. Slice 6g must move that rendering into
the React LiveCapturePanel island, which forces a decision about how a
React-rendered board keeps receiving ~20/s meter ticks without re-rendering
React and without clobbering the imperatively-patched values. The prior
architecture's DOM-count query is replaced by React re-rendering on discrete
shape changes; the animation-rate path stays on the meter controller.

## Decision

LiveCapturePanel subscribes to discrete shape fields only (channelConfig,
channelGroups, devices, selectedDevice, isCapturing, liveMode, appMode,
selectedChannel, measurementSource, boardShapeVersion, settings flags) and
rebuilds the board markup via dangerouslySetInnerHTML from pure view
builders, reading lastTick/lastLiveChannels imperatively at render time
(never via subscription). The meter controller's patch callback is repointed
from window.liveWorkspaceRuntime.patchTick to pure DOM appliers
(patchLiveChannel, patchGroupSummaries, patchEqPaneSection, patchStatsRow)
that patch the React-rendered DOM in place. The EQ pane becomes its own
LiveEqPane island rebuilding only when eqPaneSignature changes; the stats row
is a pure view + applier driven by the controller (live) and ReportCardToolbar
(file). focusedInputIndex and lapCoaching move into liveCaptureStore so the
React adjustments panel renders from store state. The DAW shell markup moves
to React; the waveform/playhead canvas painting (slice 6j) stays inline and
is reachable via a new window.dawShellRuntime bridge invoked after the shell
renders.

## Consequences

Positive: the whole workspace surface becomes React/store-driven, inline-app.js
shrinks by roughly 500 lines toward the #424 deletion, the render logic
becomes unit-testable pure functions, and the board shape changes stay
synchronous with store mutations (useSyncExternalStore) instead of relying on
an imperative store-subscription renderWorkspace call. Negative: React
re-renders rebuild the board from the imperatively-read lastTick snapshot, so
a shape change during an active capture can momentarily rebuild from the
latest known tick rather than the very next frame's values (the controller
patches them in on the following frame); the deferred DAW waveform/playhead
seam means LiveCapturePanel invokes a still-inline 6j bridge until slice 6j
lands; the biggest remaining behavior risk is a per-tick patch regression only
visible under a real stream.py tick (e2e-gated).

## References

- [ADR-0005 — discrete spectrum state in the store, animation-rate playback updates straight to the DOM](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/701)
- [Issue](https://github.com/on-par/sound-buddy/issues/710)
