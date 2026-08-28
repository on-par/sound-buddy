# Testing

Sound Buddy uses test-driven development with gated coverage ratchets.

## Test Framework

- **Unit tests:** [Vitest](https://vitest.dev/) — colocated with source (`foo.ts` → `foo.test.ts`)
- **E2E tests:** [Playwright](https://playwright.dev/) — headless by default, separate script
- **Python tests:** `packages/audio-engine/scripts/test_stream.py`, `test_playback.py`

## Running Tests

```bash
npm test                    # all unit tests + unified coverage report → ./coverage/
npm run coverage            # same thing (`test` is an alias for it)
npm run test:coverage -w <pkg>          # one package's suite + its coverage gate
npm run test:coverage --workspaces --if-present && npm run test:coverage --prefix app
                            # per-package coverage gates; CI's gated step runs the same
                            # two halves but continues to the app half even if the
                            # workspaces half fails, so every report uploads
npm run test:e2e            # Playwright e2e (headless; SB_E2E_HEADED=1 for a visible window)
```

### E2E headless

Every spec launches through `app/tests/launch-electron.ts`, which sets
`SB_E2E_HEADLESS=1` for the launched app. `app/electron/main.ts`'s
`getWindowOptions` then builds the BrowserWindow with `show: false` and
`backgroundThrottling: false`, so no window appears (though the macOS Dock icon
still does). `SB_E2E_HEADED=1 npm run test:e2e --prefix app` opts back into a
visible window for debugging. New specs must call `launchElectron`, which
`app/electron/e2e-headless.test.ts` enforces.

## Coverage

The root `vitest.config.ts` runs all workspace packages + the Electron app + the Cloudflare
Worker in projects mode and merges results into a single `./coverage/` directory with
`lcov`, `json-summary`, `cobertura`, and `text` reporters. `npm test` runs this aggregated
coverage run (#438) so external repo scanners always find a Cobertura report at
`./coverage/cobertura-coverage.xml` after a plain root test run.

Each package's `vitest.config.ts` has **gated threshold ratchets** — CI fails if coverage
drops below the floor. Thresholds are set a few points below the current baseline and get
raised as coverage grows.

Current baselines (see each `vitest.config.ts` for exact thresholds):

| Package | Lines | Branches | Functions |
|---------|-------|----------|-----------|
| audio-engine | ~89% | ~84% | ~81% |
| scene-inspector | ~95% | ~84% | 100% |
| cli | ~85% | ~72% | ~96% |
| app (Electron) | ~52% | ~55% | ~45% |
| worker | ~90% | ~87% | 100% |

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `main`:

1. Build (all packages + app)
2. Lint (typecheck + ESLint, zero warnings)
3. Unit tests (workspaces + app)
4. **Coverage gate** (per-package thresholds — fails the build if coverage regresses)
5. Coverage report upload (artifact)
6. Python audio-engine tests
7. Gitleaks secret scan

## Test Conventions

- Tests are **colocated** with source files — no `__tests__/` or `test/` directories
- No `expect(true).toBe(true)` — every test asserts real behavior
- E2E tests run headless with `forbidOnly` in CI
- See `CLAUDE.md` and the constitution for full testing standards
