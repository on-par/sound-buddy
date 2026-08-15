# e656 Carve out the AI feature set and shrink the app bundle to <=400 MB: completion record

Issue #656 is a tracking epic, not a feature: carve the entire AI feature set out of the
product and shrink the installed bundle to <=400 MB, split into nine independently
verifiable child issues (#657–#661 AI carve-out, #662–#665 bundle cuts). Every acceptance
criterion is already satisfied in this checkout: all nine children shipped as squash-merged
PRs and are closed `CLOSED` on GitHub, their squash-merge commits are ancestors of HEAD, and
v0.8.14 (tag `a2d2567`, pushed to origin, dated 2026-08-15) already shipped them. Per binding
ADR-0018, an epic whose criteria are met by accumulated work is closed by a repo-homed
completion record that asserts every criterion from the checkout and maps each story to its
issue, PR, and feature files — it is not closed by re-implementing or re-queueing
already-shipped children, which ADR-0018 forbids. This record is that closing evidence.
ADR-0019 does not apply: no completion record existed for #656, so the ADR-0018 record must
be written first. The diff is exactly this one new docs/epics/ file.

## Shipped stories

Titles are the actual GitHub issue titles, read verbatim from `gh issue view`. State is as of
2026-08-15, read from `gh issue view` (all nine report `CLOSED`). Closing PR hashes are the
squash-merge commits reproduced from this checkout's history by the git command in the
Verification section. Each child states its measurable delta in its title and its functional
bar in its body; each landed independently as its own squash-merged PR.

| Story | Actual GitHub title | Merged PR | Feature files in this tree |
|-------|--------------------|-----------|---------------------------|
| #657 | AI carve-out 1/5: remove the AI Engineer UI from the renderer | [#671](https://github.com/on-par/sound-buddy/pull/671) (`9653187`) | new `app/renderer/src/ai-carveout-gate.test.ts`; deleted `app/renderer/ai-dock-state.js`, `ai-dock-state.test.ts`, `src/stores/narrativeStore.ts`, `narrativeStore.test.ts`, `src/ai-dock-gate.test.ts`; edits to `src/App.tsx`, `src/SettingsPanel.tsx`, `src/inline-app.js`, `src/root-markup.html`, `src/stores/bridge.ts`, `src/styles/app.css` |
| #658 | AI carve-out 2/5: remove the narrative IPC channel and its preload/api surface | [#673](https://github.com/on-par/sound-buddy/pull/673) (`b5ba1ce`) | new `app/electron/ai-carveout-gate.test.ts` (#658 section); deleted `app/electron/ipc/narrative.ts`, `ipc/narrative.test.ts`; edits to `preload.ts`, `ipc/api.ts`, `ipc/live-capture.ts`, `no-usage-caps.test.ts`, `app/tests/entitlement-matrix.spec.ts` |
| #659 | AI carve-out 3/5: remove the main-process LLM stack | [#676](https://github.com/on-par/sound-buddy/pull/676) (`8b17aff`) | `app/electron/ai-carveout-gate.test.ts` (#659 section); deleted `llm.ts`, `llm-config.ts`, `ollama-probe.ts`, `narrative-port.ts`, `prompt-drift.test.ts` (+ tests); edits to `settings.ts`, `ipc/settings.ts`, `ipc/api.ts`, `ipc/engine-loader.ts`, `ipc/shared.ts` |
| #660 | AI carve-out 4/5: delete the audio-engine narrative port and drop the @earendil-works dependencies (-144 MB) | [#678](https://github.com/on-par/sound-buddy/pull/678) (`5324d9b`) | new `packages/audio-engine/src/ai-carveout-gate.test.ts`; deleted `src/narrative/port.ts`, `src/narrative/pi-adapter.ts`, `src/engineer.ts` (+ tests); dropped the two `@earendil-works` deps from `packages/audio-engine/package.json` and the lockfiles; edits to `src/stream/index.ts`, `src/stream/display.ts`, `scripts/setup-macos.sh` |
| #661 | AI carve-out 5/5: remove the AI insights pass from the CLI | [#677](https://github.com/on-par/sound-buddy/pull/677) (`386ed95`) | deleted `packages/cli/src/insights.ts`, `insights.test.ts`, `prompts/system-analyst.ts`; edits to `packages/cli/src/analyze.ts`, `packages/cli/src/index.ts`, `packages/audio-engine/src/index.ts`, `src/prompts/index.ts` |
| #662 | Bundle size: replace librosa with numpy/scipy in spectrum.py (-207 MB) | [#670](https://github.com/on-par/sound-buddy/pull/670) (`df8837f`) | `packages/audio-engine/scripts/spectrum.py` (numpy STFT/centroid/rolloff), expanded `scripts/test_spectrum.py`, `scripts/requirements.txt` (drop librosa), `app/build/afterPack.js`, `scripts/verify.sh`, `scripts/setup-macos.sh` |
| #663 | Bundle size: prune the packaged Python runtime (pip, wheel test suites, bytecode duplication) (-80 MB) | [#672](https://github.com/on-par/sound-buddy/pull/672) (`c025b68`) | new `packages/shared/src/python-prune.ts` + `python-prune.test.ts`; `app/build/afterPack.js` |
| #664 | Bundle size: trim bundled ffmpeg dylibs to audio-only codecs (-20 MB) | [#674](https://github.com/on-par/sound-buddy/pull/674) (`bf6872b`) | new `packages/shared/src/ffmpeg-audio-only.ts` + `ffmpeg-audio-only.test.ts`; `app/build/afterPack.js` (builds audio-only ffmpeg from source, cached in `app/.build-cache`) |
| #665 | Bundle size stretch: drop scipy from the packaged Python runtime (-100 MB) | [#781](https://github.com/on-par/sound-buddy/pull/781) (`4573b62`) | `packages/audio-engine/scripts/spectrum.py`, `scripts/stream.py`, `test_spectrum.py`, `test_stream.py`, `scripts/requirements.txt` (drop scipy), `packages/shared/src/python-prune.ts`, `app/build/afterPack.js`, `docs/adr/0015-audio-engine-dsp-stays-numpy-only...md` |

## Acceptance-criteria checklist

Each epic acceptance criterion is asserted from this checkout with its evidence. The four
criteria below are quoted from the #656 issue body.

- [x] **AI feature set is gone — no AI panel, setting, IPC channel, CLI flag, or SDK dependency
      remains.** → `rg -i "earendil|narrative|llm" . --glob '!.git/**' --glob '!node_modules/**'`
      returns only the categorized residual set in the Discrepancies section — none of it is a
      live feature. The three carve-out gate tests prove the operative bar:
      `app/electron/ai-carveout-gate.test.ts` (193 tests, includes #658+#659 sections),
      `app/renderer/src/ai-carveout-gate.test.ts` (63 tests, #657 section), and
      `packages/audio-engine/src/ai-carveout-gate.test.ts` (60 tests, #660 section) all pass —
      they assert the removed modules, IPC channels, bridge methods, provider stack, and
      narrative store no longer exist in this tree. The removed files are absent (verified with
      `fs.existsSync` assertions and manually): `app/electron/ipc/narrative.ts`(+test),
      `app/electron/llm.ts`(+test), `llm-config.ts`(+test), `ollama-probe.ts`,
      `narrative-port.ts`(+test), `app/renderer/src/stores/narrativeStore.ts`(+test),
      `app/renderer/ai-dock-state.js`, `packages/audio-engine/src/narrative/port.ts`(+test),
      `narrative/pi-adapter.ts`(+test), `src/engineer.ts`(+test),
      `packages/cli/src/insights.ts`(+test). And `packages/audio-engine/package.json` declares
      no `@earendil` dependency (the `hasEarendil` check in the #660 gate test passes).
- [x] **Installed bundle <=400 MB.** → `npm run dist --prefix app` completed successfully on
      this branch (requires `npm run build` first for `packages/*/dist-cjs`, plus sox, Homebrew
      ffmpeg, dylibbundler, curl, and Xcode CLT per the `app/build/afterPack.js` header; the
      run downloaded python-build-standalone and built the audio-only ffmpeg once, cached in
      `app/.build-cache`). `du -sh "app/release/mac-arm64/Sound Buddy.app"` measures
      **335M** — below the 400 MB bar. (The plan's projected ~340 MB from the child deltas
      — 887 → 745 → 540 → 460 → 440 → 340 — is confirmed by the measured 335M.)
- [x] **Nothing else changed — the features that remain all still work.** → `./scripts/verify.sh
      --no-e2e` ends "✓ verify passed" on this branch (see Verification): the aggregated unit
      + coverage run (packages + app + worker), the app suite, the numpy-only python tests
      (stream/playback/waveform/spectrum/spike helpers via a local `.venv`), and the worker
      verify + gated coverage are all green. The feature suites covering analyze, grade, report
      card, live capture, playback, scene inspect, and license activation are part of that run:
      `packages/audio-engine/src/analyze/*`, `src/report.test.ts`,
      `app/electron/ipc/live-capture.test.ts`, `app/renderer/src/stores/liveCaptureStore.test.ts`,
      `app/electron/playback.test.ts`, `packages/scene-inspector/*`,
      `app/electron/license.test.ts`, `app/electron/entitlement-matrix.test.ts`, python
      `test_stream.py`/`test_playback.py`/`test_spectrum.py`, and the Playwright specs under
      `app/tests/` (the last exercised by each child PR and by CI; not re-driven here, per
      factory convention — see Non-goals).
- [x] **Each child states a measurable delta + functional bar, and lands independently.** → the
      Shipped-stories table above carries each child's measurable delta in its actual title
      (#660 −144 MB, #662 −207 MB, #663 −80 MB, #664 −20 MB, #665 −100 MB) and its
      independently squash-merged PR with feature files in this tree.

## Verification

Run from this checkout (all green as of 2026-08-15):

- `git log --oneline | grep -E "#(670|671|672|673|674|676|677|678|781)"` — reproduces the nine
  squash-merge commits in order: `9653187` (#671), `b5ba1ce` (#673), `8b17aff` (#676),
  `5324d9b` (#678), `386ed95` (#677), `df8837f` (#670), `c025b68` (#672), `bf6872b` (#674),
  `4573b62` (#781).
- `git merge-base --is-ancestor <sha> HEAD` for each of the nine short hashes — all report
  ancestor-of-HEAD, proving every child PR is in this tree's history.
- `gh issue view 656 --json state,title` — `OPEN` with title "Epic: carve out the AI feature
  set and shrink the app bundle to <=400 MB" before this PR; the PR's `Closes #656` body line
  is what closes it.
- `gh issue view 657..665 --json state` (each) — all nine report `CLOSED` with the exact titles
  in the table above.
- `npm run dist --prefix app` then `du -sh "app/release/mac-arm64/Sound Buddy.app"` — **335M**,
  below the 400 MB bar (measured this branch).
- `rg -i "earendil|narrative|llm" . --glob '!.git/**' --glob '!node_modules/**'` — the full
  output is the categorized residual set below; every match is inert (comment, string-literal,
  doc, or false-positive substring), and the three carve-out gate tests pass
  (193 + 63 + 60 tests).
- `./scripts/verify.sh --no-e2e` — ends "✓ verify passed": install + positioning check +
  gitleaks (no leaks) + build + lint + aggregated unit/coverage + app suite + numpy-only python
  tests + worker verify + gated coverage.

## Discrepancies / evolution notes

Mirroring e317's and e610's honest-recording sections, the residual `rg` matches and other
notes are recorded rather than papered over:

- **The residual `rg` set (categories a–f), all inert.** `rg -i "earendil|narrative|llm"`
  against the tree returns exactly these, none a live feature:
  - (a) **The gate tests' own tokens.** `packages/audio-engine/src/ai-carveout-gate.test.ts`
    declares `hasEarendil` (its `pkg.dependencies` check) and the removed-path `TOKENS`; all
    three `ai-carveout-gate.test.ts` files (`app/electron/`, `app/renderer/src/`,
    `packages/audio-engine/src/`) reference the removed names by design — they exist to assert
    the names are gone. These matches prove the carve-out; they are not residual feature code.
  - (b) **The inert `'ai-narrative'` license-entitlement string and its mirrors.**
    `app/electron/license.ts:91` (`PRO_FEATURES`), `app/renderer/license-state.js:20`
    (renderer mirror), and the test mirrors `app/electron/license.test.ts:308/357`,
    `app/electron/entitlement-matrix.test.ts:54`, `app/electron/no-usage-caps.test.ts:55`.
    This string names a capability that no longer exists; it is a license-gating data value
    that gates nothing at runtime for the removed feature, and per ADR-0018 it is recorded
    here rather than edited (editing it is a product-code change this closing pass does not
    make — see Deliberate non-actions).
  - (c) **narrative/LLM comments referencing removed work.** `app/electron/ipc.ts:7`,
    `app/electron/ipc/shared.ts:92`, `packages/audio-engine/src/format.ts:1`,
    `app/renderer/src/SettingsPanel.tsx:64`, `packages/audio-engine/src/stream/types.ts:8`,
    `packages/audio-engine/scripts/stream.py:47/748`, `packages/audio-engine/vitest.config.ts:25`,
    and `app/tests/e2e/live-capture-report-card.spec.ts:6/132` (LLM trend-context comments). All
    are comments; none execute. Note: the go/no-go plan's predicted (c) list also named
    `app/renderer/upgrade-momentum.js`; that file's #657 reword comment mentions "Ollama" and
    "the AI Engineer UI" but does not contain any of the grep tokens (`earendil|narrative|llm`),
    so it does not appear in the grep output — recorded here as a plan-vs-checkout note, and its
    comment is part of the same not-edited-here cleanup set. Noted for a future copy cleanup PR,
    out of this epic's scope.
  - (d) **`vi.clearAllMocks()` / `resetAllMocks()` / `restoreAllMocks()` substring false
    positives in tests.** 15 test files (e.g. `app/electron/ipc/analysis.test.ts`,
    `app/electron/playback.test.ts`, `packages/audio-engine/src/analyze/orchestrate.test.ts`,
    `packages/cli/src/analyze.test.ts`, `app/renderer/src/ReportCardToolbar.test.ts`) match
    because the mock-reset helper names contain the substring `llm`; they are ordinary Vitest
    teardown calls, not AI references.
  - (e) **base64 sha512 integrity-hash false positives in lockfiles.** Eight matches across the
    four lockfiles — `package-lock.json:259`, `worker/package-lock.json:191/687/2273/2761`,
    `site/package-lock.json:857/4623`, `app/package-lock.json:5231` — match on the base64
    alphabet (`...ValLmha6...` / `...HlLLmve4...` / `...W1llMal...`); these are npm integrity
    hashes, not AI references.
  - (f) **Natural-word false positive.** `docs/signing-and-notarization.md:4` matches because
    the English word "enrollment" contains the substring `llm`; it is not an AI reference.
- **Historical epic records legitimately cite the removed feature.** The earlier completion
  records `docs/epics/e317-*.md` (its stale-table correction names the four carve-out-deleted
  files `llm.ts`, `engineer.ts`, `stream/display.ts`, `ipc/narrative.ts`), `docs/epics/e56-*.md`
  (the `ai-narrative` entitlement), and `docs/epics/e410-*.md` (TD-004 "Unify AI narrative
  stacks", closed by #568) reference the pre-carve-out feature as history. They are records,
  not live feature code; editing prior records is out of scope. This completion record itself
  (and the e317 record before it) likewise references the removed names as documentation, and
  so also appears in a fresh `rg` run after merge — the same doc-reference class.
- **Stale out-of-tree references to the removed feature are recorded, not edited.** The
  marketing site (`site/src/lib/faq.ts:41-44`, `site/scripts/live-home.golden.html`),
  `CLAUDE.md:19/166`, `docs/competitive-smaart.md:120/126`,
  `docs/security/tier-1-tier-2-threat-model.md:47/107/116/118/122`, and
  `docs/discovery/539-report-card-mockup/mockup-b-inline-ai.html` + `.md` describe the AI
  narrative as it existed before the carve-out. These are prose/analysis artifacts (and the
  FAQ will need a copy decision); changing them is out of scope for an ADR-0018 closing pass
  and they are recorded here.
- **The epic's "cut a release whose only user-visible change is size" step.** v0.8.14 shipped
  all nine children; whether a dedicated size-only release is cut is a release-train decision
  outside this PR's diff, recorded here rather than fabricated.
- **Plan-vs-checkout delta.** The go/no-go plan projected the installed size at ~340 MB; the
  measured figure is 335M, slightly better than the projection, and the plan's residual-set
  predictions all held (categories a–e above, plus the honest additions f and the
  historical/stale-reference notes the plan did not enumerate).

## Deliberate non-actions

- No product source, test, coverage-config, or app-config file changes. The diff is exactly
  this one new `docs/epics/` file.
- No re-running or re-implementing any child issue (#657–#665) — all closed, ADR-0018.
- The inert `'ai-narrative'` entitlement string and its mirrors, and the narrative/LLM comments
  in category (c), are **not** edited here (a product-code change outside ADR-0018's scope);
  they are recorded as discrepancies.
- No new `/* c8 ignore */` and no new size assertion — the 400 MB figure is the issue's stated
  goal, not a gate (the issue's body says it is a goal, and ADR-0017's per-project ratchet
  design is untouched).
- The Electron e2e suite is not re-driven in this closing PR (factory convention; the Playwright
  specs under `app/tests/` are exercised by each child PR and by CI).
- No release is cut or tagged in this PR.

## Constitution compliance

- **TDD**: no new code is written, so there is nothing to red-green; the standard is satisfied
  because the change introduces no behavior. The record's proof is the green gate and the three
  passing carve-out gate tests.
- **Coverage ratchet**: no coverage-affecting file changes; gates stay exactly as they are
  (the diff is a doc).
- **Test colocation / no meaningless tests / same harness**: no tests added, changed, or moved;
  Vitest/Playwright harness untouched.
- **Code quality / architecture**: no product code touched; the completion record follows the
  established `docs/epics/` shape (ADR-0018).
- **Quality gates**: `./scripts/verify.sh --no-e2e` green on the branch (`npm run lint` and
  `npm test` are inside that gate).
- **ADR-0018 / ADR-0019**: ADR-0018 followed exactly — verify every criterion from the
  checkout, record the issue→PR→feature-file mapping, `Closes #656`, no product code changes.
  ADR-0019 does not apply (no record existed yet, so this is the ADR-0018 record, not a no-op
  pass). ADR-0015 (numpy-only DSP) and ADR-0011 are untouched.

## Non-goals

- Re-implementing or re-verifying any child issue (#657–#665) — all closed, ADR-0018.
- Removing the residual `'ai-narrative'` entitlement string or narrative/LLM comments — a
  product-code change outside ADR-0018's scope; recorded as discrepancies instead.
- Updating the stale marketing/FAQ/discovery/CLAUDE.md prose that describes the pre-carve-out
  AI feature — a copy/product decision, not an epic-closing one.
- Adding an automated size assertion — the issue says the 400 MB figure is a goal, not a gate.
- Cutting or tagging a release in this PR.
- Any change to app functionality or behavior.
