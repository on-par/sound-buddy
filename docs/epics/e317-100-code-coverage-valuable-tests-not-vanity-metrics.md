# e317 100% code coverage — valuable tests, not vanity metrics: completion record

Issue #317 is a coverage epic, not a feature: raise statement coverage from the issue's stated
66.1% baseline to ≥95% by writing valuable, behavior-asserting tests, ordered by value. Every
acceptance criterion is already satisfied in this checkout. The 66.1% table predates two changes
already merged into this tree's history: the AI carve-out (#659) deleted four of the issue's named
files (`app/electron/llm.ts`, `audio-engine/src/engineer.ts`,
`audio-engine/src/stream/display.ts`, `app/electron/ipc/narrative.ts`), and the epic's own merged
PR #792 (commit `214a804`) added the last colocated tests and ratcheted every per-project coverage
floor (ADR-0017). Per binding ADR-0018, an epic whose criteria are met by accumulated work is
closed by a repo-homed completion record that asserts every criterion from the checkout — it is
not closed by re-implementing already-shipped tests, which ADR-0018 forbids. This record is that
closing evidence.

## Stale-table correction

The issue's "current state" table names four files that no longer exist in this tree, deleted by
the AI carve-out (#659, merged before #792): `app/electron/llm.ts`,
`audio-engine/src/engineer.ts`, `audio-engine/src/stream/display.ts`, and
`app/electron/ipc/narrative.ts`. Their coverage obligations died with them. The surviving
untested-at-66.1% modules already carry colocated or drift-guaranteed tests as of PR #792, which
measured the merged report at 97.21% statements — far above the issue's stale 66.1% figure and
above the ≥95% target.

## Acceptance-criteria checklist

Each criterion from the issue is asserted from this checkout with its evidence.

| Acceptance criterion (issue) | Verified by (this checkout) |
|------------------------------|------------------------------|
| `npm run coverage` ≥95% statements | Merged report `./coverage`: **97.21% statements** (8683/8932), branches 93.29%, functions 94.04%, lines 97.53% — measured 2026-08-14 on this branch. No root merged gate exists or is added (ADR-0017); the ≥95% goal is held by the per-project ratchet floors below. |
| Every pure function in audio-engine has edge-case tests | Colocated suites: `src/analyze/spectrum.test.ts` (added by #792; runSpectrum 20%→100%), `src/analyze/compare.test.ts`, `src/analyze/ebur128.test.ts`, `src/ndjson.test.ts`, `src/report.test.ts`, `src/stream/index.test.ts`, `src/bands.test.ts`, `src/summary.test.ts`. |
| Every IPC handler happy + error path | Colocated suites: `app/electron/ipc/analysis.test.ts`, `ipc/live-capture.test.ts`, `ipc/python-stream.test.ts`, `ipc/run-analysis.test.ts`, `ipc/settings.test.ts`, `ipc/waveform-peaks.test.ts`, `app/electron/ipc.test.ts`, `app/electron/ipc/licensing.test.ts`. |
| `packages/shared` excluded from coverage | **Contradicted on purpose, on ADR-0017's authority.** ADR-0017 records shared as runtime release tooling (release-manifest, signing, notarization, install-instructions, etc.) at its 100/100/100/100 floor and requires it to stay counted. The issue's exclusion-checkbox predates that change. |
| No meaningless tests | No new tests added by this PR (gate found no gap — see below); existing suites assert real behavior. No `expect(true).toBe(true)` or empty `describe` blocks in the suites named above. |
| Tests colocated, same harness | Every suite sits next to the file it covers (`foo.ts` → `foo.test.ts`); no `__tests__/` or `test/` dirs, no new frameworks — Vitest throughout. |

## Residual no-colocated-test files are legitimate, not gaps

Each `src/**/*.ts` runtime file below its floor with no colocated test was inspected and is
covered transitively or is type-only:

- `app/electron/ipc/timeout.ts` — `isAbortError`, drift-guarded by `app/electron/timeout.test.ts`
  (ADR-0011). Its only caller `run-analysis.ts` is asserted by `ipc/run-analysis.test.ts`,
  including the abort path (`cancelled: true`, no `logError`). **No colocated test added; drift
  guard kept.**
- `packages/audio-engine/src/types.ts`, `stream/types.ts`, `playback/types.ts`,
  `packages/shared/src/analysis-payload.ts`, `app/electron/ipc/api.ts` — type-only / wire-contract
  modules; v8 emits no runtime statements for them (`api.ts` is guarded by
  `api.contract.test.ts`, `analysis-payload.ts` by the producer conformance test in
  `audio-engine/src/analyze/orchestrate.test.ts` and the drift test
  `app/renderer/src/analysis-payload-drift.test.ts`).
- `packages/audio-engine/src/prompts/system-engineer.ts`, `prompts/system-multi-channel.ts` —
  single `SYSTEM_PROMPT` string consts, exercised by `prompts/index.test.ts`.
- `packages/audio-engine/src/analyze/spectrum-script.ts` — embedded-Python path resolution,
  exercised transitively by the spectrum tests.
- `packages/audio-engine/src/profiles/index.ts`, `packages/license-policy/src/golden-vectors.ts` —
  data modules, exercised by their colocated suites.
- `packages/scene-inspector/src/index.ts` — re-export surface, exercised by the scene-inspector
  and parser-drift suites.

The gate run exposed **no genuine uncovered runtime statement**: every floor passes and the
residual set is exactly the type-only/data/embedded-Python list above. No colocated test was added
and no `/* c8 ignore */` was introduced.

## Coverage ratchet (ADR-0017) — per-project floors, measured this checkout

| Project | Floor (statements/branches/functions/lines) | Measured (merged run, this checkout) | Pass |
|---------|---------------------------------------------|---------------------------------------|------|
| packages/audio-engine | 98/94/97/98 | 100/97.77/100/100 | ✅ |
| packages/cli | 98/95/97/98 | 100/98.75/100/100 | ✅ |
| packages/license-policy | 100/95/100/100 | 100/100/100/100 | ✅ |
| packages/scene-inspector | 92/80/97/94 | 100/97.37/100/100 | ✅ |
| packages/shared | 100/100/100/100 | 100/100/100/100 | ✅ |
| app | 94/89/91/95 | 96.33/92.30/93.02/96.62 | ✅ |
| worker | 89/74/88/91 | 99.33/92.86/96.59/99.86 | ✅ |
| **Merged (root report)** | ≥95% statements (read from report, no hard gate) | **97.21%** (8683/8932) | ✅ |

Measured figures are aggregated from `./coverage/coverage-summary.json` per project prefix;
the merged line is the `Statements` row of the root `vitest run --coverage` text summary.

## Verification

Run from this checkout (all green 2026-08-14):

- `git log --oneline | grep "#792"` — reproduces the epic's merged PR as `214a804 Epic: 100% code
  coverage — valuable tests, not vanity metrics (#317) (#792)`.
- `git show --stat 214a804` — the PR's diff: colocated `spectrum.test.ts` (20%→100%),
  `app/electron/ipc.test.ts`, `app/electron/ipc/licensing.test.ts`, `worker/src/http.test.ts`,
  `packages/cli/src/analyze.test.ts` (74%→100%), the per-project threshold ratchets, and
  ADR-0017. Merged statements 96.68% → 97.21% per its body.
- `git grep -l "\.test\.ts" app/electron` → 27 suites; `git grep -l "\.test\.ts"
  packages/audio-engine/src` → 3 suites — the colocated evidence behind the checklist.
- `npm run coverage:deps && npm run coverage` — 247 test files / 5133 tests (5116 passed, 17
  skipped), merged **Statements 97.21%**, exit 0 (every per-project floor passes).
- `npm test` — alias of the same aggregated run, green.
- `npm run lint` — `tsc --noEmit` clean across all workspaces + app, `eslint --max-warnings 0`
  clean.
- `npm run test:coverage --workspaces --if-present` and `npm run test:coverage --prefix app` —
  the CI gated ratchet gate (ci.yml "Test coverage (gated)"), exit 0.
- `./scripts/verify.sh --no-e2e` — install + build + lint + test complete green ("✓ verify
  passed"); e2e skipped by flag, per factory convention.

## Deliberate non-actions

- No root merged coverage threshold was added to the root `vitest.config.ts` projects fan-out —
  ADR-0017 keeps the per-project-gate design (the root config's comment "no thresholds are set
  here — the gate stays where it is" is preserved).
- `packages/shared` stays in the coverage report at its 100/100/100/100 floor — the issue's
  literal "exclude shared" checkbox is contradicted on ADR-0017's binding authority and recorded
  here, not silently absorbed.
- No new `/* c8 ignore */` entries. The app's UI-glue exclusions remain exactly the four declared
  `UI_COVERAGE_EXCLUSIONS` (main.tsx, App.tsx, inline-app.js, mock-sound-buddy.ts), each carrying a
  justification and a named e2e gate, guarded by `vitest.config.test.ts` (#401).

## Constitution compliance

- **TDD**: no new code was written (the gate surfaced no gap), so there is nothing to red-green;
  the proof is the existing colocated suites plus the merged report.
- **Coverage ratchet**: every floor passes measured-minus-margin; nothing was lowered and no
  exclusion was added.
- **Test colocation / no meaningless tests / same harness**: all suites colocated, behavior-
  asserting, Vitest-only.
- **Quality gates**: `npm run lint`, `npm test`, `npm run coverage`, the CI gated
  `test:coverage` steps, and `./scripts/verify.sh --no-e2e` all pass on this branch.
- **ADR-0017 / ADR-0018 / ADR-0011**: followed exactly; the one literal-criterion contradiction
  (excluding shared) is the ADR-0017-mandated one and is named above.

## Non-goals

- Re-implementing or re-writing tests for modules that are already merged and at 100% statements
  (ADR-0018).
- Line-coverage chasing via meaningless tests, blanket `/* c8 ignore */`, or lowering any
  per-project floor.
- Changing product behavior, the IPC surface, CLI/API surfaces, or error messages.
- Adding a root merged coverage gate (ADR-0017).
