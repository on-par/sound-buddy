# Silent four-client-cap refusal is detected via absence of /meters frames, not absence of /xremote pushes

- Status: Accepted
- Date: 2026-08-18

## Context

The issue's third acceptance criterion requires detecting that our
/xremote was "silently refused" (the console caps concurrent clients
at four and gives no explicit refusal) by "the absence of expected
pushes." /xremote itself only pushes on parameter change — it has no
fixed cadence, so there is no way to define a timeout for "an /xremote
push should have arrived by now" without false-positiving constantly
on an idle-but-healthy console. /meters, once subscribed, pushes at a
fixed, predictable rate.

## Decision

startSubscriptionRenewal's grace-timer/degraded-to-polling detection
is driven entirely by the caller's onMeterFrame() calls (i.e. by
/meters push arrival), and is used as the proxy signal for whether our
client is registered with the console at all — including for
/xremote's refusal, since a silently-refused client fails to register
for both subscriptions together on the same socket. Any future caller
of this module (the R3a meter-decode consumer) MUST call
onMeterFrame() for every real decoded /meters push, or the
degraded-to-polling signal can never fire correctly.

## Consequences

Positive: liveness detection has one concrete, testable signal instead
of an untestable heuristic over irregular parameter-change events.
Negative: if a future rig scenario subscribes to /xremote without ever
subscribing to /meters, this module's silent-refusal detection cannot
fire (there will never be a frame to wait for) — callers in that
scenario must not rely on startSubscriptionRenewal's
degraded-to-polling event and need their own detection path.

## References

- [Issue #878](https://github.com/on-par/sound-buddy/issues/878)
