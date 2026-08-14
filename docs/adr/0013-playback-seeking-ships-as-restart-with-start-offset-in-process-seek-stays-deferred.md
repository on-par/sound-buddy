# Playback seeking ships as restart-with-start-offset; in-process seek stays deferred

- Status: Accepted
- Date: 2026-08-14

## Context

Epic #732's story 1/4 must let a Soundcheck session begin playback partway through so a
later story can add real scrubbing. Two mechanisms were on the table: (a) restart the
playback.py child with a --start-at offset — reusing the existing stop/start IPC path,
where start-playback already SIGTERMs any in-flight child through the ADR-0010 playbackSlot,
so a new spawn with a new offset is a restart for free; or (b) an in-process seek command
over a stdin control channel that keeps the process alive and re-seeks the open stems
mid-stream. (a) is dramatically simpler — no control channel, no running state machine, no
new IPC command — and its only real risk is restart latency (interpreter + numpy/sounddevice
import + device open). The issue sets a ~300ms responsiveness bar and explicitly directs
measuring before committing to the harder approach.

## Decision

Ship approach (a). playback.py gains a --start-at SECONDS option; the producer seeks every
stem handle to the offset frame before reading, and progress elapsed is reported as the
session-relative position (offset + frames played, clamped to duration). StartPlaybackOpts
and PlaybackOptions gain an optional startOffsetSecs field and buildPlaybackArgs maps it to
--start-at only when it is positive, so play-from-start argv is unchanged. Restart latency is
measured and documented in the PR; if it exceeds ~300ms, the PR flags it and proposes
approach (b) as follow-up rather than silently shipping a laggy scrub. In-process seeking is
explicitly out of scope until that measurement says otherwise.

## Consequences

Positive: reuses the proven stop/start path and the ADR-0010 slot lifecycle with no new
transport, wiring, or state; fully testable with the existing fake-sounddevice harness;
the later scrub stories get their mechanism (call startPlayback again with a new offset)
without any IPC redesign. Negative: every seek costs a full child restart (device close +
reopen), so high-rate scrubbing will feel stepped rather than continuous, and elapsed is
only sampled between restarts; if the ~300ms bar is missed, approach (b) becomes required
work and --start-at remains the fallback path.

## References

- [ADR-0010 — Python child-process stream lifecycle](docs/adr/0010-python-child-process-stream-lifecycle-is-owned-by-one-deep-module-never-re-copied-per-domain.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/733)
