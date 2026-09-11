# Routing edits while monitoring restart the live stream at the store level; capture config is locked only by an active recording

- Status: Accepted
- Date: 2026-09-11

## Context

ADR-0014/ADR-0080 made the Session (Live) tab always-monitoring, and ADR-0078 routed every
"render as live" decision through boardRunning(). The selected-channel inspector's Mode /
Source / Arm controls and the toolbar's Add track were stamped `disabled` off that same
predicate, so with the tab permanently monitoring an engineer could never route a track
(e.g. a board-fed crowd mic) to its hardware input without driving the board fully idle —
which no button does. Enabling the controls is not enough: stream.py reads its channel
tokens once at spawn, so a routing edit must reach the running child. The obvious reuse —
LiveControls.stopLiveCapture()/startLiveCapture() and the capture-lifecycle bridge hooks —
is wrong for this: onCaptureStopped offers a session folder / report card and retitles the
panel "stopped", and onCaptureStarting clears session offers and lap coaching. Those hooks
mark a user-initiated session boundary; a Source change is not one.

## Decision

Two rules. (1) "Is the capture configuration locked" is a distinct predicate from "is the
board live": live-workspace-view.ts exports captureConfigLocked({isCapturing, liveMode,
demoting?}) = (isCapturing && liveMode === 'record') || demoting. Every control that edits
what the stream captures — the inspector's Name/Mode/Source/Arm, "+ Add track" — gates on
it, never on boardRunning()/isCapturing directly. Controls that edit board chrome rather
than the capture set (classification, remove, drag, groups) keep their existing lock until
an issue moves them. (2) liveCaptureStore.restartMonitorCapture() is the one path that
applies a channel-set change to a running monitor session: guarded by monitorRestartAllowed
(monitoring, not promoting/stopping/demoting), it awaits stopLive then startLive with the
current allTokens, keeps isCapturing true for the whole round-trip, coalesces overlapping
calls to at most one follow-up restart, and never invokes the LiveControls stop/start
ceremony or the capture-lifecycle hooks. Strip mutators that change tokens (setStripKind,
setStripSource, addStrip) call it after their set(); mutators that do not change tokens
(toggleArm, setStripLabel) do not.

## Consequences

Positive: tracks can be routed and added while monitoring, which is the only state the tab
is ever in; session offers, rig lock, labels, groups, arm state and measurementSource survive
a routing edit; the record path is untouched. Negative: a restart clears liveWindows and
lastLiveChannels, so the live report-card buffer restarts and meters show idle placeholders
for up to one meter interval plus the child's exit latency; the rig stays locked if the
restart's startLive fails (isCapturing goes false and lastError is set) until the next
capture start, a pre-existing class of failure-path inconsistency. Any future mutator that
changes the token set must call restartMonitorCapture or it silently desyncs config from
the stream.

## References

- [Issue #1403](https://github.com/on-par/sound-buddy/issues/1403)
- [ADR-0078 demoting flag / boardRunning](docs/adr/0078-a-live-record-stop-holds-the-board-s-running-shape-via-a-demoting-flag-board-liveness-is-derived-never-read-from-iscapturing.md)
- [ADR-0080 DAW tab always-monitoring](docs/adr/0080-the-daw-tab-merges-live-and-soundcheck-an-in-tab-transport-drives-the-timeline-supersedes-adr-0014.md)
