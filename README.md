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
```bash
cd app && npm install && npm run dev
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

- Node.js 20+
- `sox` — `brew install sox`
- `ffmpeg/ffprobe` — `brew install ffmpeg`
- Python 3 + librosa — `pip install librosa numpy`
- [Ollama](https://ollama.ai) (for local LLM analysis, optional)

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

## License

MIT
