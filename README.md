# Sound Buddy

Audio analysis and coaching tool for church sound engineers. Analyze recordings, get report cards, and receive actionable EQ recommendations.

**Your audio never leaves your machine.** Analysis runs fully local on your Mac — no cloud uploads, no accounts, no telemetry.

**Unlimited recordings. Stored on your machine.** No usage caps on any tier — no recording-count, length, or storage limits. Recordings live in a folder you choose (Settings ▸ Storage); point it inside iCloud Drive, Dropbox, or Google Drive if you want your own sync.

## Quick Start

### CLI
```bash
npm run build
npx @sound-buddy/cli analyze recording.wav
npx @sound-buddy/cli analyze recording.wav --no-ai   # skip LLM analysis
npx @sound-buddy/cli analyze --scene before.scn --scene after.scn --audio recording.wav
```

### Electron Desktop App

**Download (recommended):** grab the latest `.zip` from the public download repo,
[on-par/sound-buddy-releases](https://github.com/on-par/sound-buddy-releases/releases/latest),
unzip, and drag **Sound Buddy.app** to `/Applications`. The app is **fully self-contained** — `sox`,
`ffmpeg`/`ffprobe`, and a Python runtime with the audio libraries are bundled inside, so
there's no Homebrew or `pip` setup. Apple Silicon (M1+), macOS 26+. First launch is
blocked as unsigned — open **System Settings → Privacy & Security**, then click
**Open Anyway** in the Security section (or run
`xattr -dr com.apple.quarantine "/Applications/Sound Buddy.app"`). See the
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
| `@sound-buddy/audio-engine` | Core audio analysis (sox, ffprobe, librosa spectrum) |
| `@sound-buddy/cli` | `buddy` CLI tool |

## Requirements

The **downloaded app bundles everything** — no external tools needed. The items below are
only for the **CLI** and **building from source**:

- Node.js 20+
- `sox` — `brew install sox`
- `ffmpeg/ffprobe` — `brew install ffmpeg`
- Python 3 + librosa — `pip install librosa numpy`
- [Ollama](https://ollama.ai) (for local LLM analysis, optional)

Building the macOS app locally additionally needs `dylibbundler` (`brew install
dylibbundler`); `app/build/afterPack.js` bundles the native tools + a relocatable Python
into the `.app`.

## AI narrative (optional)

**Works with the AI you already have.** Sound Buddy never proxies AI or charges for
inference — you bring your own, either a local Ollama or an API key you already pay for.

The Report Card (score, metrics, recommendations) is fully deterministic and needs **no
AI**. The optional "AI Engineer" prose narrative is powered by a provider you choose, set in
`~/Library/Application Support/SoundBuddy/llm.json` (or the `SOUND_BUDDY_LLM_PROVIDER` /
`SOUND_BUDDY_LLM_MODEL` env vars in dev):

- **Offline — local Ollama** (recommended for a no-cloud machine): `ollama pull llama3.2`,
  then `{ "provider": "ollama", "model": "llama3.2" }`. Direct HTTP, no account.
- **Your own subscription / API key — via [pi](https://pi.dev)**: install pi (`npm i -g
  @earendil-works/pi-coding-agent`, needs Node 22+), run `pi` → `/login` and pick ChatGPT
  Plus/Pro (Codex), Claude Pro/Max, or Copilot (or set an API key), then
  `{ "provider": "anthropic", "model": "claude-sonnet-4-6" }` (or `openai`, etc.). The app
  spawns the `pi` CLI, which reads your shared `~/.pi/agent/auth.json`.

With nothing configured, the panel shows a hint and the rest of the app is unaffected.

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
scripts/release.sh --dry-run  # preflight + gate only, no changes
```

It bumps the version, runs the gate, builds the self-contained `.app`, tags this repo, and
publishes the zip to the public repo — using your local `gh` auth, so there's no token to
store. Needs the build tools on your machine (`brew install sox ffmpeg dylibbundler`).

CI mirror (optional): pushing a `vX.Y.Z` tag also runs the `Release` workflow, which builds
the same zip and uploads it as a workflow artifact; it additionally publishes to the public
repo only if a **`RELEASES_TOKEN`** secret (fine-grained PAT, `contents: write` on the
releases repo) is configured.

### Release smoke check (before announcing)

After `scripts/release.sh` finishes, and before you announce the release, run the
end-to-end smoke check against the tag it just published:

```bash
npm run smoke:release -- v0.3.0
```

It proves the release channel is reachable through all four layers and exits non-zero
naming whichever layer is broken:

- **`manifest`** — the stable `latest.json` reports this tag's version, artifact, checksum,
  and release notes. Fix: re-run the `latest.json` upload steps from `scripts/release.sh`'s
  output.
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
