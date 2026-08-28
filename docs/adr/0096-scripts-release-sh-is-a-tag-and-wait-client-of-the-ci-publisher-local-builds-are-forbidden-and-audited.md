# scripts/release.sh is a tag-and-wait client of the CI publisher; local builds, release creation and asset uploads are forbidden and audited

- Status: Accepted
- Date: 2026-08-27

## Context

Sound Buddy had two independent release producers. `scripts/release.sh` built the app
locally, created the GitHub release on on-par/sound-buddy-releases and uploaded its
assets; the tag push it performed also triggered `.github/workflows/release.yml`, which
built a second signed binary and overwrote the same release's assets minutes later. For
v0.8.30 the local pipeline made the release public at 15:44:27Z while CI finished around
15:52 — a window in which an unsigned zip was `releases/latest`, and in which the
`latest-mac.yml` sha512/zip pairing that electron-updater checks depended entirely on
which producer wrote last. Slice 1 (#1237) retargeted the signing and notarization guards
at the workflow and slice 2 (#1238, ADR-0095) made CI publish a draft, verify the update
feed, and promote as its last step. With that in place the local build is duplicated work
that can only ever produce a worse outcome than CI's: unsigned when the operator's env
vars are unset, and racing CI when they are set. The remaining value of the script is the
things CI cannot do — the dirty-tree and already-published preflight, semver math, the
resume path for a stranded version bump, and an actionable non-zero exit for a human
standing at a terminal.

## Decision

`scripts/release.sh` is reduced to a tag-and-wait client of the CI publisher. It runs
preflight and the local quality gate, bumps the version, previews the release notes,
commits and pushes the commit and tag, waits on the tagged `Release` workflow run with
`gh run watch --exit-status`, and finally verifies through the pure
`verifyPublishedRelease()` that CI published a non-draft release carrying the zip, the
dmg, `latest.json` and `latest-mac.yml`. It builds nothing, creates no release, uploads
no asset and promotes nothing — `.github/workflows/release.yml` is the only producer and
the only publisher. `PUBLISH_STEPS` becomes `['tag-push','ci-build','verify-published']`
and `planUpdateInfoUpload` plus the by-id asset helpers (`findReleaseAssetId`,
`buildReleaseAssetUploadUrl`, `releaseAssetApiPath`) are deleted. The rule is enforced,
not merely documented: `auditLocalReleaseScript()` in
`packages/shared/src/release-publish.ts` reads the real script in the unit suite and
fails `npm test` if `npm run dist`, `gh release create`, an `uploads.github.com` asset
POST or a `-F draft=false` promote ever reappears in it, or if the `gh run watch
--exit-status` wait disappears.

## Consequences

Positive: exactly one pipeline builds the binary a buyer downloads, so an unsigned or
superseded artifact can no longer become `releases/latest`; the sha512 pairing in
`latest-mac.yml` is written by the same job that produced the bytes; a release is public
only after CI's feed verification and promote; and the single-producer rule is a unit
test rather than reviewer memory. Negative: cutting a release now depends on GitHub
Actions availability and on the `RELEASES_TOKEN` secret — there is no local escape hatch,
and restoring one requires reversing this ADR; the operator waits on CI (15-40 minutes
including notarization) instead of watching a local build; and a CI failure leaves a
stranded draft that a human deletes or promotes, exactly as ADR-0095 accepted.

## References

- [Issue #1239 — reduce scripts/release.sh to tag-and-wait](https://github.com/on-par/sound-buddy/issues/1239)
- [Issue #1236 — one pipeline builds the release buyers download](https://github.com/on-par/sound-buddy/issues/1236)
- [ADR-0095 — CI publishes the release as a draft and promotes it only after verifying the update feed](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0095-ci-publishes-the-release-as-a-draft-and-promotes-it-only-after-verifying-the-update-feed-promote-is-the-last-step.md)
