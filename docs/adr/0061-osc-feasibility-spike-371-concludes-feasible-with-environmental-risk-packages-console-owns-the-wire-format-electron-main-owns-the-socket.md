# OSC feasibility spike (#371) concludes feasible-with-environmental-risk; packages/console owns the wire format, Electron main owns the socket

- Status: Accepted
- Date: 2026-08-17

## Context

The council (2026-07-14, 9/9) mandated #371 as a time-boxed spike before any Tier
2 (console-network) work could begin, with four required deliverables: a security
assessment of the console API surface, a read-only-vs-read-write scope analysis, a
rate-limiting/error-handling story for consoles on unstable church WiFi, and an
offline/degraded-mode spec. A live discovery session against a church M32R
(2026-08-16, findings recorded in docs/discovery/m32r-discovery-findings.md on
branch docs/848-m32r-console-discovery, commit bb813fa) answered all four with
measured data rather than assumptions: a full 2103-node scene capture at 350 ms
timeout / 3 retries lost zero queries; RTT on church WiFi was a 4.3 ms median with
a 93.3 ms p95/max tail; the console has no authentication of any kind and answers
broadcast discovery, so read-only is a guarantee this app's own client code must
enforce, not one the console can enforce; and a naive unicast subnet sweep was
actively harmful (it caused macOS to cache reject routes that then blocked the
real console for the rest of the session).

Three downstream issues (#848 console discovery, #830 console-aware channel
analysis, #859 text-command console control) are explicitly blocked on this
spike's verdict. Two pieces of the eventual architecture already exist without a
recorded decision tying them together: packages/console (#874/#900, ADR-0048)
already implements the OSC wire-format encode/decode that the discovery session's
hand-written Python reference proved out, and app/electron/console-network-consent.ts
(#378, ADR-0006/0013) already implements the first-run consent gate every Tier 2
code path must pass through. Neither #848 nor #830 nor #859 has yet claimed where
the UDP socket itself is opened and owned, and no document yet states the Tier 2
*write* threat model (scene recall, the 4-client `/xremote` cap, and Sunday-safety
UI requirements) that #859 in particular needs before it can be scoped.

#371 itself carried no comment recording any of this, and the correction comment
already posted to #848 (2026-08-16, fixing `/status` vs `/-status`, `/xremote`'s
lack of an ack, and meters-as-push) is not cross-referenced from #371. Closing the
spike without a durable write-up would leave #848/#830/#859 to re-derive the
verdict from a discovery-session findings file living on an unmerged branch.

## Decision

#371 is concluded: **feasible, low technical risk**. The meaningful risk is
**environmental, not code-fixable** — the M32/X32 OSC protocol has no
authentication, so any device that can reach the console's UDP port 10023 has
full read *and* write control, and broadcast discovery means an attacker does not
even need the IP. Sound Buddy's mitigation is client-side discipline (a
read-only allowlist enforced in code, per the existing ADR-0006/0013 consent
design) plus a documented recommendation that churches put the console on a
management VLAN rather than guest WiFi — Sound Buddy cannot fix the church's
network.

Architecturally: **packages/console is the OSC transport layer's permanent home**
(already built per #874/#900/ADR-0048 — encode/decode, byte-exact tested, no
write capability in the codec itself). The **Electron main process owns the UDP
socket's lifecycle** (open/close, retry/backoff, `/xremote`+`/meters`
subscription renewal), following the same deps-injected, unit-testable pattern
ADR-0010 established for Python child-process streams; the renderer talks to it
over IPC, never opening a socket itself. Every future Tier 2 read module
(#848, #830) is built on top of these two pieces, gated by the existing
consoleNetworkConsentGranted check (ADR-0006/0013) before the socket ever opens.

The offline/degraded spec: liveness is "did `/status` reply recently", not a
stateful connection; `/xremote` and `/meters` subscriptions expire silently after
~10 s and must be renewed every ~5 s, with a missed renewal treated as the
reconnect signal (because `/xremote` never acknowledges, there is no other way to
detect the four-client cap silently refusing us); no unicast subnet sweep fallback
— ask the user for the IP instead; per-query timeouts must stay above ~150 ms
(350 ms / 3 retries is the proven-safe baseline) or a healthy console reads as
offline.

The Tier 2 **write** threat model, for #859 and any future control-tier work:
scene recall is the single highest-risk operation because it mutates the entire
live mix atomically with the church mid-service; the protocol's 4-client
`/xremote` cap means a legitimate app session can be silently refused if other
clients (iPads, M32-Edit) are already attached, so any write UI must detect that
by the absence of expected pushes rather than assume a write succeeded; and
because there is no server-side distinction between "connected, read-only" and
"connected, armed to write", the UI itself must carry an unmistakable
armed/disarmed state — Sunday safety cannot depend on the operator remembering
which mode they are in.

This ADR, plus a matching comment posted to #371, are the durable record of these
conclusions. #848's already-posted correction comment stands as-is and is
referenced, not duplicated. #371 is closed once both are in place.

## Consequences

Positive: #848, #830, and #859 have an unblocking, citable verdict and an explicit
socket-ownership decision to build against, instead of re-deriving it from a
findings file on an unmerged branch; the Tier 2 write threat model exists before
#859 needs to be scoped in detail; the security recommendation (management VLAN,
not guest WiFi) is on record as Sound Buddy's documented position rather than an
implicit assumption; packages/console's and the consent gate's roles are now
pinned by a decision record instead of only by their own PRs' descriptions.

Negative: this ADR does not itself change docs/security/tier-1-tier-2-threat-model.md's
unchecked "reviewed and approved" sign-off — a future reader could reasonably ask
why the spike is closed while that gate is still open (see openQuestions in the
accompanying plan; resolving it is left to Patrick). The socket-ownership
recommendation is a design decision, not yet implemented code — #848's own build
must still choose to follow it, and nothing here enforces that structurally.
Because docs/discovery/m32r-discovery-findings.md lives on an unmerged branch, the
quoted numbers in this ADR are the durable copy; if that branch is ever deleted
before merging, this ADR (not the original findings file) becomes the primary
source, so its numbers must not silently drift from a future, possibly-revised
merge of that file.

## References

- [Issue #371 — spike: OSC/console-API feasibility assessment](https://github.com/on-par/sound-buddy/issues/371)
- [Issue #848 correction comment (2026-08-16)](https://github.com/on-par/sound-buddy/issues/848#issuecomment-5309116840)
- [docs/discovery/m32r-discovery-findings.md (branch docs/848-m32r-console-discovery, commit bb813fa)](https://github.com/on-par/sound-buddy/blob/bb813fa/docs/discovery/m32r-discovery-findings.md)
- [docs/security/tier-1-tier-2-threat-model.md](docs/security/tier-1-tier-2-threat-model.md)
- [ADR-0006 — Tier 2 console-network consent is granted only by the first-run modal](docs/adr/0006-tier-2-console-network-consent-is-granted-only-by-the-first-run-modal-never-by-a-settings-toggle.md)
- [ADR-0010 — Python child-process stream lifecycle is owned by one deep module](docs/adr/0010-python-child-process-stream-lifecycle-is-owned-by-one-deep-module-never-re-copied-per-domain.md)
- [ADR-0048 — Shared OSC transport encode/decode for the M32R console ships as a verification-only pass](docs/adr/0048-shared-osc-transport-encode-decode-for-the-m32r-console-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [Issue #894](https://github.com/on-par/sound-buddy/issues/894)
