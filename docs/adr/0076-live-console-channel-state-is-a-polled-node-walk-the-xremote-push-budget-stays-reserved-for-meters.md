# Live console channel state is a polled /node walk; the /xremote push budget stays reserved for meters

- Status: Accepted
- Date: 2026-08-20

## Context

#977 is the first slice that reads live parameter state from a connected M32R. Two
transports were available. The M32R can push parameter changes to a subscribed client
via /xremote, and console-subscription.ts (#878) already owns renewal and liveness for
that mechanism. It can also answer /node queries with the console's own plain-text
parameter lines — the same text a .scn capture is made of, which parseChannelStrips
(#879) already parses and which carries faders in dB rather than as raw 0..1 OSC floats.
Three forces decided it. First, the console silently caps subscribed clients at four
(ADR-0063 / #878), and R3a/R3b's meter stream is the slice that genuinely needs a push
subscription — spending part of that budget on parameter state would make meters
contend with channel state on the same scarce resource. Second, /xremote delivers
individual raw parameter messages, so consuming it means a per-parameter reducer plus
the scaling.ts float→dB conversions, where /node hands back already-converted
engineering units through a parser that ships with tests. Third, the whole 2103-path
scene walk takes a measured 22.9s (#888), but the bounded 64-path channel subset
(/ch/NN/config + /ch/NN/mix for 32 channels) completes well inside a one-second poll
at the measured ~250 queries/sec, so polling is fast enough for a panel a human reads.

## Decision

Live console channel state is read by polling. app/electron/ipc/console-channel-state.ts
re-walks a bounded /ch/NN/config + /ch/NN/mix path table over /node on a fixed interval
and emits whole ConsoleChannelState[] snapshots; it opens no /xremote subscription and
holds no per-parameter incremental state. The console's /xremote + /meters subscription
budget is reserved for the meter stream that R3a/R3b will build on
console-meters.ts / console-subscription.ts. Any future console-parameter surface
(DCAs, buses, sends) extends this path table and the same walk rather than opening a
second subscription, unless a written decision in the same PR says otherwise. The walk
never overlaps itself: a tick that arrives while the previous walk is still in flight
is dropped, so a slow console degrades to a lower update rate instead of queueing
requests.

## Consequences

Positive: channel state reuses a tested parser and the console's own dB units, needs no
float conversion path, and cannot starve the meter subscription. A poll is stateless —
every snapshot is complete, so there is no drift between the panel and the board and
no resync problem after a dropped datagram. Negative: updates are quantized to the poll
interval rather than arriving on change, so a fader move is visible up to one interval
late, and the app sends steady query traffic to the console even when nothing is
changing. Widening the table (more channels, more parameters) raises walk time linearly
and will eventually force the interval up or the transport question back open — at which
point this ADR is the record of why push was not taken first.

## References

- [#977 — feat: Console panel — live channel state, end-to-end (R1a/R1b)](https://github.com/on-par/sound-buddy/issues/977)
- [ADR-0075 — The console IPC surface is read-only by construction](docs/adr/0075-the-console-ipc-surface-is-read-only-by-construction-two-read-channels-guarded-by-a-source-scan-gate.md)
