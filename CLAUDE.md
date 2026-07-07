# CLAUDE.md — Sound Buddy

## Project

Sound Buddy is a Mac (Electron) desktop app for church audio engineers. It analyzes recordings, generates report cards, recommends EQ changes, captures live multi-channel audio, and (in progress) supports virtual soundcheck playback. Currently unsigned, distributed via GitHub releases. Self-contained — bundles sox, ffmpeg, and a Python runtime.

## Architecture

**Monorepo** (npm workspaces):
- `packages/shared` — shared TypeScript types
- `packages/scene-inspector` — M32R .scn scene file parser and diff
- `packages/audio-engine` — core audio analysis (sox, ffprobe, librosa spectrum)
- `packages/ai-analyst` — Claude/Ollama API integration for AI insights
- `packages/cli` — `buddy` CLI tool
- `app/` — Electron desktop app (not a workspace member, has its own package.json)

**Key design decisions:**
- The AI narrative is **user-supplied** — either local Ollama or the user's own API key via `pi`. The app never proxies AI requests and eats zero inference cost.
- Audio analysis runs **fully local** — no audio data leaves the user's machine.
- The app is **self-contained** — `app/build/afterPack.js` bundles sox, ffmpeg, and a relocatable Python runtime into the `.app`.

## Development

```bash
npm run build    # build all workspace packages
npm test         # run all unit tests (40 tests across workspaces)
npm run lint     # typecheck all workspaces + app
npm run dev      # dev mode (CLI)
cd app && npm run dev  # dev mode (Electron app)
```

**Full verify gate:**
```bash
./scripts/verify.sh            # install + build + lint + test + e2e
./scripts/verify.sh --no-e2e   # everything except Electron e2e
./scripts/verify.sh --fast     # build + lint + test only
```

**Releasing:**
```bash
scripts/release.sh             # patch bump, build, publish to releases repo
scripts/release.sh minor       # minor or major bump
scripts/release.sh --dry-run   # preflight only
```

## Conventions

- **Branch naming:** `ship-it/<issue#>-<slug>` for auto-shipped PRs
- **PR body:** Summary / Changes / Testing / Screenshots (if UI). Must include `Closes #<N>`.
- **Merge:** Squash merge only (`mergeCommitAllowed: false`, `squashMergeAllowed: true`). Branch auto-deletes on merge.
- **Tests:** TDD where issues are labeled `tdd`. Use the existing test harness — don't add new frameworks.
- **Code style:** Match surrounding code. TypeScript strict mode. No unused imports.
- **Commits:** Logical units with clear messages. Never commit directly to `main`.

## Tech stack

- Node.js 20+, TypeScript strict
- Electron (app/)
- sox, ffprobe, ffmpeg (bundled in production, on PATH in dev)
- Python 3 + librosa/numpy/scipy (bundled in production, local venv in dev)
- Ollama (optional, for local AI narrative)
- Vitest (unit tests), Playwright (e2e)

## License

Dual-licensed (#55): `app/` is proprietary source-available (Sound Buddy Desktop Application
License, `app/LICENSE` — use requires a license key, no redistribution); everything outside
`app/`, including all `packages/*`, is MIT. `app/electron/licensing.test.ts` guards the
structure — new app source files need the proprietary header.