# Stopping a Live recording returns the always-monitoring tab to monitoring; the top-bar stop is a demote, not a full stop (#776)

- Status: Accepted
- Date: 2026-08-14

## Context

ADR-0014 (#757) made the Live tab permanently monitor-mode with the
top-bar Record button as the sole transport: an idle press starts
monitoring first (liveMode normalized to 'monitor') then promotes in
place, and there is no in-tab Stop. But 0.8.13 shipped the stop path
unchanged from the pre-#757 model — RecordButton's 'stop' action ran
stopLiveCapture → stopCapture + onCaptureStopped, which fully ended the
capture. The result: a record stop left the board idle at -120 dB and,
combined with auto-start honoring a record-mode rig's hydrated liveMode
(no normalize-before-start like recordCapture does), the app could open
already recording with no visible path back to the always-on baseline.
The always-monitoring model implies recording is a layer promoted on top
of a monitor baseline, so stopping a record must demote back to that
baseline rather than tear the transport down.

## Decision

The top-bar Record button's stop action (stopLiveCapture) stops the
record session and then immediately starts a monitor session with the
same device/channels/cadence (liveMode normalized to 'monitor' first),
keeping isCapturing true so the meters and header readout stay live and
the button reads idle 'Record'. The post-record session offers (Session
saved / report card) are preserved across the restart via a one-way
resume flag bridged to the runtime and consumed by onCaptureStarting.
Auto-start (maybeAutoStartLive) normalizes liveMode to 'monitor' before
starting so it can never begin a record session. There is still no UI
control to fully stop monitoring — capture ends only on quit or an
internal failure path — and recordCapture is unchanged.

## Consequences

Positive: the Live tab behaves like a DAW — strips always metering, a
Record⇄Stop button that cycles back to Record, never a dead board or a
missing transport; config stays capture-locked while monitoring, arming
stays live. Negative: a record stop is a stop+restart of the Python
child (short restart latency before the first monitor tick), and
reaching a fully-stopped capture from tests/automation now requires
driving the ceremony directly (the rigs.spec.ts stopCaptureIfRunning
pattern), since no button produces it.

## References

- [ADR-0014 — Live capture is always-monitoring and mode-less](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0014-live-capture-is-always-monitoring-and-mode-less-transport-lives-only-in-the-persistent-top-bar.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/776)
- [Issue](https://github.com/on-par/sound-buddy/issues/728)
- [Issue](https://github.com/on-par/sound-buddy/issues/757)
