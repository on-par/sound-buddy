# License verification trusts an ordered list of embedded Ed25519 public keys; rotation is a config append

- Status: Accepted
- Date: 2026-08-14

## Context

Issue #115 is the launch point of no return for licensing: the app's embedded
verify key must move from a DEV placeholder to the production Ed25519 public
key whose private half lives only in Cloudflare (LICENSE_SIGNING_PRIVATE_KEY).
The pre-existing design embedded a single public-key constant and verified with
exactly one key, so any future signing-key rotation (generate a new pair, ship a
build that still honors outstanding licenses minted with the old key, mint with
the new key, later drop the old key) would require shipping a code change and a
fresh release at the exact moment a security-sensitive transition happens. The
payload carries a `kid` claim (v2, #109) that could select a key, but the
codebase has deliberately kept `kid`/`jti`/`iss`/`sub` informational and never
gated, and the Worker's LICENSE_SIGNING_KID is documented as safe to bump on
rotation. A list-verify contract keeps trust changes config-only while preserving
the no-gating stance.

## Decision

The shipped app embeds an exported `EMBEDDED_PUBLIC_KEYS` list of SPKI PEMs
(starting with the single production key) and `verifyLicenseKey` accepts a
license if ANY listed public key verifies its Ed25519 signature. Rotating the
signing key means appending the new public key to the list, shipping the build,
minting with the new private half, and later removing the old entry from the list
once its last minted license has lapsed. `kid` never selects or gates a key —
list-verify is the trust contract.

## Consequences

Positive: rotation becomes a one-line config append with no verification-logic
change and no emergency release; a bad production-key paste is caught by the
committed production-signed sample-key test; the DEV placeholder is forced out by
a test asserting its absence. Negative: verification iterates the list, re-parsing
each PEM per verify call (trivial for a 1-2 entry list and unchanged from the
single-key cost today); a deprecated key must remain in the list until its last
license expires (only a coordination cost, never a correctness cost); a key that
is removed from the list immediately invalidates any of its unexpired licenses.

## References

- [docs/security/license-key-rotation.md (added in this PR)](docs/security/license-key-rotation.md)
- [worker LICENSE_SIGNING_KID / LICENSE_SIGNING_PRIVATE_KEY (worker/wrangler.jsonc, worker/src/license-sign.ts)](worker/wrangler.jsonc)
- [Issue #115](https://github.com/on-par/sound-buddy/issues/115)
