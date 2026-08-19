# Scene -inf levels parse to -Infinity, and scene numeric equality is a NaN-safe helper

- Status: Accepted
- Date: 2026-08-19

## Context

The Midas M32R writes a fader or DCA level parked at negative infinity as the
token `-oo`. packages/scene-inspector's parser matched numeric values with
`([\d+\-.]+)`, which captures only the leading `-` of that token, so
parseFloat produced NaN. diffScenes compared numbers with `!==`, and because
NaN !== NaN, every -oo channel was reported as a change even when a scene was
diffed against itself: the committed real-console capture
(packages/console/src/capture-2026-08-16.scn) has 7 of 32 channels at -oo, so
diffScenes(x, x) opened with 7 fabricated changes (#887).

Two representations were available for -inf. `null` is the honest "no value"
marker and survives JSON, but it forces `fader: number | null` and
`level: number | null` into @sound-buddy/shared's Channel/DCA and ripples a
nullable through the CLI diff renderer, the app's scene-diff formatter, the
report card, and all of their tests — a large blast radius for a bug fix.
Number.NEGATIVE_INFINITY needs no shared type change and keeps the value
ordered correctly against real fader positions (a -oo fader genuinely is the
lowest), but it is not representable in JSON: JSON.stringify(-Infinity)
yields null, and naive formatters print the string "-Infinity".

Separately, the NaN-safe comparison could have been Object.is. But
Object.is(-0, 0) is false, so a fader written `-0.0` in one scene and `+0` in
the other would become a new phantom change — one class of false positive
traded for another.

## Decision

Scene numeric fields stay `number`. parseScene reads the console's `-oo` as
Number.NEGATIVE_INFINITY, and parseFloat2 floors any other unreadable token
to 0, so a parsed Scene never carries NaN. diffScenes compares every numeric
field through a private `sameNumber(a, b)` — `a === b || (Number.isNaN(a) &&
Number.isNaN(b))` — which is NaN-safe and treats -0 and 0 as equal; raw `!==`
on a numeric scene field is not to be reintroduced. Every formatter that
renders a scene value to a user must render Number.NEGATIVE_INFINITY as `-∞`;
app/electron/scene-diff-format.ts and packages/cli/src/diff.ts do so, and any
future renderer of Scene numbers must be non-finite-safe rather than assuming
toFixed/String produces something readable.

## Consequences

Positive: no shared type change, so the fix stays inside scene-inspector plus
two formatters; -inf sorts and compares correctly as a number; a self-diff of
the real capture is provably empty; NaN can no longer originate in the parser
at all, so a future unreadable token degrades to 0 rather than fabricating a
change.

Negative: -Infinity does not survive a JSON boundary — `buddy diff --json`
serializes a -oo fader as null, and any future JSON persistence of a Scene
would lose the distinction between -inf and "absent". (This is not a
regression: JSON.stringify(NaN) was also null.) Flooring unreadable tokens to
0 is lossy and silent. Moving to `number | null` later means touching
@sound-buddy/shared and every consumer — the cost this decision defers.

## References

- [Issue #887 — bug: diffScenes reports phantom changes on -oo faders](https://github.com/on-par/sound-buddy/issues/887)
