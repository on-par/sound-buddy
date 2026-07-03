# Sound Buddy

Audio analysis and coaching tool for church sound engineers. Analyze recordings, get report cards, and receive actionable EQ recommendations.

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
there's no Homebrew or `pip` setup. Apple Silicon (M1+), macOS 26+. First launch:
right-click → **Open** (unsigned build). It also checks Releases for newer versions and
shows a **Download** banner when one is available (Help ▸ Check for Updates… to check
manually).

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
| `@sound-buddy/ai-analyst` | Claude API integration for AI insights |
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
npm test         # run all tests (40 tests)
```

### Releasing the macOS app

Downloads are distributed from the **public** repo
[`on-par/sound-buddy-releases`](https://github.com/on-par/sound-buddy-releases) so this
source repo stays private. Bump `app/package.json`, then push a `vX.Y.Z` tag: the `Release`
workflow builds the self-contained `.app` on an Apple Silicon runner and publishes it to
that public repo. Cross-repo publishing needs a repository secret **`RELEASES_TOKEN`** (a
fine-grained PAT with `contents: write` on `on-par/sound-buddy-releases`); without it the
build still runs and the zip is available as a workflow artifact to publish manually via
`gh release create <tag> <zip> -R on-par/sound-buddy-releases`.

## License

MIT
