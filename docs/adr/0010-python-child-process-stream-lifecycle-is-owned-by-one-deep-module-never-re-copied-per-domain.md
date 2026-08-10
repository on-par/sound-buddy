# Python child-process stream lifecycle is owned by one deep module, never re-copied per domain

- Status: Accepted
- Date: 2026-08-10

## Context

Sound Buddy spawns short-lived Python child processes (stream.py for live
capture and secondary measurement, playback.py for virtual soundcheck) that all
share the same shape: spawn with the same stdio/env conventions, forward
NDJSON stdout lines to a renderer event channel, log stderr, and stop with
SIGTERM followed by a SIGKILL after a grace period. That shape was implemented
three separate times as the three features shipped independently
(live-capture.ts, measurement-source.ts, playback.ts), and the copies silently
diverged on a real invariant — whether a child's `close` handler checks that it
is still the currently-owned process before clearing the module-level handle.
Only one of the three copies had the check, so a rapid restart on the other two
could orphan a process holding the microphone. A fourth caller (the waveform-
peak transport planned under epic #732) was already anticipated, which would
have made a fourth hand-rolled copy.

## Decision

app/electron/ipc/python-stream.ts's createPythonStreamSlot(deps) is the one
place that owns spawn/NDJSON-forward/stderr-log/SIGTERM-then-SIGKILL-stop for a
Python child process, with every side effect (spawn, log, logWarn, logError)
injected so it is unit-testable without Electron. live-capture.ts,
measurement-source.ts, and playback.ts each hold a module-level slot instance
and translate their own domain policy (argv, entitlement gate, session-dir
bookkeeping, event channel name, unexpected-exit UI) into the slot's start()
options. Any future Python stream transport (including #732's waveform-peak
transport) must adopt this slot rather than hand-rolling spawn/stop logic
again; the slot's identity-guarded close handling is what makes the
replace-on-restart race impossible by construction, and re-copying the pattern
would silently reopen it.

## Consequences

Positive: the orphaned-process race is fixed once, for all three (and any
future) callers, and the SIGKILL grace period and expected/unexpected-exit
semantics have one exported source of truth instead of three drifting copies.
Negative: any change to the shared lifecycle contract (e.g. a different grace
period, or a new exit-classification need) now requires touching a module
shared by three live features and re-running all three IPC test files, rather
than editing one file in isolation — the tradeoff this issue explicitly accepts
in exchange for closing the drift.

## References

- [Issue #744](https://github.com)
- [Issue #744](https://github.com/on-par/sound-buddy/issues/744)
