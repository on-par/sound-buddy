# Live tab auto-start is gated on the persisted active rig, not a new device preference

- Status: Accepted
- Date: 2026-08-10

## Context

#728 asks the Live tab to auto-start monitoring using "the last-used
device + rig + measurement source (persisted preferences)" with no
manual click, mirroring GarageBand/Ableton's "open the project, it's
already running" workflow — while leaving the secondary measurement
device (#460/#730) strictly opt-in, never auto-starting just because
it was enabled last session.

This codebase has exactly one place a primary device + channel config
+ measurement source is persisted across launches: a saved
CaptureRig, referenced by AppSettings.activeRigId and applied at boot
by rigStore's loadRigs()/applyRigById. There is no independent
"last selected device name" setting outside of rigs (unlike the
secondary measurement device, which does have its own
measurementDeviceName preference). Saved rigs are also a Pro-gated
feature (electron/ipc/settings.ts's isEntitled('saved-rigs')), and
live monitoring itself is Pro-gated too
(electron/ipc/live-capture.ts's isEntitled('live-monitoring')) — so
the population of users for whom "auto-start using what I used last"
is meaningful already overlaps heavily with rig users.

Two designs were on the table: (1) gate auto-start on
rigStore.activeRigId being non-null, reusing this existing
persistence, or (2) add a new persisted primary-device-name setting
(mirroring measurementDeviceName) so auto-start also works for
engineers who pick a device by hand every session without ever saving
a rig. Option 2 is more general but widens AppSettings, needs main-
process sanitization, and duplicates a concept ("what device did I use
last") the app already models via rigs.

## Decision

Live-tab auto-start (decideLiveAutoStart, app/renderer/src/live-auto-start.ts)
gates exclusively on: no capture already running, the device list
carrying no blocking hint (liveCaptureStore.deviceHint.isError), and
rigStore.activeRigId being non-null. "Last-used device + rig +
measurement source" means the currently active saved rig — there is
no separate persisted primary-device preference, and none is to be
added as a way to make auto-start fire without an active rig. The
secondary measurement device's own opt-in start path
(SecondaryMeasurementPanel.tsx / liveCaptureStore.startSecondaryMeasurement)
is never called from this decision or its wiring in
mode-switch.ts's switchMode() — auto-start applies to the board
monitor stream only.

## Consequences

Positive: zero new persisted settings, zero new IPC surface, and the
decision function stays a 3-input pure gate that's trivial to reason
about and test. Auto-start correctness rides entirely on
infrastructure (rig persistence, Pro entitlement checks,
deviceHint) that already exists and is already tested.

Negative: a Pro user who monitors live without ever saving a rig gets
no auto-start — they must still click Start Capture at least once per
session, same as today. If that gap turns out to matter, the fix is a
new persisted device-name preference (mirroring measurementDeviceName)
feeding a second input into decideLiveAutoStart — a compatible,
additive change, not a rework of this decision. Any future code that
wants monitoring to auto-start on a different basis (e.g. "most
recently connected device" with no rig) must extend
decideLiveAutoStart's inputs deliberately rather than adding a second,
separate auto-start trigger elsewhere.

## References

- [Issue #728](https://github.com/on-par/sound-buddy/issues/728)
- [ADR-0003 — secondary measurement device stays opt-in](docs/adr/0005-secondary-device-measurement-ships-flag-gated-with-an-unconditional-time-alignment-warning.md)
