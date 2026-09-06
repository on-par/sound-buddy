# The record→monitor demote window renders as the monitoring phase, never idle and never recording

- Status: Accepted
- Date: 2026-09-06

## Context

ADR-0014 and ADR-0015 make the Live tab always-monitoring: the top-bar Stop is a demote, and a
completed record stop must land on monitor-only, not on a fully idle board. #847 already
established that the board's *shape* must hold across that window via
`boardRunning(isCapturing || demoting)`, because stopCapture() flips isCapturing false before
awaiting the stop-live IPC and React paints the whole span.

The transport controls were left out of that fix. live-transition-state.js's capturePhase —
the single pure model behind the top-bar RecordButton, the Session toolbar's
#daw-session-record, the header REC/LIVE pill and the #live-status line — reads only
liveRunning/liveMode/promoting/stopping. During the demote, `stopping` has cleared,
isCapturing is false and liveMode is still 'record', so the phase collapses to 'idle': the
transport claims a stopped, non-monitoring board while the board next to it renders live, and
off the Live tab the RecordButton unmounts and remounts. The obvious symmetry fix — feed
boardRunning() in as liveRunning — is actively wrong here: with liveMode still 'record' it
yields 'recording', painting the stale Recording/Stop control that #1384 exists to remove.
The demote window is therefore not expressible as a combination of the existing inputs; it
needs its own branch.

## Decision

capturePhase takes an optional `demoting` flag and, when it is set and `stopping` is not,
returns 'monitoring' before consulting liveRunning, promoting, or liveMode. Ordering is fixed
and load-bearing: stopping (the IPC in flight) outranks demoting (its destination), and
demoting outranks liveMode's stale 'record' value. Every transport surface derives its state
from this one function and passes the store's `demoting` — no component may re-derive capture
eligibility from raw store flags, and no component may substitute boardRunning() for
`liveRunning`. boardRunning stays what it is: the answer to "should the Live *surface* render
as live", not an input to the phase model.

## Consequences

Positive: the transport can no longer show a fully idle board or a stale Recording/Stop
control after a stop completes; the top-bar button stays mounted across a demote taken from
another tab; the top bar, the Session toolbar and the status line cannot disagree, because
one pure, unit-tested function decides for all of them.
Negative: for the duration of the demote (one stop-live IPC plus one start-live IPC) the UI
says "Monitoring" slightly before the resumed monitor child is actually streaming, and the
meters are momentarily still — the deliberate trade for never flashing an idle transport.
Every future capture-phase consumer must remember to pass `demoting`; the flag is optional so
that omitting it is a silent revert to the old behavior rather than a compile error, which is
why the demote-window cases are pinned by tests in live-transition-state.test.ts,
RecordButton.test.ts and LiveCapturePanel.test.ts.

## References

- [Issue #1384 — Return Recording UI to Record or monitor-only state after a successful Stop](https://github.com/on-par/sound-buddy/issues/1384)
- [ADR-0015 — Stopping a Live recording returns the always-monitoring tab to monitoring (#776)](docs/adr/0015-stopping-a-live-recording-returns-the-always-monitoring-tab-to-monitoring-the-top-bar-stop-is-a-demote-not-a-full-stop-776.md)
