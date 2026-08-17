# Shared OSC transport encode/decode for the M32R console ships as a verification-only pass because the feature already landed

- Status: Accepted
- Date: 2026-08-17

## Context

The factory's PLAN phase for issue #874 (feat: OSC transport encode/decode for
M32R console, UDP 10023 — the shared wire-codec layer every console feature
sits on) found that the worktree already contains the complete merged
implementation: origin/main carries commit 5e250e7 "feat: shared OSC transport
encode/decode for M32R console (#874) (#900)" (PR #900, "Closes #874") and the
checkout is up to date with it (HEAD 000a3f7 == origin/main). The merged PR
delivers every acceptance criterion: packages/console/src/index.ts's
encodeOscMessage/decodeOscMessage with the corrected 4-byte alignment formula
(4 - (len % 4)) % 4 (the discovery session's hand-written encoder used
4 - (len % 4) and appended 4 stray nulls on already-aligned strings, silently
corrupting /meters), full f/i/s/b support with actionable OscError messages on
every truncation/range/unknown-tag path, and packages/console/src/address.ts's
normalizeReplyAddress/replyAddressMatches so /node replies arriving on bare
`node` route to their matching pending request; no write capability. Colocated
unit tests (index.test.ts pins the byte-exact hex vector
2f6d6574657273002c7369002f6d65746572732f3600000000000010, the no-over-padding
regression, f/i/s/b round-trips, and the bare-address reply; address.test.ts
pins the reply-address normalization) plus the package's ratchet-threshold
vitest config (100/95/100/100) prove the behavior. A from-scratch
re-implementation would collide with the merged and already design-reviewed
surface for zero user-visible gain. This is the same replay situation that
#381/#382/#834-838/#861-864 resolved with ADR-0025/0026/0032-0047, now applied
to #874 as its first factory pass. The BUILD pass therefore must not
re-implement; it verifies and fixes only concrete regressions in place.

## Decision

Drive issue #874's BUILD pass as verification-only: run the issue's
verification (pure unit tests — the merged suite, no console needed) plus the
workspace gates (npm run lint; npm test; npm run test:coverage -w
@sound-buddy/console; npm run build), confirm every acceptance criterion holds
against the merged implementation and its tests — byte-exact AC1 hex vector, no
over-padding of aligned strings, exact f/i/s/b round-trips, and /node replies
routed on the normalized reply address — and make zero code changes unless a
specific gate genuinely fails (then fix that regression in place, never re-port
the transport surface). Leave packages/console/src/index.ts, src/address.ts,
index.test.ts, address.test.ts, and the package's build/config files intact as
merged; record ADR-0048 documenting the verification-only pass. An empty (or
ADR-only) PR diff is the correct outcome.

## Consequences

Positive: no redundant churn on a fully tested, reviewed surface; the merged
OSC transport and its tests are preserved byte-for-byte; the BUILD pass is
bounded and quick; and the factory's recorded replay convention
(ADR-0025/0026/0032-0047) is extended to #874. Negative: if a gate fails on an
already-merged state, the cause is environmental or a pre-existing regression
and must be root-caused against the merged #900 diff rather than attributed to
new work; the factory must accept a PR whose diff is empty (or ADR-only) as the
correct outcome for this issue; future factory runs must still check issue
state and git history before planning, or the no-op pass would ship in place of
real work.

## References

- [ADR-0047 — Skill-Tree Onboarding ships as a verification-only pass because the feature already landed](docs/adr/0047-skill-tree-onboarding-full-progression-system-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [ADR-0032 — Harshness Rules Engine ships as a verification-only pass because the feature already landed](docs/adr/0032-harshness-rules-engine-ships-as-a-verification-only-pass-because-the-feature-already-landed.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/874)