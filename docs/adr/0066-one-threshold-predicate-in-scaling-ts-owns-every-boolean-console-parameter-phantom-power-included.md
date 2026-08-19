# One threshold predicate in scaling.ts owns every boolean console parameter, phantom power included

- Status: Accepted
- Date: 2026-08-19

## Context

An M32R reports every numeric parameter over OSC as a value, not a typed
boolean, and the same on/off encoding covers structurally unrelated
things: channel on/mute (`/ch/NN/mix/on`), gate/dynamics/eq bypass, and
per-headamp phantom power (`/headamp/NNN/phantom`) — which is scoped to a
headamp, not a channel, and so has no shared parent type in the model.
Depending on how a value is read, it arrives either as an OSC int arg
(`{type:'i', value:1}`) or as a 32-bit float arg (`{type:'f', value:1.0}`),
and `packages/console/src/index.ts` decodes both tags. Unlike the 11
conversions the 2026-08-16 discovery session measured with
`verify_scaling.py`, on/off was never in that script's CHECKS list,
because it is not a scaling formula — so there is no fixture-derived
formula to defer to and the semantics have to be chosen deliberately.
This is story 1 of 12 under epic #880 and ships first specifically to
establish the module and test pattern the remaining 11 reuse, which means
whatever it decides about where conversions live and how strictly values
are compared is inherited by all of them. The repo constitution also
forbids floating-point comparisons without epsilon tolerance and forbids
unnamed magic numbers.

## Decision

`packages/console/src/scaling.ts` is the single owning module for
raw-OSC-value → engineering-value conversions in this package; every
sibling conversion under #880 is added there as a pure exported function
with a colocated fixture table in `scaling.test.ts` and is re-exported
from `src/index.ts`.

Boolean parameters convert through exactly one predicate,
`oscToOnState(value: number): boolean`, implemented as
`value >= ON_THRESHOLD` with `ON_THRESHOLD = 0.5` as a named module
constant. Phantom power reuses that function unchanged — there is no
`oscToPhantomPower`, no address argument, and no address-dependent branch
inside the conversion. Callers that need a boolean from a console value
call `oscToOnState`; they do not write their own truthiness check.

`channel-strip.ts` keeps its existing `token === 'ON'` comparisons: that
module parses a textual `.scn` capture, a different transport that never
carries a number, and it is deliberately not routed through this function.

## Consequences

Positive: one symbol to test, one place to fix if the console ever reports
a value other than 0/1; a float `1.0` that drifts in a float32 round-trip
still reads as on; int and float transports need no caller-side branch;
the constitution's float-comparison and named-constant rules are satisfied
by construction; the 11 sibling stories inherit a proven module shape
instead of each inventing one.

Negative: the conversion is total, so a malformed or out-of-range value
(negative, NaN, 7.3) is silently coerced to a boolean rather than
surfacing as an error — a genuinely corrupt read looks like a valid
`false`. Accepted because a read-only meter/state path should degrade to a
plausible value rather than throw mid-poll, and because the OSC decoder in
`index.ts` already rejects structurally invalid packets upstream. Also, a
future tri-state or enumerated console parameter cannot reuse this
predicate and must get its own function in the same module — it must not
be bolted on as a second return type here.

## References

- [Issue #939 — feat(console): on/mute + phantom power float-to-boolean conversion](https://github.com/on-par/sound-buddy/issues/939)
- [Epic #880 — verified unit conversions for console parameters (12-story tracker)](https://github.com/on-par/sound-buddy/issues/880)
- [Issue #875 — read-only console access constraint](https://github.com/on-par/sound-buddy/issues/875)
