# CLAUDE.md — Sound Buddy

## Project

Sound Buddy is a Mac (Electron) desktop app for church audio engineers. It analyzes recordings, generates report cards, recommends EQ changes, captures live multi-channel audio, and (in progress) supports virtual soundcheck playback. Currently unsigned, distributed via GitHub releases. Self-contained — bundles sox, ffmpeg, and a Python runtime.

**UI direction:** [docs/design-reference.md](docs/design-reference.md) — Ableton Live as the interaction model, aimed at measurement rather than authoring. Reference for taste, not a checked standard.

## Architecture

**Monorepo** (npm workspaces):
- `packages/shared` — shared TypeScript types
- `packages/scene-inspector` — M32R .scn scene file parser and diff
- `packages/audio-engine` — core audio analysis (sox, ffprobe, numpy/scipy spectrum)
- `packages/cli` — `buddy` CLI tool
- `app/` — Electron desktop app (not a workspace member, has its own package.json)

**Key design decisions:**
- The AI narrative is **user-supplied** — either local Ollama or the user's own API key via `pi`. The app never proxies AI requests and eats zero inference cost.
- Audio analysis runs **fully local** — no audio data leaves the user's machine.
- The app is **self-contained** — `app/build/afterPack.js` bundles sox, ffmpeg, and a relocatable Python runtime into the `.app`.

## Development

```bash
npm run build    # build all workspace packages
npm test         # all unit tests + unified coverage report (alias of `coverage`)
npm run lint     # typecheck all workspaces + app
npm run coverage # unified coverage report (packages + app + worker) -> ./coverage
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
- **Tests:** TDD for all new code — see Standards below. Use the existing test harness — don't add new frameworks.
- **Code style:** Match surrounding code. TypeScript strict mode. No unused imports.
- **Commits:** Logical units with clear messages. Never commit directly to `main`.

## Standards

These are the written standards for this repo. Automated checkers (and the
software factory's check phase) verify work against them — not against
self-reports.

### Test-Driven Development
- All new code must be written test-first: write a failing test (red), make it
  pass (green), then refactor — never the reverse.
- Every new function, branch, and error path must have a test before the code
  is considered done.
- Bug fixes start with a reproducing test that fails, then the fix that makes
  it pass.
- No test is meaningless: every test must assert real behavior. No
  `expect(true).toBe(true)`, no empty `describe` blocks, no tests that only
  check a function exists without exercising it.

### Coverage — Ratchet, Never Regress
- Coverage must increase or stay the same with every change. It must never go
  down.
- The end goal is 100% meaningful statement coverage. "Meaningful" means every
  covered line has a test that exercises real behavior — not just a line hit
  by another test's setup.
- Framework boilerplate (Electron lifecycle callbacks, `process.exit` calls,
  `app.whenReady()` wiring) may be excluded with `/* c8 ignore */` — but only
  with a comment explaining why. Unexplained ignores are violations.
- Type-only modules may be excluded from coverage reporting entirely (they
  emit no runtime code). This is configured in vitest.config.ts, not per-file.

### Test Colocation (TypeScript / JavaScript)
- In Node/TS/JS packages, tests must be colocated with the file they test:
  `foo.ts` → `foo.test.ts` in the same directory.
- No `__tests__/` directories. No `test/` directories. No `__mocks__/`
  directories. Mocks are inline `vi.mock()` calls at the top of the test file.
- E2e tests live next to the code they exercise too — the only exception is a
  top-level `e2e/` dir when the tests span multiple packages.
- Python test files follow Python conventions (`test_*.py` / `*_test.py`
  colocated or in a `tests/` dir alongside the module) — this rule is TS/JS
  only.

### E2e Test Settings
- E2e tests (Playwright or similar) must run headless by default: `headless:
  true` in the config (or simply omitted — headless is Playwright's default),
  and no `--headed`, `--ui`, or `--debug` flags in any npm script or CI step.
  Headed/UI modes are for a human debugging locally, invoked by hand only.
- Reporters must never block or open anything: use `list`, `line`, or `dot`.
  If the `html` reporter is configured, it must be `['html', { open: 'never' }]`
  — a reporter that starts a server hangs autonomous runs.
- The Playwright config must be CI-safe: `forbidOnly: !!process.env.CI`,
  `retries` set for CI (e.g. 2) and 0 locally, and a bounded `workers` count
  on CI (e.g. 1).
- If the app under test needs a dev server, declare it in the config's
  `webServer` block (with `reuseExistingServer: !process.env.CI`) so the test
  runner owns its lifecycle — never require a server to be started manually
  before the suite.
- E2e suites must not run as part of `npm test` — they get their own script
  (e.g. `npm run test:e2e`) so unit-test gates stay fast and display-free.

### Code Quality
- TypeScript strict mode — no `any` without a comment explaining why.
- No floating-point comparisons without epsilon tolerance.
- No hardcoded magic numbers — named constants or config.
- Error messages must be actionable (tell the user what to do, not just what
  broke).

### Architecture
- Pure functions are preferred. Side effects are injected (via params or
  dependency injection), not imported globally.
- Electron main-process code must extract testable logic into pure functions
  and test those. The 5-10 lines of actual `app.whenReady()` wiring get
  `/* c8 ignore */`.
- IPC handlers must be thin — delegate to modules with injected deps that can
  be tested without Electron.

## Quality Gates

1. `compile` — `tsc --noEmit` passes with no errors
2. `lint` — No lint errors
3. `tests` — `npm test` passes — all existing tests still green plus new tests
   for new code

## Dispute Rules

For automated check arbitration (e.g. the software factory's boss agent):
- If a checker flags missing coverage, the worker must either add the test or
  add a `/* c8 ignore */` with a justification comment. "It's hard to test" is
  not a justification — extract pure functions and test those.
- If a worker believes a coverage regression is acceptable (e.g., deleted dead
  code that had tests), the boss must verify the deletion is correct and the
  tests are removed in the same PR.
- TDD violations are not disputable. If there is no test for new code, it fails.
  The only resolution is to write the test.

## Standards Non-Goals

- These standards do not dictate test framework, assertion style, or mock
  pattern — those are in the codebase already, follow what's there.
- 100% branch coverage is not required on type narrowing (e.g.,
  `if (typeof x === 'string')` where `x` is typed `string | undefined` and the
  branch is provably unreachable). Use `/* c8 ignore */` with a comment.
- Performance benchmarks are not gated by these standards — they are a
  separate concern.

## Tech stack

- Node.js 20+, TypeScript strict
- Electron (app/)
- sox, ffprobe, ffmpeg (bundled in production, on PATH in dev)
- Python 3 + numpy/scipy (bundled in production, local venv in dev)
- Ollama (optional, for local AI narrative)
- Vitest (unit tests), Playwright (e2e)

## License

Dual-licensed (#55): `app/` is proprietary source-available (Sound Buddy Desktop Application
License, `app/LICENSE` — use requires a license key, no redistribution); everything outside
`app/`, including all `packages/*`, is MIT. `app/electron/licensing.test.ts` guards the
structure — new app source files need the proprietary header.