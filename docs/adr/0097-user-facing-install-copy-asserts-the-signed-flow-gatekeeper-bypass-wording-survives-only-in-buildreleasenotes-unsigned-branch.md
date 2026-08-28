# User-facing install copy asserts the signed flow; Gatekeeper-bypass wording survives only in buildReleaseNotes' unsigned branch

- Status: Accepted
- Date: 2026-08-28

## Context

Sound Buddy shipped unsigned for its first year, and three hand-maintained surfaces grew
copy that walks a buyer through a Gatekeeper override: README.md's download section, the
site FAQ's `unsigned-install` answer, and the `#install-walkthrough` disclosure in
site/src/pages/index.astro (including an `xattr -dr com.apple.quarantine` fallback).
#558 hardened that state by making site/scripts/lib/faq-invariants.mjs *require* the
"Gatekeeper / Open Anyway" wording to appear before `#install-walkthrough`, so the copy
could not be corrected without the site build failing. Since #1187/#1241/#1242, CI is the
only producer and every published artifact is Developer ID-signed, notarized and stapled
(`spctl -a -vvv` reports `source=Notarized Developer ID`), and scripts/release.sh and
scripts/ci-release-manifest.mjs both pass `signed: true` unconditionally. Telling a paying
customer to bypass a malware warning for a product that is in fact notarized is a trust
failure, and the invariant that enforced it pointed the wrong way. At the same time
`buildReleaseNotes({ signed: false })` must keep working: an emergency unsigned build
still has to be describable.

## Decision

The site, README, and generated release notes describe exactly one install flow for the
shipped product: unzip, drag to /Applications, double-click — signed with an Apple
Developer ID and notarized by Apple, with no security override. site/scripts/lib/
faq-invariants.mjs enforces this in both directions: the built homepage's FAQ block must
carry the signed/notarized wording, that wording must appear before
`#install-walkthrough`, and no bypass marker (`Open Anyway`, `Gatekeeper`,
`Apple could not verify`, `com.apple.quarantine`) may appear anywhere in the built HTML.
The unsigned instructions survive in exactly one place — `UNSIGNED_STEPS` in
packages/shared/src/install-instructions.ts, reachable only via
`buildReleaseNotes({ signed: false })` — so an emergency unsigned cut is still
describable without any user-facing surface claiming the shipped build is unsigned. The
FAQ entry keeps its `unsigned-install` slug because it is a published deep-link anchor
(#558); only the wording changes.

## Consequences

Positive: a first-time buyer is never told to click through a malware warning for a
notarized product; the site build now fails if unsigned-bypass copy is reintroduced
anywhere on the homepage, rather than failing when it is removed; the unsigned branch
stays tested and available for an emergency cut.
Negative: if Sound Buddy ever has to publish an unsigned build again, the site copy and
the faq-invariants marker lists must be reverted in the same PR — the invariant makes
that deliberate rather than accidental. The FAQ entry id (`unsigned-install`) no longer
matches its wording, which is documented by a comment on the entry rather than fixed by
a rename.

## References

- [Issue #1234 — release notes and install copy tell the signed truth](https://github.com/on-par/sound-buddy/issues/1234)
- [ADR-0096 — scripts/release.sh is a tag-and-wait client of the CI publisher](docs/adr/0096-scripts-release-sh-is-a-tag-and-wait-client-of-the-ci-publisher-local-builds-are-forbidden-and-audited.md)
