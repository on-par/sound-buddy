# Read-only guardrail is enforced inside encodeOscMessage itself, not by callers

- Status: Accepted
- Date: 2026-08-17

## Context

The M32R console (#875, parent of #848) has no authentication, pairing, or token — any
UDP sender on the segment has full read/write control, and the console enforces nothing.
The only guarantee Sound Buddy can make is client-side, at the point where OSC messages
are built. A prior "session guardrail" (informal, pre-#874) checked only the OSC address
and lived in the caller, not the codec — so a crafted `/node ,s "-libs/..."` query, which
is still a read but targets a write-adjacent namespace, passed through uninspected. The
issue is explicit that read-only "must be structural, not disciplinary": whatever module
builds the wire bytes has to be the one place that can say no, so every present and future
caller (including the write tier that #848 will eventually add on a separate, explicitly
constructed surface) inherits the guarantee without having to remember to re-check it.

## Decision

packages/console/src/read-only-guard.ts exports a pure function,
assertReadOnlyOscMessage(message: OscMessage): void, that encodeOscMessage
(packages/console/src/index.ts) calls unconditionally before writing any bytes. It applies,
in order: (1) reject any address that exactly matches or is a `/`-bounded subpath of a
deny-listed write/mutation address (`/save`, `/load`, `/copy`, `/paste`, `/delete`, `/add`,
`/undo`, `/scene`, `/snapshot`, `/cue`, `/-action`, `/-libs`) regardless of arguments; (2)
allow any argument-less message on a non-denied address unconditionally (a read); (3) for
an address carrying arguments, require it to be on a reviewed with-args allowlist (`/node`,
`/meters`, `/xremote`, `/renew`, `/unsubscribe`, and the identity-query addresses `/info`
and `/xinfo`); (4) additionally, for `/node`, validate its string argument against the same
deny list after normalizing it to a leading-slash path, so a deny-listed namespace cannot
be reached indirectly through the query path argument.

## Consequences

Positive: the guarantee lives at the one chokepoint every caller must pass through to
produce bytes, so no future feature (including a write tier, if one is ever built on a
separate surface per #848's scope) can accidentally bypass it by skipping a caller-side
check; the deny/allow lists are centralized, reviewable, and unit-tested independently of
wire-format concerns. Negative: adding any new legitimate read address requires an
explicit code change to the allowlist in this file (by design — an unreviewed address must
never silently become sendable); the deny list is a fixed set of known write-adjacent
prefixes and must be kept current by hand if the console's write surface grows.

## References

- [Issue #875](https://github.com/on-par/sound-buddy/issues/875)
- [ADR-0048 — shared OSC transport encode/decode (#874) this guardrail builds on](docs/adr/0048-shared-osc-transport-encode-decode-for-the-m32r-console-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
