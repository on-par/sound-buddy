# The Live stop ceremony is single-flight and fail-open; every Stop affordance joins it rather than issuing its own stop

- Status: Accepted
- Date: 2026-09-06

## Context

The Live transport is rendered by two independent affordances over one
state machine: the top-bar RecordButton.tsx (#record-button) and the
Session workspace toolbar's #daw-session-record, built from the same pure
record-transport.ts view/action helpers. In the Live/Session workspace the
header copy is hidden by `body.live-active #record-button-island` in
app.css, so the toolbar button is usually the only reachable Stop.

Neither affordance can disable itself until React commits the
liveCaptureStore `stopping` flag, so two presses inside one frame both
reached LiveControls.tsx's runStopCeremony. That ran the full ceremony
twice: two stop-live IPCs, two onCaptureStopped hooks (duplicate session
offers and a duplicate reportCardChrome.persistSummary), and two
resume-to-monitoring tails — where the second startLiveCapture hits
startCapture()'s already-capturing no-op, returns undefined, and drives
capture-lifecycle's onCaptureStarted failure branch into stopLive(),
killing the monitor session that had just resumed.

runStopCeremony also had no error path. setStopping(false) was the last
statement, not a finally, so a rejected stop-live IPC or a throwing bridge
hook left `stopping` true forever. live-transition-state.js's capturePhase
returns 'stopping' first, recordButtonView('stopping') is disabled and
recordButtonAction('stopping') is null — so both Stop affordances went
permanently dead while stream.py kept capturing and holding the device.
liveCaptureStore.stopCapture() compounded this by flipping isCapturing
false before awaiting the IPC and never restoring it, so the renderer
claimed an idle board over a live child.

Sound Buddy is a paid product recording a service that cannot be re-taken;
an unstoppable recording is a worse failure than a stop that reports it
could not complete.

## Decision

LiveControls.tsx's runStopCeremony is the single, single-flight stop
ceremony for Live capture. It holds a module-level in-flight promise:
a call made while a ceremony is running returns that same promise instead
of starting a second one, and the promise is cleared in a finally the
instant the ceremony settles. stopLiveCapture likewise returns early
(awaiting the in-flight promise) when a ceremony is already running, so
the record-stop demote and the resume-to-monitoring tail also run exactly
once per stop.

The ceremony fails open, never closed. setStopping(false) runs in a
finally, so no IPC rejection or bridge-hook throw can wedge the transport
in the disabled 'stopping' phase. liveCaptureStore.stopCapture() restores
isCapturing to its pre-stop value and writes an actionable lastError when
stopLive rejects or returns success:false, and returns
{ success: false, sessionDir: null }; runStopCeremony then skips the
post-stop bridge hooks and stopLiveCapture skips the resume start, so no
start-live is ever issued on top of a still-live stream.py child.

Every future Live stop affordance, automation hook, or keyboard shortcut
routes through runStopCeremony (via stopLiveCapture or
stopCaptureIfRunning). None may call liveCaptureStore.stopCapture()
directly, add its own `stopping` flag handling, or introduce a competing
debounce.

## Consequences

Positive: Stop is idempotent by construction across both affordances and
the bridged automation entry point, with no per-handler debouncing to keep
in sync. A failed stop is visible (lastError) and retryable (the transport
returns to a pressable Stop) instead of silently wedging. The duplicate
report-card persist and the resume-then-kill interleaving are impossible.

Negative: the in-flight promise is module-level mutable state in
LiveControls.tsx, which unit tests must let settle rather than abandon
mid-flight. A stop issued while an earlier stop is genuinely still in
flight is joined rather than re-issued, so a truly hung main-process stop
is bounded only by the main process's own SIGTERM/SIGKILL grace
(DEFAULT_STOP_GRACE_MS in app/electron/ipc/python-stream.ts), not by a
renderer-side timer. Callers of stopCapture must now branch on
result.success rather than assuming a stop always succeeded.

## References

- [Issue #1383 — Invoke the stop ceremony reliably when Stop is clicked during an active recording](https://github.com/on-par/sound-buddy/issues/1383)
- [Issue #1381 — bug(live): Stop button does not stop an active recording](https://github.com/on-par/sound-buddy/issues/1381)
