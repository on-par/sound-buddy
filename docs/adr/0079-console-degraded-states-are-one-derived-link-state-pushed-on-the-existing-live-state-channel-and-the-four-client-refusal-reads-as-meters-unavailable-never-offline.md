# Console degraded states are one derived link state pushed on the existing live-state channel, and the four-client refusal reads as "meters unavailable", never "offline"

- Status: Accepted
- Date: 2026-08-20

## Context

#886 (R5 of #848) had to surface four different failure modes of a UDP console link: no console on
the network, mid-session disappearance, a silently lapsed /meters subscription, and the console's
undocumented four-concurrent-client cap refusing our /xremote+/meters registration with no error.
By the time this slice started, every detection primitive already existed and was tested —
discoverConsoles' repeated broadcast (#876), startConsoleHeartbeat's /status poll (#877), and
startSubscriptionRenewal's reconnect / degraded-to-polling events (#878, ADR-0063) — but none had a
consumer: console.ts logged the liveness events with the note "degraded/offline UI is R5's scope".
Two shapes were available. Either each failure mode gets its own IPC channel and its own UI
treatment, or all of them fold into one small derived state. The second question was how to present
the four-client refusal: the console still answers /status and /node normally while refusing the
subscription, so calling it "offline" would be factually wrong and would hide that channel state is
still live.

## Decision

One pure reducer, reduceConsoleLink in app/electron/ipc/console-link.ts, owns the whole degraded-state
derivation. It folds three inputs — heartbeat results, ConsoleSubscriptionEvents, and meter-frame
arrivals — into ConsoleLinkState ({ status: 'unknown' | 'online' | 'offline'; metersDegraded: boolean })
and returns the identical object reference when nothing changed, so the main process pushes a link
update only on a real edge. The link rides the existing console-live-state channel as a fourth member
of the ConsoleLiveStateEvent union; no new IPC channel, no new preload bridge entry, and the #884
read-only gate's "exactly four ipcMain.handle channels" assertion stands unchanged.
Subscription liveness (metersDegraded) and console reachability (status) stay separate fields and are
never collapsed: a silently refused or lapsed subscription reads as "meters unavailable — still polling
channel state", and only an unanswered /status heartbeat reads as "console offline". Every degraded
state is recovered by the already-running timers — the heartbeat keeps polling, startSubscriptionRenewal
keeps re-sending /xremote + /renew on the same socket, and the channel poll keeps ticking — so no
degraded path may create a new socket, a new retry loop, or an unbounded backoff.

## Consequences

Positive: one unit-testable pure function covers every degraded transition with no sockets and no
Electron; the renderer gains one field instead of four; the read-only IPC surface does not grow; and
"recovery" is a property of timers that already exist rather than new reconnect code that could storm
the console. Edge-triggered pushes keep a 5 Hz meter stream from generating 5 link messages a second.
Negative: 'unknown' is observable in the UI for up to one heartbeat round trip (<=1.4s) after a watch
starts, and the two fields can disagree transiently (offline console whose last subscription event has
not landed yet) — the message function resolves that by prioritising offline. Future console failure
modes must extend ConsoleLinkInput/ConsoleLinkState rather than adding a channel, and any future
Tier 2 module that needs its own liveness signal must feed this reducer instead of pushing its own.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/886)
- [Epic](https://github.com/on-par/sound-buddy/issues/848)
- [ADR-0063 — silent four-client-cap refusal is detected via absence of /meters frames](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0063-silent-four-client-cap-refusal-is-detected-via-absence-of-meters-frames-not-absence-of-xremote-pushes.md)
