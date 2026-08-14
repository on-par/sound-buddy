# e383 Council Deliberation 2026-07-14 — Feature Prioritization: completion record

Issue #383 is a tracking epic, not a feature: a 9-member council evaluated 22 candidate
features and voted a 10-feature mvp-in priority list that the factory was to ship in order.
This record verifies, from this checkout, that **all ten mvp-in sub-issues shipped as
squash-merged PRs and are closed `COMPLETED` on GitHub**, so the epic's acceptance criteria
are met by accumulated work — there is no residual feature code to build. This document is
the epic's closing evidence, following the #317 epic precedent (a PR whose diff is the
proof, not a bare GitHub close).

## Shipped mvp-in features

Priority order 1–10 per the epic's numbered list. Issue titles are the **actual** GitHub
titles as shown by `gh issue view`; the epic transcript's numbered list swaps #365↔#367 and
#368↔#369 against those titles (see the transcript-swap note below).

| # | Priority | GitHub issue (actual title) | Merged PR | Feature files in this tree |
|---|----------|-----------------------------|-----------|----------------------------|
| 1 | 1 | #376 Shared spectral-analysis core (dedupe #2/#15 FFT work) | #388 (`f3a08b4`) | `packages/audio-engine/src/analyze/spectral.ts` (+`spectral.test.ts`), exported from `packages/audio-engine/src/index.ts` |
| 2 | 2 | #366 Feedback Ring-Out Assistant (local mic/RTA, FFT peak detection) | #411 (`c698c68`) | `app/renderer/src/RingoutPanel.tsx`, `app/renderer/src/FeedbackDialog.tsx`, `app/renderer/src/stores/ringoutStore.ts` |
| 3 | 3 | #367 Channel Build-Order Guide (guided mixing checklist) — transcript's slot says #365 | #385 (`0a87707`) | `app/renderer/src/BuildGuidePanel.tsx`, `app/renderer/build-order-state.js` |
| 4 | 4 | #365 Rough-Pass / Contextual-Pass mode toggle — transcript's slot says #367 | #387 (`7747837`) | pass-mode wiring in `app/renderer/src/App.tsx` (`pass-mode-state.js` import), `app/renderer/src/ModeTabs.tsx` |
| 5 | 5 | #369 Post-service Gain Structure Report (audio file analysis) — transcript's slot says #368 | #415 (`86dd6fb`) | `packages/audio-engine/src/analyze/gain-structure.ts` (+`gain-structure.test.ts`), exported from `packages/audio-engine/src/index.ts` |
| 6 | 6 | #368 Shareable Report-Card Image Export (PNG, local-only) — transcript's slot says #369 | #386 (`9fde845`) | `app/renderer/src/share-card.ts`, `app/renderer/src/report-export.ts` (+ colocated `share-card.test.ts`, `report-export.test.ts`) |
| 7 | 7 | #370 Doubling/Phase Bug Detector (guided checklist) | #413 (`02a36ee`) | `app/renderer/src/PhaseDoublingDialog.tsx` |
| 8 | 8 | #372 Report Card → Wizard handoff (#15/#16 launch from report card) | #442 (`e023af2`) | `app/renderer/src/ReportCardIsland.tsx`, `app/renderer/src/report-card-chrome.ts`, `app/renderer/feedback-ringout-state.js` |
| 9 | 9 | #374 Build Complete closing moment (thin-slice #20) | #390 (`cd38295`) | `app/renderer/build-order-state.js` `bg-complete` block ("You're done." at 13/13), `app/renderer/src/BuildGuidePanel.tsx` |
| 10 | 10 | #373 Preflight Checklist (config snapshot + drift detection) | #389 (`15d0a99`) | `app/renderer/src/PreflightSettings.tsx` |

Evidence for the merged PR hashes: `git log --all --oneline | grep -E "(#376|#366|#365|#367|#368|#370|#372|#374|#369|#373)"` reproduces each squash-merge commit above. Issue state
evidence: `gh issue view` on all ten reports `state: CLOSED` with `stateReason: COMPLETED`
(all `closedAt` 2026-07-14/15). Epic #383 itself was `OPEN` before this PR and is closed by
this PR's `Closes #383` line.

