# Secondary measurement device is first-class and always visible; the flag is retired, not migrated

- Status: Accepted
- Date: 2026-08-10

## Context

ADR-0005 (Accepted, 2026-07-30) shipped the secondary measurement device (#460) behind a
default-off secondaryMeasurementEnabled Settings checkbox, reasoning that "enabling an
experiment is an explicit user action" while real-rig clock-drift data was still
unquantified. That ADR's own Consequences section anticipated the flag might later
"default on... once real numbers land," but issue #730 goes further: rather than flipping
a default, it removes the opt-in flag entirely and makes the device picker itself the only
on/off control, matching every other picker in Settings → Audio. The picker's underlying
behavior (device-name persistence, disconnect/reconnect states, the separate
measurement-event IPC channel, and the unconditional time-alignment warning) was already
flag-independent — only the render-visibility gate and the Settings checkbox depended on
secondaryMeasurementEnabled. Separately, this repo has one existing precedent for retiring
a settings flag outright: the legacy aiEnabled key (#659), which was deleted from
AppSettings/DEFAULTS/getSettings()/writeSettingsFile() without any migration function —
getSettings() simply stops including the key, and writeSettingsFile's spread-then-override
pattern lets a stale on-disk key round-trip harmlessly forever.

## Decision

secondaryMeasurementEnabled is deleted outright from AppSettings, UpdateSettingsPatch,
DEFAULTS, getSettings(), writeSettingsFile(), the update-settings IPC whitelist, and
StorageToggles/TOGGLE_KEYS — following the aiEnabled (#659) precedent exactly, with no new
migration function or settings-version mechanism introduced. The secondary measurement
device picker in Settings → Audio (SecondaryMeasurementPanel.tsx) renders unconditionally
whenever the Settings dialog is booted, defaulting to "None" (inactive) until a device is
explicitly selected — the same convention as every other device picker in the app. All
"(experimental)" UI copy tied to this feature is removed. The permanent time-alignment
warning (ADR-0005) is unchanged and continues to render unconditionally whenever a device
is actually selected, superseding only ADR-0005's flag-gating premise, not its warning or
safety-state decisions.

## Consequences

Users get the secondary measurement device as a first-class, always-discoverable capability
with one fewer step to reach it, consistent with how every other input picker in the app
behaves. Existing installs with a persisted secondaryMeasurementEnabled: true/false in
settings.json are unaffected in practice — the stale key is silently ignored on read and
round-trips untouched on write, exactly like the retired aiEnabled key, so no migration
code or version bump is needed. The cost is that this repo now has two flags retired by the
same "just stop reading it" convention (aiEnabled, secondaryMeasurementEnabled) with no
formal settings-versioning system; a third or fourth retirement should reconsider whether a
real migration mechanism is warranted before this convention gets stretched further. This
ADR supersedes ADR-0005's flag-gating decision but leaves that ADR's non-visibility
decisions (disconnect/reconnect handling, per-device-name persistence, unconditional
alignment warning, separate measurement-event channel) fully in force.

## References

- [Issue #730](https://github.com/on-par/sound-buddy/issues/730)
- [ADR-0005 — Secondary-device measurement ships flag-gated with an unconditional time-alignment warning](docs/adr/0005-secondary-device-measurement-ships-flag-gated-with-an-unconditional-time-alignment-warning.md)
