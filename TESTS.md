# Testing

Sound Buddy uses test-driven development with gated coverage ratchets.

## Test Framework

- **Unit tests:** [Vitest](https://vitest.dev/) — colocated with source (`foo.ts` → `foo.test.ts`)
- **E2E tests:** [Playwright](https://playwright.dev/) — headless, separate script
- **Python tests:** `packages/audio-engine/scripts/test_stream.py`, `test_playback.py`

## Running Tests

```bash
npm test                    # all unit tests + unified coverage report → ./coverage/
npm run coverage            # same thing (`test` is an alias for it)
npm run test:coverage -w <pkg>          # one package's suite + its coverage gate
npm run test:coverage --workspaces --if-present && npm run test:coverage --prefix app
                            # per-package coverage gates (what CI's gated step runs)
npm run test:e2e            # Playwright e2e (headless)
```

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
| ai-analyst | 100% | 100% | 100% |
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