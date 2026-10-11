# iOS may write console EQ only through a separate, armed writer with delta limits, auto-relock and pre-session undo; the read-only path stays unable to write

- Status: Accepted
- Date: 2026-10-10

## Context

Patrick asked (2026-10-10 CT) for the iOS app to find an X32/M32 on the church network, show a
channel's live EQ, and let him adjust it. Coaching suggestions like "cut around 200 Hz" become
something he can see and apply on the console. Two existing records stood in the way.
`docs/security/tier-1-tier-2-threat-model.md` says Tier 2 is read-only OSC and that anything
needing console **write** is "out of scope for v1 entirely". Its "reviewed and approved"
sign-off box was also never checked. ADR-0060 (read-only guardrail) puts the read-only guarantee
inside `encodeOscMessage`. It notes that a future write tier would need "a separate, explicitly
constructed surface". ADR-0060 (OSC spike) recorded the write threat model: the console has no
authentication; scene recall is the highest-risk operation; the four-client `/xremote` cap can
silently refuse us; and the UI must carry an unmistakable armed/disarmed state, because Sunday
safety cannot depend on memory.

The iOS app has no console code, no local-network keys (`apps/ios/project.yml`,
`apps/ios/SoundBuddy/Info.plist`), and no feature-flag registry. iOS adds its own constraints.
Any LAN traffic triggers the Local Network privacy prompt. UDP broadcast discovery needs Apple's
restricted `com.apple.developer.networking.multicast` entitlement. The app is suspended soon
after it is backgrounded, so every `/xremote` subscription lapses (about 10 s) and must be
rebuilt and resynced on return.

Patrick approved (2026-10-10 CT): EQ edits from iOS with the safety rails below; a build/launch
flag that reveals "Console (beta)" in Settings, with access granted by the consent screen;
X32/M32 first, XAir as a small follow-up, Wing separate and later; coaching targets Main LR EQ
first.

## Decision

1. **Write scope is EQ only, iOS only.** The only writable addresses are, for each band, the
   type, frequency, gain and Q on `/ch/[01-32]/eq/[1-4]/…` and `/main/st/eq/[1-6]/…`, the
   combined band set `…/eq/N ,ifff`, and `…/eq/on`. Faders, mutes, routing, sends, headamps,
   scenes/snippets/libraries, `/-action`, `/-undo`, `/save`, `/load`, `/copy` and every
   other address stay unwritable. The Electron/Mac console surface stays read-only (ADR-0060
   guardrail and ADR-0075 unchanged).
2. **The read-only path cannot write, by construction.** The iOS OSC encoder used for discovery,
   heartbeat, subscriptions and `/node` reads applies a Swift port of `read-only-guard.ts`.
   Writes exist only on a separate `ConsoleEQWriter` type with its own allowlist (above). It can
   only be obtained from an armed session and is never reachable from the read path. Tests prove
   that an unarmed session produces no datagram matching any EQ set address.
3. **Explicit Armed state.** Each connection starts disarmed and read-only. Arming is a
   deliberate per-session action shown as an unmistakable armed indicator. It auto-relocks after
   2 minutes without an edit, on app background, on reconnect/resync, on console identity change,
   and on disconnect.
4. **Per-change delta limits.** One gesture or "Apply" moves band gain by at most ±3 dB and
   frequency by at most one octave from the value when the gesture began. Larger moves need
   further deliberate gestures. Gain stays within the console's ±15 dB.
5. **Rate limit.** Writes are coalesced to the latest value per parameter and sent at most about
   20 messages/s total. No backlog is ever queued.
6. **Undo to the pre-session snapshot.** On first arm in a session, the writer snapshots the
   full EQ of every target it then touches (read back from the console with `/node`). "Revert"
   writes that snapshot back. The console's single global undo (`/-action/undopt`, `doundo`) is
   never used.
7. **Console is the source of truth.** `/xremote` pushes and a periodic `/node` resync win over
   local optimistic values. A conflicting desk change drops our pending write and is shown as
   "changed on desk".
8. **Flag and consent.** iOS gets a feature-flag registry mirroring ADR-0148 (default off, same
   `console` id, no user toggle, never persisted). It is resolved at build/launch: on for Debug
   and TestFlight builds (TestFlight detected at launch from the StoreKit `AppTransaction`
   environment, because TestFlight and the App Store share one binary) and off for App Store
   production. The flag only reveals Settings > "Console (beta)". Access is granted only by the
   iOS consent sheet (ADR-0006 semantics: grant by the sheet, revoke in Settings). The consent
   sheet is shown before the first packet, so iOS's Local Network prompt follows our explanation.
   Arming for writes is a separate, later step from consent.
9. **Network bounds carry over.** RFC 1918/on-link addresses only; one long-lived UDP socket per
   session; 350 ms × 3 query timeouts; renewal about every 5 s; bounded backoff (cap 10 s);
   discovery is user-initiated (last-known IP, manual IP, and a broadcast `/xinfo` once Apple
   grants the multicast entitlement). No unicast subnet sweep.

This ADR amends the threat model's "write is out of scope for v1" line for the iOS EQ write tier
only. The threat model's "reviewed and approved" sign-off is checked in the same change, recording
Patrick's approval on 2026-10-10 CT.

## Consequences

Positive: the coaching loop can close on the real console with rails that are structural (a type
the read path cannot reach, tests on emitted datagrams) rather than conventional. The Mac app's
read-only guarantee is untouched. Every write is bounded in size, rate and time-armed, and
reversible to a known snapshot.

Negative: Sound Buddy's "read-only" messaging no longer holds for iOS. The consent copy must name
EQ writes, and App Store review notes must explain them. The console has no authentication, so
these rails protect against our own mistakes, not against a hostile device on the LAN. The
management-VLAN recommendation (ADR-0060) still stands. "Revert" restores only targets touched
while armed, and a desk-side change made after our edit is overwritten by Revert. The Revert UI
must say so. Any future write beyond EQ needs a new ADR, not an allowlist edit.

## References

- [Epic #1660 — iOS live console EQ (X32/M32) over OSC](https://github.com/on-par/sound-buddy/issues/1660)
- [Tier 1/Tier 2 threat model](../security/tier-1-tier-2-threat-model.md)
- [ADR-0006 — consent modal only](0006-tier-2-console-network-consent-is-granted-only-by-the-first-run-modal-never-by-a-settings-toggle.md)
- [ADR-0060 — OSC feasibility spike](0060-osc-feasibility-spike-371-concludes-feasible-with-environmental-security-risk-packages-console-owns-the-wire-format-electron-main-owns-the-socket.md)
- [ADR-0060 — read-only guardrail inside encodeOscMessage](0060-read-only-guardrail-is-enforced-inside-encodeoscmessage-itself-not-by-callers.md)
- [ADR-0079 — console degraded states](0079-console-degraded-states-are-one-derived-link-state-pushed-on-the-existing-live-state-channel-and-the-four-client-refusal-reads-as-meters-unavailable-never-offline.md)
- [ADR-0148 — feature-flag registry](0148-non-hedgehog-workspaces-sit-behind-an-env-only-feature-flag-registry-default-off-enforced-at-switchmode.md)
- [Apple TN3179 — local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- [Unofficial X32/M32 OSC protocol (P-G. Maillot)](https://sites.google.com/site/patrickmaillot/x32)
