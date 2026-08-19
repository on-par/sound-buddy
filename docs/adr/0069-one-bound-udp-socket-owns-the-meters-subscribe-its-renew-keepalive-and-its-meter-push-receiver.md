# One bound UDP socket owns the /meters subscribe, its /renew keepalive, and its meter-push receiver

- Status: Accepted
- Date: 2026-08-19

## Context

The M32R registers OSC subscriptions against the source address and port
of the socket that sent them: /meters pushes come back to that port, and
/renew (ADR-0062) extends whatever is registered on the sending socket
without resupplying arguments. The codebase already has two other socket
shapes that look usable for renewal — queryConsole (console-connection.ts)
and queryConsoleAtAddress (console-discovery.ts) both create a throwaway
socket per request and close it — and startSubscriptionRenewal takes its
socket as an injected dependency, so nothing in the type system stops a
future caller from renewing on a different socket than the one that
subscribed. If that happened the console would extend some other (or no)
registration, our subscription would lapse at ~10 s, and the failure
would be indistinguishable from a healthy-but-idle console: no error, no
refusal, just frames that stop. That is precisely the class of silent
failure ADR-0063 had to invent a frames-absent watchdog to detect.

## Decision

startMeterSubscription creates and binds exactly one UDP socket, sends
the /meters subscribe message on it, passes that same socket instance
into startSubscriptionRenewal's deps, receives every meter push on it,
and owns its close() in stop(). No subscription-bearing traffic is ever
renewed over a per-query throwaway socket. Any future consumer that needs
meter frames shares the handle startMeterSubscription returns rather than
opening a second subscription socket of its own.

## Consequences

Positive: the subscription, its keepalive, and its push stream provably
share one console-side registration, and there is exactly one place that
closes the socket. Renewal stays free of subscription arguments, as
ADR-0062 requires. Negative: this module owns I/O lifecycle rather than
being pure, so its tests must inject a fake socket (the deps-injected
pattern console-discovery.ts and python-stream.ts/ADR-0010 already
established). And because the M32R caps concurrent clients at four
(ADR-0063), a second concurrent meter subscription would burn another
client slot — callers must share one handle, not open their own.

## References

- Issue #883
- [ADR-0062 — Subscription renewal uses the protocol-level /renew command](0062-subscription-renewal-uses-the-protocol-level-renew-command-not-a-resend-of-the-original-meters-payload.md)
- [ADR-0063 — Silent four-client-cap refusal is detected via absence of /meters frames](0063-silent-four-client-cap-refusal-is-detected-via-absence-of-meters-frames-not-absence-of-xremote-pushes.md)
