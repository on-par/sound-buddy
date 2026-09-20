# The line-check subject is the sole soloed channel; zero or many is silent

- Status: Accepted
- Date: 2026-09-20

## Context

During a line check, a console operator solos one channel at a time to listen to and adjust
that input in isolation. #1463 wired `lineCheckCalibrationEnabled` as plumbing-only dark flag;
#1464 (epic #1462, `lc-01`) is the first slice to read it, adding a "Currently checking:
{displayName}" indicator to the live workspace so the operator sees confirmation of which
channel Sound Buddy believes is under test.

`soloedChannels` (`ChannelFlagMap`, `Record<number, boolean>`) already carries every solo
toggle from the M32R OSC state — no new detection logic is needed or in scope. The open
question is what "currently checking" means when the board's solo state does not cleanly
name one channel: nothing soloed (the idle state between checks), or more than one channel
soloed (a mix engineer soloing several inputs to compare them, not to line-check one).

## Decision

The line-check subject is defined as the *sole* channel with `soloedChannels[idx] === true`.
Zero soloed channels and more than one soloed channel are both treated as "not a line-check
moment" and render no indicator — never a guess, never the first/last soloed index, never a
"most recently soloed" heuristic. `soleSoloedChannelIndex` (`line-check-indicator.ts`) is the
one function that decides this, and it returns `null` for both ambiguous cases alike; callers
never need to distinguish "none" from "many" because the rendering decision is identical.

This rule binds the rest of epic #1462: any later slice that hangs a capture trigger, a
per-strip calibration profile switch, or other console-state-dependent behavior off "which
channel is under test" must consult the same sole-soloed-channel signal (or a documented
successor that also refuses to guess under multi-solo or zero-solo). No later slice may
substitute a heuristic (e.g., "the last channel toggled") or introduce new OSC/console
plumbing to disambiguate — if the console's solo state is genuinely insufficient for some
future feature, that is a new ADR superseding this one, not a silent expansion of this rule.

The displayed name is resolved through the exact same `resolveStripLabel(strip, channel,
index)` triple `dawTrackRows` already uses for the track head (`live-workspace-view.ts`), so
the indicator cannot disagree with the head row about a channel's name — no second
label-formatting path is introduced.

## Consequences

Positive: the indicator is fully deterministic from state the renderer already has — no new
subscription, no new component, no OSC round-trip, and it can never show a wrong or guessed
channel name. Negative: an engineer who solos two channels to compare them (a legitimate,
common workflow outside a line check) sees no indicator at all rather than a "which one?"
prompt — this is intentional per the Decision above, but is a real UX tradeoff a later slice
could revisit only by superseding this ADR, not by quietly special-casing the two-solo case.

## References

- [Issue #1464](https://github.com/on-par/sound-buddy/issues/1464)
- [Issue #1463](https://github.com/on-par/sound-buddy/issues/1463) (`lineCheckCalibrationEnabled` dark flag)
- [Epic #1462](https://github.com/on-par/sound-buddy/issues/1462) (`line-check-calibration`)
