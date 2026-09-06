# The arrangement's single playhead resolves its instant through one pure precedence rule, and an advancing record clock outranks a playback position

- Status: Accepted
- Date: 2026-09-06

## Context

The Session arrangement paints exactly one playhead (ruler segment + lane
segment), but two independent clocks can want it: the wall-clock record head
owned by daw-playhead-state.js, and the playback position pushed in from
soundcheckStore's progress ticks. Before #1377 the precedence lived inline in
renderPlayhead as `playbackPosition ? playbackPosition.elapsed * 1000 : wall
clock` — playback unconditionally first. That was safe only as long as a
playback position existed solely while a take was actually playing, and it is
not: soundcheckStore.loadSession seeds lastElapsedTick to the truthy
`{ elapsed: 0, duration: 0 }` on load, and LiveCapturePanel forwards it to
setPlaybackPosition whenever a manifest is present. So merely having loaded a
session — including the take a user just recorded — pinned the playhead to a
frozen position while a subsequent recording's clock, waveform lanes, transport
readout and overview strip all advanced. app/tests/e2e/timeline-alignment.spec.ts
already documented this as a checkout precondition and had to drop its
session-load step to exercise the record head at all. The forces: the
arrangement must keep ONE instant per paint pass (ADR-0086's one-time/one-x
invariant, #1049's single-x write), the rule must be unit-testable without a DOM
(the Architecture standard), and it must not be re-derived by each future writer
of setPlaybackPosition.

## Decision

app/renderer/src/playhead-instant.ts's resolvePlayheadInstant() is the one place
the arrangement decides which clock the single playhead shows. Its precedence is
fixed: an advancing record session always wins; otherwise a non-null playback
position wins with `advancing` taken from the playback-active flag; otherwise the
frozen or zero wall clock wins and is not advancing. renderPlayhead calls it once
per paint and derives the transport text, the single dawPlayheadXAt x written to
every .daw-playhead segment, the `advancing` class and timelineMarks.setPlayheadSecs
from that one result. Any future surface that needs "the instant the arrangement is
showing" calls resolvePlayheadInstant rather than reimplementing the choice, and no
caller may reintroduce an inline `playbackPosition ? ... : wallClock` ternary.

## Consequences

Positive: a recording's playhead can never again be pinned by a stale take
position, no matter which module writes setPlaybackPosition; the precedence is a
pure function with full unit coverage instead of an inline ternary inside a DOM
painter; the painted x, the transport readout and the shared playhead mark are
provably the same instant; and the e2e recording-alignment case can finally load a
session, which is the real-world shape of the bug. Negative: recording now
outranks playback, so a user running a virtual-soundcheck stem while recording
sees the record head rather than the playback head — accepted because the lanes
painted underneath it during a recording are the recording's own waveform. The
right-edge clamp in dawPlayheadXAt is untouched, so a recording long enough to
park the head at the shell's right inset still diverges from the (unclamped)
ruler mapping; that is a separate, four-surface decision left to a follow-up.

## References

- [Issue #1377 — bug(live): recording playhead does not match timeline position](https://github.com/on-par/sound-buddy/issues/1377)
- [#1327 — timeline alignment during playback and live recording](https://github.com/on-par/sound-buddy/issues/1327)
