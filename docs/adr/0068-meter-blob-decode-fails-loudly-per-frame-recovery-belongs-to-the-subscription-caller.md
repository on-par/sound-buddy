# Meter blob decode fails loudly; per-frame recovery belongs to the subscription caller

- Status: Accepted
- Date: 2026-08-19

## Context

Every raw-value conversion in packages/console/src/scaling.ts is total: it
never throws, never clamps, and degrades to a plausible number rather than
interrupting a read (ADR-0066 records that reasoning for the boolean
predicate, ADR-0067 for the level taper's unguarded fall-through). Meter
decoding looks like a sibling of those conversions and sits in the same
package, so the natural assumption is that it follows the same
never-throw rule.

It must not. A scaling conversion is handed a value the console already
confirmed; a meter decoder is handed a wire structure whose only realistic
failure mode — reading the little-endian count and floats as big-endian —
produces a full array of perfectly-typed denormal garbage with no signal
at all. That is the failure the #848 discovery session called the single
easiest thing to get wrong in a meter implementation, and #882's third
acceptance criterion requires an error rather than garbage.

The counter-pressure is that meters are a 20 Hz push subscription, not a
request/response. A decoder that throws is only safe if the frame loop
that consumes it treats a bad frame as a dropped frame. ADR-0063 further
ties liveness detection to onMeterFrame() being called for every real
decoded /meters push: if a malformed frame were counted as delivered, the
silent-four-client-cap detection would report a healthy subscription that
is producing nothing usable.

## Decision

decodeMeterBlob, decodeMeters1Blob and decodeMeters1Message throw OscError
on any structural inconsistency — a blob shorter than the 4-byte count
field, a negative count, a count that does not satisfy
byteLength === 4 + count * 4, a /meters/1 frame that does not carry
exactly 96 values, a non-/meters/1 reply address, or a first argument that
is not a blob. The error message names the little-endian expectation and
the observed byte length so the reader can tell an endianness mistake from
a truncated datagram. These decoders never return a partial, padded or
best-effort snapshot.

Callers on the push path own recovery. The R3b subscription loop wraps
each decode in try/catch, logs and drops the offending frame, keeps the
subscription and its renewal timer running, and does NOT call
onMeterFrame() for a frame that failed to decode — a malformed frame is
not a delivered frame for ADR-0063's liveness signal.

## Consequences

Positive: an endianness or framing mistake surfaces as a named, actionable
error at the first frame instead of as plausible-looking meter values that
would quietly poison every downstream dB conversion, report card and UI
meter. The invariant is exact (equality, not a lower bound), so no
truncated frame can be read as a shorter valid one.

Negative: the console package now has two error conventions — total,
never-throwing value conversions in scaling.ts and throwing structural
decoders in meters.ts — which a future contributor must learn rather than
infer. Every consumer of the meter decoders carries the burden of a
per-frame try/catch; a caller that forgets one turns a single corrupt
datagram into an unhandled rejection that could tear down the whole
subscription.

## References

- [Issue #882 — feat: Meter blob decode (little-endian /meters)](https://github.com/on-par/sound-buddy/issues/882)
- [ADR-0063 — silent four-client-cap refusal is detected via absence of /meters frames](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0063-silent-four-client-cap-refusal-is-detected-via-absence-of-meters-frames-not-absence-of-xremote-pushes.md)
- [ADR-0066 — one threshold predicate in scaling.ts owns every boolean console parameter](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0066-one-threshold-predicate-in-scaling-ts-owns-every-boolean-console-parameter-phantom-power-included.md)