## Acceptance-criteria checklist

- [x] **#376 is done first; #366 depends on it.** `ringoutStore.ts:50-52` resolves the shared
  core through the preload bridge — `getFindSpectralPeaks()` returns
  `window.audioEngineSpectral.findSpectralPeaks` — and `ringoutStore.ts:175` peaks the ring
  from the analyzed curve via `ro.identifyRing(curve, getFindSpectralPeaks())`. Dependency
  order holds by merge order: PR #388 merged before PR #411.
- [x] **All ten mvp-in features shipped.** Each PR above is merged into this checkout's
  history and each issue is closed `COMPLETED` on GitHub.
- [x] **Governing conditions hold.** See the governing-condition evidence section below.
- [x] **External/manual, deferred, and killed issues have no PR in this checkout.**
  - External/manual: #53, #377, #380 — no factory-queued PR.
  - Deferred: #371, #375, #378, #379, #381, #382 — no factory-queued PR.
  - Killed: #3, #6, #8, #10, #13, #14 — no factory-queued PR.
  - None of these appear in `git log` for this checkout's factory work.
- [x] **Every PR closes its originating issue.** Each of the ten issues is closed `COMPLETED`
  by its own merged PR (one issue → one PR → one close), so no issue is orphaned or double-closed.

## Governing-condition evidence

- **Share export (#368 actual) — "strip all metadata" + local-only:**
  `report-export.ts:20` defines `PNG_METADATA_CHUNK_TYPES = new Set(['tEXt', 'zTXt', 'iTXt',
  'eXIf', 'tIME'])`; `findPngMetadataChunks` scans for those chunk types and
  `assertPngMetadataStripped` aborts the export when any is found. `report-export.test.ts`
  asserts the abort message `'Export aborted: PNG contains metadata chunks: tEXt'` and the
  exact chunk set. No network call: `share-card.ts` renders pure canvas draw-ops
  (`renderShareCard`) with no fetch/XHR, and `buildShareFilename` delegates to
  `report-export.ts`'s `slugify`.
- **Gain structure (#369 actual) — scoped to the existing pipeline:** `assessGainStructure`
  consumes the analyze pipeline's `SoxStats` (`channels: Array<{ name: string; sox: SoxStats
  }>`); no new capture path was added.
- **#374 thin slice:** PR #390's body states the change is a payoff moment only — "no
  gamification or progression system" — with the full #20 deferred.
- **#373 shipped:** PR #389 merged; the preflight feature was later retained through #772's
  always-monitoring change (no regression of this epic's work).

## Transcript swap note

The epic transcript's numbered list swaps two feature pairs against the actual GitHub issue
titles (all `gh`-verified): slot 3 is labeled `#365` but actual #365 is *Rough-Pass /
Contextual-Pass mode toggle* while actual #367 is *Channel Build-Order Guide*; slot 5 is
labeled `#368` but actual #368 is *Shareable Report-Card Image Export* while actual #369 is
*Post-service Gain Structure Report*. Both features of each pair shipped, and the epic's
stated dependency order holds by merge order (#385 before #387; the #376→#366 dependency
holds via #388 before #411). The mapping in the table above records the actual issue
titles/numbers; the swap is documented here, not escalated.

## Verification

- `git log --all --oneline | grep -E "(#376|#366|#365|#367|#368|#370|#372|#374|#369|#373)"`
  — reproduces all ten merged PR hashes listed above.
- `gh issue view` on #376, #366, #365, #367, #368, #370, #372, #374, #369, #373 — all
  `CLOSED` / `COMPLETED`.
- `gh issue view 383` — `OPEN` before this PR, closed by this PR's `Closes #383` line.
- `./scripts/verify.sh --fast` — passes on the accumulated tree, satisfying the epic's final
  verification line ("verify.sh passes on the accumulated changes"). The diff is doc-only, so
  compile, lint, tests, and the coverage ratchet are untouched.
