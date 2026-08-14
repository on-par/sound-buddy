# Header live-level readout rides the single rAF meter controller and reads the Room source

- Status: Accepted
- Date: 2026-08-14

## Context

#767's field feedback asks for a live, prominent SPL/dB readout pinned
top-right while an input device is actively monitoring, derived from the
same active input stream used for measurement. ADR-0005 already mandates
the renderer's animation-rate pattern: per-tick values bypass the store's
React subscribers and React state, and are written straight to the DOM by
an rAF-coalesced controller with injected deps (createLiveMeterController,
used today by the live board). The new header readout is a second consumer
of that exact pattern, but the controller's deps contract only exposed the
last board tick — it could not see capture state (isCapturing, the
measurement source, or the secondary measurement device's channel-0 feed
per ADR-0003), so a header consumer couldn't know when to show itself or
which channel to read. Two pressures shaped the decision: the readout must
be honest about being relative dBFS (no reference mic exists yet, so true
calibrated SPL is explicitly out of scope), and it must measure the same
"room" the app already treats as the measurement input (the
measurement-source strip, or the secondary device when active) so it never
disagrees with the stats row or the live report-card source.

## Decision

One createLiveMeterController instance (in LiveWorkspace.tsx) drives both
the live board repaint and the header readout. Its deps widen from a
last-tick payload to a LiveMeterSnapshot (lastTick, isCapturing,
measurementSource, lastMeasurementChannels, secondaryActive) and it
patches once per animation frame on any liveCaptureStore notification —
not only on ticks — because the readout's visibility must flip on capture
start/stop even with no tick in flight. The pure, unit-tested
liveLevelReadout(snapshot) derives the readout from the Room source —
secondary measurement channel 0 when active, else
measurementChannel(lastTick.channels, measurementSource) — and formats it
with report-card.ts's fmt()/levelColor(), so the header number and level
color reuse (never re-derive) the report card's dBFS conventions. The
#live-level-readout element is static in root-markup.html at the right end
of #header-right, hidden by default, with persistent "relative/dBFS" copy
and a title stating true SPL requires a calibrated reference mic. The
board repaint stays gated on isCapturing && lastTick, mirroring
renderWorkspace's own liveRunning && lastTick guard.

## Consequences

Positive: no second rAF loop or React churn for the new surface; the
readout follows the exact Room precedence the stats row and live
report-card source already use (secondary measurement owns the room when
active); the honesty copy prevents over-claiming SPL accuracy. Negative:
the shared controller now coalesces every liveCaptureStore notification
into one patch per frame (board patchTick is guarded so non-tick
notifications cannot repaint the board with stale data); future
animation-rate live DOM surfaces should ride this one controller rather
than spawning their own rAF loops, and any new live tick source (a future
waveform transport, per ADR-0004/0010) must be added to LiveMeterSnapshot
so readout-style consumers stay correct.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/767)
- [ADR-0005 — Discrete spectrum state in the store, animation-rate playback updates straight to the DOM](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
- [ADR-0003 — Secondary audio device measurement (secondary owns the room when active)](docs/adr/0003-secondary-audio-device-measurement.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/766)
