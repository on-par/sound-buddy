# Sound Buddy

Audio analysis and coaching tool for church sound engineers. Analyze recordings, get report cards, and receive actionable EQ recommendations.

**Your audio never leaves your machine.** Analysis runs fully local on your Mac — no cloud uploads, no accounts. The app checks GitHub for updates and refreshes a Pro subscription key; usage counts and crash reports are opt-in and off by default. See the [privacy policy](https://soundbuddy.online/privacy) for the full list.

**Unlimited recordings. Stored on your machine.** No usage caps on any tier — no recording-count, length, or storage limits. Recordings live in a folder you choose (Settings ▸ Storage); point it inside iCloud Drive, Dropbox, or Google Drive if you want your own sync.

**Works with the AI you already have.** Sound Buddy never proxies AI or charges for inference — no vendor lock-in, no metered usage.

## Quick Start

### CLI
```bash
npm run build
npx @sound-buddy/cli analyze recording.wav
npx @sound-buddy/cli analyze --scene before.scn --scene after.scn --audio recording.wav
```

### Electron Desktop App

**Download (recommended):** grab the latest `.zip` from the public download repo,
[on-par/sound-buddy-releases](https://github.com/on-par/sound-buddy-releases/releases/latest),
unzip, and drag **Sound Buddy.app** to `/Applications`. The app is **fully self-contained** — `sox`,
`ffmpeg`/`ffprobe`, and a Python runtime with the audio libraries are bundled inside, so
there's no Homebrew or `pip` setup. Apple Silicon (M1+), macOS 26+. The build is signed with an Apple
Developer ID and notarized by Apple, so it launches straight from `/Applications` with no
security override. See the
[install walkthrough](https://soundbuddy.online/#install-walkthrough) for the full
steps. It also checks Releases for newer versions and shows a banner when one is
available (Help ▸ Check for Updates… to check manually); on a signed build, clicking
**Download** then **Restart to Update** downloads and installs the update in place —
no manual drag-and-drop required.

**From source (dev):**
```bash
cd app && npm install && npm run dev   # dev uses PATH sox/ffprobe + a local venv
```

## Packages

| Package | Description |
|---------|-------------|
| `@sound-buddy/shared` | Shared TypeScript types |
| `@sound-buddy/scene-inspector` | M32R .scn scene file parser and diff |
| `@sound-buddy/audio-engine` | Core audio analysis (sox, ffprobe, numpy/scipy spectrum) |
| `@sound-buddy/cli` | `buddy` CLI tool |

## Requirements

The **downloaded app bundles everything** — no external tools needed. The items below are
only for the **CLI** and **building from source**:

- Node.js 20+
- `sox` — `brew install sox`
- `ffmpeg/ffprobe` — `brew install ffmpeg`
- Python 3 + numpy/scipy/soundfile — `pip install -r packages/audio-engine/scripts/requirements.txt`

Building the macOS app locally additionally needs `dylibbundler` (`brew install
dylibbundler`); `app/build/afterPack.js` bundles the native tools + a relocatable Python
into the `.app`.

## Development

```bash
npm run build    # build all packages
npm test         # all unit tests + unified coverage report (alias of `coverage`)
npm run coverage # unified coverage report → ./coverage/
npm run lint     # typecheck + ESLint (zero warnings)
```

### Testing

Sound Buddy uses **test-driven development** (see `CLAUDE.md` and the constitution).
Every package has its own `vitest.config.ts` with **gated coverage thresholds** (ratchet —
never regresses). The root `vitest.config.ts` merges all packages + app + worker into a
single unified `./coverage/` report (`lcov`, `json-summary`, `text`).

- **Unit tests:** Vitest, colocated with source (`foo.ts` → `foo.test.ts`)
- **E2E tests:** Playwright (headless), separate `npm run test:e2e` script
- **Python tests:** `packages/audio-engine/scripts/test_stream.py`, `test_playback.py`
- **Coverage gate:** CI fails if coverage drops below the per-package floor
- **Current coverage:** ~89% lines, ~84% branches (see `vitest.config.ts` thresholds)

### Releasing the macOS app

Downloads are distributed from the **public** repo
[`on-par/sound-buddy-releases`](https://github.com/on-par/sound-buddy-releases) so this
source repo stays private. To cut a release, just run:

```bash
scripts/release.sh            # patch bump (0.2.1 -> 0.2.2)
scripts/release.sh minor      # or: minor / major / an explicit x.y.z
scripts/release.sh --dry-run  # preflight + gate only, no tag, no changes
```

The script bumps the version, runs the gate, and pushes the tag — using your local `gh` auth,
so there's no token to store locally. `.github/workflows/release.yml` is the only thing that
builds, signs, notarizes, verifies `latest-mac.yml`, and publishes to the public repo (as a
draft it promotes last). The script then waits on that run and exits non-zero naming it if it
fails. `RELEASES_TOKEN` (fine-grained PAT, `contents: write` on the releases repo) plus the
five `APPLE_*` signing/notarization secrets are required on the CI side, not optional.

### Release smoke check (before announcing)

After `scripts/release.sh` finishes, and before you announce the release, run the
end-to-end smoke check against the tag it just published:

```bash
npm run smoke:release -- v0.3.0
```

It proves the release channel is reachable through all four layers and exits non-zero
naming whichever layer is broken:

- **`manifest`** — the stable `latest.json` reports this tag's version, artifact, checksum,
  and release notes. Fix: re-run the `Release` workflow for that tag from the Actions tab.
- **`artifact`** — the release zip is downloadable and its size/sha256 match the manifest.
  Fix: delete the release asset and re-run the release.
- **`site-route`** — the site's `/download` route 302-redirects to that same artifact. Fix:
  check the Cloudflare Worker deploy for `site/` and run `node site/scripts/check-download-channel.mjs`.
- **`app-update`** — `latest.json`'s shape still matches the contract other consumers
  (the website, this smoke check) expect. Fix: the manifest drifted from
  `packages/shared/src/release-manifest.ts` — fix and republish `latest.json`.

This is a live-network, tag-pinned operator command — it is not run in CI or `npm test`.

## License

Sound Buddy is dual-licensed:

- **Desktop app (`app/`)** — proprietary, source-available, under the
  [Sound Buddy Desktop Application License](app/LICENSE). Using the app requires a
  valid license key (issued on purchase); redistribution is not permitted.
- **Packages (`packages/*`)** — [MIT](packages/shared/LICENSE): `@sound-buddy/shared`,
  `@sound-buddy/scene-inspector`, `@sound-buddy/audio-engine`, and `@sound-buddy/cli`.
  Each package carries its own MIT `LICENSE` file.

See [LICENSE](LICENSE) at the repo root for the overview. Bundled third-party tools
(sox, FFmpeg, the Python runtime and libraries) remain under their own licenses.
