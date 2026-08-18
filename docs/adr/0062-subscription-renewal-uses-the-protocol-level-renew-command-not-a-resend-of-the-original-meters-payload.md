# Subscription renewal uses the protocol-level /renew command, not a resend of the original /meters payload

- Status: Accepted
- Date: 2026-08-18

## Context

#878 must keep /xremote and /meters registrations alive every ~5s
without lapsing at the console's ~10s silent expiry, but establishing
the initial /meters subscription (meterblock name + sample-rate/format
args) is explicitly out of scope (R3b, not yet implemented anywhere in
the codebase). The M32/X32 OSC protocol exposes a zero-argument
/renew command whose documented effect is to extend whatever
subscription(s) are currently registered on the sending socket,
without needing to resupply their original arguments. /renew (and
/xremote) are already on the #875 read-only guardrail's
ALLOWED_WITH_ARGS_ADDRESSES allowlist, unused until now — strongly
suggesting they were reserved for exactly this renewal role.

## Decision

startSubscriptionRenewal's periodic tick sends two zero-arg OSC
messages — /xremote (stateless; establishing and renewing it are the
same message, so this module owns its full lifecycle) and /renew
(which extends any active /meters subscription established elsewhere,
e.g. by future R3b work). This module never sends a /meters message
with meterblock/format arguments itself.

## Consequences

Positive: renewal logic is fully decoupled from subscription-
establishment logic — this issue lands without waiting on or
duplicating R3b, and future subscription-mechanics code never needs
to hand its args to the renewal path or keep them in sync with it.
Negative: renewal is now implicitly dependent on the console
correctly implementing /renew's "extend everything currently
registered" semantics for /meters exactly as documented; if a future
real-console verification run (see issue Verification note) shows
/renew does not extend an active /meters subscription in practice,
this ADR's decision must be revisited and startSubscriptionRenewal
changed to resend the full /meters payload instead (which would then
need those args threaded in as a new required parameter).

## References

- [Issue #878](https://github.com/on-par/sound-buddy/issues/878)
