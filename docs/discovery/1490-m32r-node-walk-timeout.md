# Discovery: why `/config/auxlink` timed out while `/config/chlink` and `xinfo` succeeded (#1490)

## What happened

On a live M32R (firmware 4.09, `10.1.2.247:10023`), **Capture scene** aborted at `/config/auxlink`
with only 1 of 2103 paths captured. The Console panel was open and showing correct model/firmware/IP
at the time — basic reachability was never in question. `/config/chlink` (path 1) succeeded;
`/config/auxlink` (path 2) then exhausted 3×350ms retries with no reply.

## Leading theory: the console's silent four-client cap, not packet loss

ADR-0063 and ADR-0079 already document that this console model caps concurrent OSC clients at four
and **refuses a fifth with no error response** — indistinguishable, from the walk's point of view,
from a `/node` reply that never arrives. With the Console panel open during the capture, three
background connections are already cycling against the desk:

| Source | Interval | File |
| --- | --- | --- |
| `/status` heartbeat | 5000ms | `console-connection.ts` (`DEFAULT_HEARTBEAT_INTERVAL_MS`) |
| Channel-state poll (itself a `/node` walk) | 1000ms | `console-channel-state.ts` (`DEFAULT_CHANNEL_POLL_INTERVAL_MS`) |
| `/meters` subscription renewal | 5000ms | `console-subscription.ts` (`DEFAULT_SUBSCRIPTION_RENEWAL_INTERVAL_MS`) |

`queryConsole` (`console-connection.ts`) opens a **fresh UDP socket per query** — every one of those
three background cycles, plus every one of the capture walk's 2103 queries, registers a new ephemeral
source port with the desk. A capture running as a 4th logical client, racing against a 1-second-cadence
background poll that is itself bursting queries, only needs to land one query at the wrong instant to
be treated as the 5th client and silently refused. That collision being more likely in the first few
queries of a long walk (before the racing poll's own queries drain) than at query 2000 is a prediction
of this theory, not an assumption.

## Evidence that rules out the other two candidates from the issue

1. **Transient UDP loss, unrelated to client count.** Measured RTT on this desk is p95 7.9ms / max
   93.3ms (from the #848 discovery baseline that also produced 0/2103 misses in 22.9s with no
   Console panel open). A 350ms timeout is already 3.7x the worst observed single-packet latency, so
   plain network jitter does not explain a hard miss after 3 full retries. This doesn't rule out
   *some* contribution from a marginal Wi-Fi/switch hop, but it's not sufficient on its own to explain
   a failure this early and this reproducible.
2. **Rate-limiting after the first successful call.** If the desk were rate-limiting by cumulative
   query volume, failure should cluster later in the walk (after some budget is exhausted), not at
   query 2 of 2103 — and the #848 baseline (same desk, same query rate, Console panel closed) ran the
   full 2103-query walk with zero misses. Query count alone does not predict this failure; a
   *concurrent client count* does.

## What #1490 ships regardless of which theory is confirmed

The fix (`scene-capture-retry.ts` + the defer-and-sweep walk in `console-scene-capture.ts`, see
ADR-0142) does not depend on resolving the theory below to a certainty — it makes a single missed
`/node` reply recoverable instead of fatal, which is correct whether the cause is client-cap
contention, marginal network loss, or something else entirely. The experiments below exist to close
the loop on *root cause*, per AC1, not to gate the fix.

## Falsifying experiments (scoped, not pending sign-off — ADR-0127)

- **Experiment 1 — close the Console panel before capturing.** Run Capture scene against the same
  desk with the Console panel closed (no heartbeat/channel-poll/meters background traffic) versus
  open, five runs each. If "panel closed" is consistently 5/5 clean at 2103/2103 and "panel open"
  reproduces at least one miss, that's strong support for the four-client-cap theory over generic
  packet loss. Owner: whoever next has booth access to this desk (Patrick, on the next service
  weekend). Time: ~10 minutes (10 capture runs at ~23s each plus panel toggling). Command: use the
  Console panel's existing "Capture scene" action once wired to UI (tracked separately, C1b); until
  then, drive `captureSceneFromConsole` directly from a `buddy` CLI smoke script against the real IP.
  Does not block this PR — the retry fix ships regardless of the outcome.
- **Experiment 2 — packet capture during a reproduction.** Run `tcpdump -i en0 udp port 10023` (or
  Wireshark) alongside a Capture scene run against the same desk, Console panel open. If the desk
  never sends any UDP datagram back for the missed `/node` request (silent refusal), that confirms
  refusal over loss; if it does reply but late/out of order, that points at real network jitter
  instead. Owner: whoever has booth network access next. Time: ~15 minutes (setup + one reproduction
  run). Command: `sudo tcpdump -i en0 -n 'udp port 10023' -w capture-1490.pcap` started before the
  capture run. Does not block this PR.
- **Experiment 3 — single-path contention probe.** Script a tight loop of `/config/auxlink` queries
  (a few hundred, no other paths) against the same desk with the Console panel open, and log which
  attempts miss. If misses cluster near the channel-state poll's 1-second tick boundaries rather than
  being uniformly distributed, that's further support for slot contention specifically from the
  channel-state poll (the only background cycle that is itself a `/node` walk) over generic loss.
  Owner: whoever has booth access and ~20 minutes; can reuse `queryConsole` directly via a throwaway
  Node script, no app changes needed. Does not block this PR.

None of these experiments are required before #1490 merges — AC1 asks for "root cause, or a
well-documented reproducible theory," and the four-client-cap theory above is documented, falsifiable,
and consistent with every piece of evidence gathered so far (including the two ADRs that already
independently discovered this desk's cap behavior via a different feature).
