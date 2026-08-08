# Secondary-device measurement ships flag-gated with an unconditional time-alignment warning

- Status: Accepted
- Date: 2026-07-30

## Context

ADR 0003 (spike #459) recommended Aggregate Device guidance as the
near-term path and deferred native secondary-device support until
real-rig drift numbers exist — numbers the spike could not produce
because the build machine has zero audio input devices. Issue #460 was
nevertheless scheduled with those findings in hand, and its acceptance
criteria explicitly allow shipping behind an advanced/feature flag when
the spike warrants it. The spike also named the mandatory safeguards for
any implementation: honest surfacing of unquantified drift, disconnect
as a distinct non-fatal state that never disturbs board capture, event
namespacing between the two streams, and no silent source substitution.

## Decision

Sound Buddy implements #460 as a measurement-only second stream.py
monitor process behind a new default-off `secondaryMeasurementEnabled`
setting (no env layer — enabling an experiment is an explicit user
action, same rationale as dawWorkspaceEnabled). Because relative drift
between two independent clock domains is unquantified until the
real-rig runs in ADR 0003 happen, the UI shows the "may not be
time-aligned with the multitrack session" warning unconditionally
whenever the secondary source is selected, and recommends the macOS
Aggregate Device as the clock-corrected alternative. Missing microphone
permission and device disconnection are surfaced as blocked/disconnected
states; the app never falls back to another source silently. The device
preference persists by device name and auto-resumes on reconnect.
Secondary events travel on their own `measurement-event` IPC channel,
fully separate from `live-event`.

## Consequences

Regular users keep exactly the deferred behavior ADR 0003 called for,
while the real rig can gather drift data using the actual product path;
the flag can later default on (and the warning become drift-driven via
DRIFT_WARN_PPM) once real numbers land. Cost: a second Python process
per active measurement source, a permanent warning that may read as
alarming even for stable USB mics, and no sample-accurate alignment —
the secondary stream is a metering source only and must never feed
multitrack stems.

## References

- [ADR 0003: Secondary audio-device measurement on macOS — spike findings](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0003-secondary-audio-device-measurement.md)
- [Issue #460](https://github.com/on-par/sound-buddy/issues/460)
