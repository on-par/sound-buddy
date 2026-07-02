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

## Development

```bash
npm run build    # build all packages
npm test         # run all tests (40 tests)
```

## License

MIT
