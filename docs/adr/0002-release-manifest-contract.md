# Decision: Release channel — machine-readable latest-release manifest

- **Issue:** [#500](https://github.com/on-par/sound-buddy/issues/500)
- **Date:** 2026-07-18
- **Status:** Decided
- **Decision:** Publish a `latest.json` manifest as a release asset on every
  release in the public `on-par/sound-buddy-releases` repo. Consumers (the
  app updater, the website, release tooling) fetch it from the stable URL
  `https://github.com/on-par/sound-buddy-releases/releases/latest/download/latest.json`
  instead of scraping the GitHub releases UI or calling the GitHub API.

This is a contract-only slice: it defines and validates the manifest shape and
wires generation into `scripts/release.sh`. It changes no app or website
behavior — see Non-goals below.

---

## Context

`scripts/release.sh` already publishes a self-contained macOS build (zip
asset + generated release notes) to the public downloads repo. Nothing today
gives a consumer a single, stable, machine-readable answer to "what's the
latest release, and where do I get it" — the updater and any future website
download button would otherwise need to call the GitHub Releases API or parse
HTML, both of which are heavier than needed for a single-file static app with
no backend.

## Decision

Every release publishes a `latest.json` asset alongside the zip, generated
from measured facts (artifact size, sha256, publish timestamp) plus the
version/notes already known to `scripts/release.sh`. GitHub's `releases/latest`
alias means the download URL never changes across releases:

```
https://github.com/on-par/sound-buddy-releases/releases/latest/download/latest.json
```

### Manifest fields

| Field                | Type   | Notes                                   |
| --------------------- | ------ | ---------------------------------------- |
| `schemaVersion`       | number | integer ≥ 1; `1` today                   |
| `version`              | string | semver, no leading `v` (e.g. `"0.4.2"`)  |
| `channel`              | string | `"latest"` today; room for `"beta"` etc. |
| `notesSummary`         | string | plain-text summary of release notes      |
| `releaseUrl`           | string | https release page                       |
| `artifactUrl`          | string | https direct zip download                |
| `artifactSizeBytes`    | number | positive integer                         |
| `sha256`               | string | lowercase hex, 64 chars                  |
| `publishedAt`          | string | ISO 8601 UTC timestamp                   |
| `signed`               | boolean (optional) | marks artifact signing state; false = unsigned Gatekeeper-bypass build, true = Developer ID signed/notarized. Always emitted by scripts/release.sh from electron-builder.yml's identity. |

### Evolution rules

- New optional fields may be added freely.
- Required fields are never removed or renamed without bumping
  `schemaVersion`.
- Readers must ignore unknown fields (verified by a backwards-compat test) so
  older app builds keep working against newer manifests.

### Why this shape

- **No GitHub UI scraping.** A single JSON fetch replaces HTML parsing or
  GitHub API pagination/auth concerns.
- **Works anonymously.** A public repo's release asset is fetchable without a
  token, unlike some GitHub API endpoints under rate limits.
- **Zero extra infra.** No new service, database, or CDN — the manifest rides
  on the same release-asset mechanism the zip already uses.
- **Pure, fully-tested contract.** The schema, builder, and validator live as
  dependency-free TypeScript in `packages/shared`, matching the existing
  `install-instructions.ts` precedent, so the shape is enforced by tests
  rather than convention.

### Publishing guarantees (#501)

`scripts/release.sh --dry-run` prints the manifest it would publish (measured
fields like `artifactSizeBytes`/`sha256`/`publishedAt` shown as a placeholder
since the build hasn't run yet) plus the stable download URL, so a preflight
run answers "what would ship" without mutating anything. After a real
publish, the uploaded zip's digest is verified against the manifest's
`sha256` before `latest.json` is uploaded — a corrupted upload never gets a
manifest pointing at it. Any publish failure (release creation, checksum
verification, manifest generation, or manifest upload) reports explicitly
that app/site update discovery (`latest.json`) was not updated, so an
operator never mistakes a partial failure for a clean release.

### Publishing order (#623)

The release is staged as a GitHub **draft** first — a draft is never
`releases/latest`, so update discovery keeps serving the previous good
release untouched. `latest.json` is generated, checksum-verified, and
uploaded to the draft, and only then is the release promoted out of draft
(`gh release edit --draft=false`) — the single step that makes it visible to
`releases/latest`. Every step before promote is idempotent and safe to
re-run: re-invoking `scripts/release.sh` with the same explicit version
resumes from whatever already exists instead of double-publishing. The
decision logic lives in `packages/shared/src/release-publish.ts`.

## Non-goals

- No in-app download UI, and no change to `app/electron/updater.ts` — it
  keeps using the GitHub Releases API in this slice (pointing it at the
  manifest is a follow-up). **Superseded by #625 below** — `updater.ts` no
  longer does update discovery at all.
- No website changes to consume the manifest.
- No checksum verification of actual downloads at install/update time — this
  defines and validates the *contract*, not download integrity enforcement.
- No historical backfill of `latest.json` onto already-published releases,
  and no channels beyond `"latest"` beyond leaving room in the schema.

## Update discovery migration (#625)

Update *discovery* moved from this ADR's hand-rolled `latest.json` reader
(`app/electron/update-manifest.ts`, now deleted) to electron-updater's
standard `latest-mac.yml` feed, generated by electron-builder from a
`publish:` block in `app/electron-builder.yml` and baked into the shipped
`.app` as `Contents/Resources/app-update.yml`. `scripts/release.sh` and the
CI release workflow both stage `latest-mac.yml` on the draft release
alongside `latest.json`, before promote — the same safety property this ADR
established for `latest.json` (a draft is never `releases/latest`, so a
half-published release never advertises itself). `app/electron/auto-updater.ts`
replaces the hand-rolled `update-manifest.ts` reader and the streaming
download + sha256 verify in `update-download.ts` (both deleted): electron-updater
resolves the feed, verifies its own sha512, and — now that #624 ships signed,
notarized builds — actually installs the download via Squirrel.Mac, so the
in-app flow goes from "download, then drag it yourself" to "download and
restart".

**`latest.json` is unaffected and unretired.** It keeps being generated,
checksum-verified, and published on every release exactly as this ADR
describes — it remains the website's `/download` source and stays available
for any consumer that isn't the Electron app itself. Retiring it is a
separate follow-up once the transition window closes and no shipped build
still depends on it.
