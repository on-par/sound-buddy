# A Live record stop holds the board's running shape via a `demoting` flag; board-liveness is derived, never read from isCapturing

- Status: Accepted
- Date: 2026-08-20

## Context

ADR-0015 made the top-bar Record button's stop a demote: stop the record
session, then immediately restart a monitor session, "keeping isCapturing
true so the meters and header readout stay live". The implementation did
not achieve that. liveCaptureStore.stopCapture() sets isCapturing:false
and only then awaits the stopLive() IPC, which tears down the Python
child process — tens to hundreds of milliseconds. React commits and
paints that intermediate state, so for the whole stop round-trip the Live
surface rendered its idle shape: the #live-island innerHTML was swapped
for the `sb-live-meters idle` placeholder card, every liveRunning-gated
control un-disabled (Add track, New group, Arm all / Disarm all, the
per-strip remove and drag handles, the group headers' Rename / Delete),
the header stats row hid, and the level readout hid. Everything then
snapped back when the monitor session restarted. That is #847's reported
flicker.

Widening isCapturing itself to mean "capture is live OR about to be live
again" was rejected: that flag feeds the Record button's transport phase,
preflight, the rig lock and bridge.ts, and a stop genuinely is a stop.
Deriving the hold implicitly from the existing transients
(`stopping && liveMode === 'record'`) was rejected as an undocumented
coupling that would also silently change stopCaptureIfRunning, the one
production entry point for driving the board fully idle.

## Decision

liveCaptureStore carries a third transient flag, `demoting`, alongside
`promoting` and `stopping`. stopLiveCapture() sets it true before the
stop ceremony whenever the press is a record stop, and clears it in a
finally once the resumed monitor start has resolved — so it spans exactly
the window in which isCapturing is false but the tab is still, by
ADR-0015's contract, monitoring.

Every "should the Live surface render as live" decision is derived
through the single pure predicate boardRunning({isCapturing, demoting})
in live-workspace-view.ts. liveWorkspaceViewState() fills
LiveWorkspaceViewState.isCapturing from it, which is why the board card,
the toolbar and per-strip/group disabled stamps and the docked EQ pane
are all covered by one change: #710 already made that builder the single
view-state source for LiveCapturePanel, LiveWorkspace and LiveEqPane. The
two surfaces that read the store directly rather than through the builder
— LiveCapturePanel's #stats-row effect and LiveWorkspace's
createLiveMeterController snapshot — call boardRunning explicitly.

Future Live-surface code must not branch on liveCaptureStore.isCapturing
to decide whether to render live chrome; it calls boardRunning (or reads
LiveWorkspaceViewState.isCapturing, which already is boardRunning).
Reading isCapturing directly stays correct only for transport state
(RecordButton's phase), capture orchestration and IPC payloads.

## Consequences

Positive: the record-stop transition is flicker-free without touching the
transport, the capture ceremony or any IPC payload; ADR-0015's stated
contract is finally true in the code; there is one named, unit-testable
place that answers "is the board live", so the next Live surface cannot
reintroduce the flash by copying an isCapturing check.

Negative: a third transient flag in liveCaptureStore that must be cleared
on every exit path from stopLiveCapture (a leaked `true` would freeze the
board in its running shape with stale meters — hence the finally and the
failed-restart test); and a second concept, "board running" vs "capturing",
that readers must keep distinct.

## References

- [Issue #847 — Live tab main pane flickers on record stop](https://github.com/on-par/sound-buddy/issues/847)
- [ADR-0015 — Stopping a Live recording returns the always-monitoring tab to monitoring (#776)](docs/adr/0015-stopping-a-live-recording-returns-the-always-monitoring-tab-to-monitoring-the-top-bar-stop-is-a-demote-not-a-full-stop-776.md)
- [ADR-0014 — Live capture is always-monitoring and mode-less](docs/adr/0014-live-capture-is-always-monitoring-and-mode-less-transport-lives-only-in-the-persistent-top-bar.md)
