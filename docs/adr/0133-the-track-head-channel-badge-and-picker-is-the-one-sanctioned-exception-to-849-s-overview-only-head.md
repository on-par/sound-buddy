# The track-head channel badge and picker is the one sanctioned exception to #849's overview-only head

- Status: Accepted
- Date: 2026-09-11

## Context

#849 made `dawTrackHeaderHTML` overview-only: per-channel settings (name aside) live only
in the EQ pane inspector, and `daw-workspace-shell.test.ts` pins that with `expect(...).not
.toContain('<select')`. #1404 asks for the opposite on one control: an engineer must be able
to see and change a track's hardware channel (mono or stereo pair) from the track head
itself, without selecting the strip, opening the inspector, or leaving the arrangement. A
compact badge (`3`, `3/4`) that opens an inline Mono/Stereo + Source picker on the track is
the only place that request fits.

Reversing #849's rule silently — e.g. moving the picker's markup into an imported function so
the literal `<select` string never appears inside `dawTrackHeaderHTML`'s own function body —
would make the guard test pass without ever deciding whether the exception is intentional.
That is gaming the checker, not satisfying it.

## Decision

The head row keeps #849's rule with one named exception: `track-channel-picker.ts` owns the
badge and popover markup (`trackChannelPickerHTML`), `dawTrackHeaderHTML` calls it and emits
no `<select>` of its own, and `daw-workspace-shell.test.ts`'s guard test is narrowed to assert
exactly that shape — `dawTrackHeaderHTML`'s own body has no `<select>`, it does call
`trackChannelPickerHTML(`, and `track-channel-picker.ts` does contain `<select>` — rather than
being left unchanged and passing by accident. Every other per-channel control (label, arm,
classification, playback output) still lives only in the EQ pane inspector.

The badge/picker's lock state follows `captureConfigLocked` (ADR-0132), not the head row's
existing `configDisabled` (which is `isCapturing` unconditionally, #849's original "frozen
while the board is live at all" stamp used by drag/remove/group edits). Using `configDisabled`
would re-lock routing for the entire always-monitoring session (ADR-0080) — the exact problem
ADR-0132 fixed for the inspector. The badge/picker mutates the same `channelConfig` the
inspector does, so it must unlock on the same rule.

## Consequences

Positive: an engineer can re-route any track in seconds from the arrangement itself; #849's
rule stays binding and legible for every future head-row control, with one documented,
tested carve-out instead of a silent one. Negative: the head row now needs a small amount of
positioning care (the popover is `position: absolute` off `.daw-track-head-controls`) that
the rest of the row never needed; a future contributor extending the head row must read this
ADR before assuming "no selects" is still absolute.

## References

- [Issue #1404](https://github.com/on-par/sound-buddy/issues/1404)
- [ADR-0132 capture-config-locked routing](docs/adr/0132-routing-edits-while-monitoring-restart-the-live-stream-at-the-store-level-capture-config-is-locked-only-by-an-active-recording.md)
