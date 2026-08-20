# The console IPC surface is read-only by construction — two read channels, guarded by a source-scan gate

- Status: Accepted
- Date: 2026-08-20

## Context

#848's console work is the first feature in Sound Buddy that talks to a
customer's live mixing console. The trust story sold to the user in the
Tier 2 consent modal (#378, ADR-0006) is unconditional: "Read-only: Sound
Buddy never writes to or changes console settings." Three defences already
exist below the UI — packages/console's assertReadOnlyOscMessage refuses
to encode a write at the encoder, assertConsoleNetworkConsent gates every
socket, and the discovery module never sweeps a subnet. What did not exist
is a guarantee at the boundary the renderer can actually reach: once an
IPC channel is registered, any future renderer code can call it, and a
"just this once" write channel (recall a scene, set a fader, push a name)
is exactly the kind of thing a later slice adds under deadline pressure.
#884 is the moment that boundary gets defined, so it is the moment to
constrain it.

## Decision

The console IPC surface is read-only by construction. app/electron/ipc/
console.ts registers exactly two channels — scan-consoles and
fetch-console-identity — both of which only read. Every future console
channel (R4b live state, C1 scene capture, the stored-scene inventory)
must likewise be a read: no IPC handler in this domain may send an OSC
message that sets, recalls, stores, or otherwise mutates console state,
and no renderer surface in the console panel family may render a control
whose action would. app/renderer/src/console-read-only-gate.test.ts
enforces this by scanning the console IPC module and the console panel
sources for write verbs and failing on a match; a change that needs a
write path must delete that gate in the same PR, which makes it a visible,
reviewable decision instead of a silent one.

## Consequences

Positive: the consent modal's read-only promise is backed by a check that
runs on every CI build, not by reviewer memory. The audit acceptance
criterion of #884 ("no action can write to the console") has a durable,
executable answer. Adding a write becomes a deliberate act with a paper
trail. Negative: the gate is a source-text scan, so it is approximate — it
can be worked around by an author who wants to, and it will occasionally
need its verb list widened as vocabulary grows. Any legitimate future
write feature (none is planned) pays the cost of removing the gate and
re-opening the consent copy.

## References

- [#884 — feat: Console panel — scan, found list, identity](https://github.com/on-par/sound-buddy/issues/884)
- [ADR-0006 — Tier 2 console-network consent is granted only by the first-run modal](docs/adr/0006-tier-2-console-network-consent-is-granted-only-by-the-first-run-modal-never-by-a-settings-toggle.md)
