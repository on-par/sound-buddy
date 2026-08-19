# The level taper ships upper-segments-only as an unguarded fall-through, not with a placeholder floor

- Status: Accepted
- Date: 2026-08-19

## Context

The M32R's fader/send taper is piecewise-linear with slope breaks at
f = 0.5, 0.25 and 0.0625. Epic #880's decomposition split the conversion
across three stories deliberately: #962 delivers the three upper segments
(the normal working range an engineer actually reads off the console),
and the segment below 0.0625 plus the "-oo" / -Infinity floor are
explicitly out of scope for it. That leaves an unavoidable question with
no in-scope answer: what should a total TypeScript function return for
f < 0.0625 while the story that owns that range has not shipped?
Three constraints bear on it. ADR-0066 established that every conversion
in packages/console/src/scaling.ts is pure and total and never throws,
because these run on a read-only poll path that must degrade to a
plausible value rather than fail mid-poll. The repo constitution requires
100% meaningful statement coverage and forbids tests that assert
behavior nobody decided on — so any branch added here needs a decided,
tested meaning. And the package's vitest thresholds (100% statements,
95% branches) are a hard gate, so a speculative fourth branch would have
to be tested against semantics this story is forbidden from choosing.

## Decision

oscToLevelDb implements exactly two guarded branches — f >= 0.5 and
f >= 0.25 — and returns the third segment's formula (f * 160 - 70) as an
unguarded trailing expression. That trailing return IS the
f >= 0.0625 segment; below 0.0625 it linearly extrapolates the bottom
in-scope segment rather than returning a placeholder, throwing, or
clamping. No -Infinity floor, no NaN sentinel, and no fourth branch is
added in this story.
The follow-on story that owns the sub-0.0625 range converts that trailing
return into a `f >= 0.0625` guarded branch and adds the bottom segment and
the -Infinity floor beneath it. It must not alter the three upper
formulas or their measured fixtures — those are pinned by measured console
readings and are the acceptance criteria of #962.

## Consequences

Positive: the function stays total and never throws, consistent with all
ten sibling conversions and with ADR-0066; every branch that exists has a
decided meaning and a test, so the package's 100%/95% coverage gate is met
without speculative assertions; the follow-on story's surface is a pure
addition beneath an untouched upper taper, so its diff cannot regress the
measured breakpoints.
Negative: between this story and its follow-on, a caller passing a
near-silent fader (f < 0.0625) gets a wrong number — a smooth linear
extrapolation running past -60 dB toward -70 dB — rather than an obviously
absent value, and a reader of the code sees a piecewise function whose
lowest named segment carries no lower guard, which reads as an oversight
unless they find this record. Accepted because the alternative is shipping
untested, unspecified floor semantics that pre-empt the story that owns
them, and because no production code path consumes oscToLevelDb yet.

## References

- [ADR-0066 — One threshold predicate in scaling.ts owns every boolean console parameter](docs/adr/0066-one-threshold-predicate-in-scaling-ts-owns-every-boolean-console-parameter-phantom-power-included.md)
- [Issue #962 — feat(console): piecewise dB conversion for upper fader/send segments](https://github.com/patrob/sound-buddy/issues/962)
- [Issue #962](https://github.com/on-par/sound-buddy/issues/962)
