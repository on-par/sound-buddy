# #1431 — report-first-ux reference inventory

Tab visibility today is driven by two parallel mechanisms — Simple mode state
and the older report-first-ux experiment (epic e17) — and nobody had
enumerated every place the experiment still touches code. This document is
that census: every match of the identifiers below, classified so a future
removal PR knows its blast radius up front. **No code changes were made as
part of this issue** — classification only.

## Method

Eight identifiers, taken verbatim from the issue's `Verification` grep
command:

```
reportFirstUx | report-first-ux | SOUND_BUDDY_REPORT_FIRST_UX | AnalyzeSourcePicker |
analyzeSourceStore | analyze-source-state | single-column | applySingleColumnSync
```

Each is a fixed-string (non-regex) search over every git-tracked file in the
repo. `git ls-files -z` reproduces `rg -l`'s `.gitignore`-aware default
byte-for-byte for this pattern set (verified during triage), so the guard
test below drives its scan off `git ls-files` rather than depending on the
`rg` binary being present in CI.

The combined pattern matches **294 distinct lines across 59 files**. Sections
below total **303 rows** because a handful of lines contain more than one
identifier (e.g. a comment mentioning both `reportFirstUxEnabled` and
`report-first-ux` in the same sentence) and are listed once per identifier
they contain.

## Disposition legend

- **keep** — no action needed when the experiment is removed; the line has
  no functional coupling to the flag/picker/single-column mechanism.
- **delete** — goes away as part of removing the flag, the single-column
  layout, or their supporting tests/comments.
- **defer-to-follow-up** — tied to `AnalyzeSourcePicker`'s fate, which issue
  #1431 explicitly puts out of scope ("deciding the final fate of
  AnalyzeSourcePicker" is listed under Out of scope). A future issue must
  decide whether the picker is promoted, deleted, or reworked before these
  lines can be classified further.

## Cross-cutting notes

1. **Simple mode is defined in terms of the experiment.**
   `app/renderer/src/simple-mode.ts:13` — `isSimpleMode` requires
   `settings.reportFirstUxEnabled !== true`. The clause on line 13 is
   `delete`; the `isSimpleMode` function itself is `keep` — it is the exact
   coupling point between the two mechanisms the issue describes, and the
   function has a life beyond the experiment (it also reads
   `advancedFeaturesEnabled`).

2. **`AnalyzeSourcePicker` is reachable but CSS-dead by default.**
   `resolveModeSwitch` returns `openPicker` in any non-Simple mode, while
   `app.css:173` (`body:not(.report-first-ux) #analyze-source-picker {
   display:none !important }`) hides it whenever the flag is off — the
   default in production today. Dropping that CSS gate would *reveal* a
   picker that has never been visible to a real user. The issue puts the
   picker's fate out of scope, so every AnalyzeSourcePicker-, analyzeSourceStore-,
   and analyze-source-state-related row, plus this specific CSS rule and its
   two references, are labelled `defer-to-follow-up` rather than `delete`.

3. **Five source comments cite `tests/e2e/report-first-ux.spec.ts`, which no
   longer exists in the repo** (`ModeTabs.tsx:59`, `BuildGuidePanel.tsx:69,86`,
   `RecentServicesPanel.tsx:123`, `ReportCardToolbar.tsx:159`,
   `AnalyzeSourcePicker.tsx:44`). These are dead references today, independent
   of any future decision about the flag or the picker — the first four are
   labelled `delete`, and the fifth (inside `AnalyzeSourcePicker.tsx`) is
   folded into that file's `defer-to-follow-up` row since the file's fate is
   still pending.

No `adr:` entry accompanies this document — it records facts about the
current codebase, it doesn't make a decision that constrains future code.

### `reportFirstUx`

| File | Lines | Disposition | Reason |
|---|---|---|---|
| `app/electron/ipc/api.ts` | 39, 320 | delete | AppSettings type field declaration for the flag. |
| `app/electron/ipc/settings.test.ts` | 393, 396, 397, 399, 400, 405, 406, 408, 413, 414, 416, 623 | delete | IPC update-settings whitelist test dedicated to reportFirstUxEnabled coercion behavior. |
| `app/electron/settings.test.ts` | 292, 294, 299, 303, 304, 305, 306, 308, 309, 310, 315, 320, 324, 326, 330, 334, 336, 338, 340, 829, 833, 835, 837, 839, 842, 843, 846, 998 | delete | Describe block plus AppSettings fixture fields cover the flag's env/file precedence and rig-write isolation; goes with the setting. |
| `app/electron/settings.ts` | 312, 314 | delete | Setting spec (default + file sanitizer) for the flag; removed when reportFirstUxEnabled retires. |
| `app/renderer/report-first-ux-state.js` | 6, 15, 20 | delete | The pure predicate module reading reportFirstUxEnabled; deleted with the flag. |
| `app/renderer/report-first-ux-state.test.ts` | 3, 9, 10, 13, 14, 30 | delete | Unit suite for the report-first-ux-state.js predicate module; deleted with the module. |
| `app/renderer/src/App.tsx` | 52, 164 | delete | Boots report-first-ux-state.js as an inline classic-script import; removed with the module. |
| `app/renderer/src/LiveAdjustmentsPanel.test.ts` | 45 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/LiveCapturePanel.test.ts` | 51 | delete | AppSettings test fixture spreads reportFirstUxEnabled; field removal cascades here. |
| `app/renderer/src/LiveEqPane.test.ts` | 45 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/LiveWorkspace.test.ts` | 39 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/ModeTabs.test.ts` | 26, 106 | delete | AppSettings test fixture field plus the precedence-over-Simple-mode test case. |
| `app/renderer/src/OnboardingDialog.test.ts` | 27 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/RecentServicesPanel.test.ts` | 76 | delete | Mocks the global reportFirstUxState API; goes with the module. |
| `app/renderer/src/ReportCardIsland.test.ts` | 20, 146, 380, 390, 457, 467, 483 | delete | Tests for the reportFirstUxOn score-circle vs. legacy-table branch; goes with ReportCardIsland.tsx. |
| `app/renderer/src/ReportCardIsland.tsx` | 102, 371, 385, 504 | delete | reportFirstUxOn branches score-circle rows vs. the legacy metric table and the contextual-links prop; the legacy branch becomes the only path once the flag is gone. |
| `app/renderer/src/ReportCardToolbar.tsx` | 26, 34, 46 | defer-to-follow-up | isPickerEnabled/getReportFirstUxState exist to gate AnalyzeSourcePicker's visibility; follows the picker's deferred fate. |
| `app/renderer/src/SettingsPanel.test.ts` | 131 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/analyze-source-gate.test.ts` | 69, 72 | defer-to-follow-up | Asserts ReportCardToolbar gates the picker through reportFirstUxState rather than reading settings directly; the picker itself is out of scope for a disposition decision (issue #1431 explicitly defers AnalyzeSourcePicker). |
| `app/renderer/src/inline-app.js` | 487 | delete | Drives the body.report-first-ux class from window.reportFirstUxState.isEnabled; removed with the predicate module. |
| `app/renderer/src/live-workspace-view.test.ts` | 90 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/mock-sound-buddy.ts` | 47 | delete | Shared test-double default for AppSettings; removed with the setting. |
| `app/renderer/src/mode-switch.test.ts` | 80, 104, 186, 193 | delete | Tests for mode-switch.ts's reportFirstUxState typed-window accessor and its role in single-column sync; goes with that plumbing (see single-column section). |
| `app/renderer/src/mode-switch.ts` | 63, 72 | delete | SingleColumnStateApi/ReportFirstUxStateApi typed-window accessors; removed with the flag (single-column sync needs a redesign, tracked in the single-column section). |
| `app/renderer/src/report-first-ux-gate.test.ts` | 17, 24, 25, 27, 29, 34, 43 | delete | Entire gate-test file pins the flag's App.tsx boot wiring and body-class toggle; goes with the flag. |
| `app/renderer/src/settings-instant-apply.test.ts` | 28 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/simple-mode-body.test.ts` | 25, 58 | delete | Fixture field plus the precedence-of-experiment-over-Simple-mode test case; goes with the clause in simple-mode.ts. |
| `app/renderer/src/simple-mode.test.ts` | 13, 33 | delete | Fixture field plus the "keeps the experiment in precedence" test case; goes with the clause in simple-mode.ts. |
| `app/renderer/src/simple-mode.ts` | 13 | delete | The `settings.reportFirstUxEnabled !== true` clause is deleted; `isSimpleMode` itself is kept — this is the coupling point between Simple mode and the experiment (see cross-cutting notes). |
| `app/renderer/src/storage-settings.test.ts` | 28 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/stores/bridge.test.ts` | 286 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/stores/onboardingStore.test.ts` | 51 | delete | Mocks the global reportFirstUxState API; goes with the module. |
| `app/renderer/src/stores/rigStore.test.ts` | 66 | delete | AppSettings test fixture field; removed with the setting. |
| `app/renderer/src/stores/settingsStore.test.ts` | 33, 54, 100, 133, 198 | delete | AppSettings test fixture field, repeated across multiple test cases; removed with the setting. |
| `app/renderer/src/stores/soundcheckStore.test.ts` | 34 | delete | AppSettings test fixture field; removed with the setting. |

### `report-first-ux`

| File | Lines | Disposition | Reason |
|---|---|---|---|
| `app/electron/ipc/api.ts` | 313, 315 | delete | JSDoc block documenting the flag on the AppSettings type; removed with the field. |
| `app/electron/settings.test.ts` | 292 | delete | Describe-block title naming the epic; goes with the describe block. |
| `app/renderer/report-first-ux-state.js` | 4, 10 | delete | Module header comment; deleted with the module. |
| `app/renderer/report-first-ux-state.test.ts` | 3, 4 | delete | Comment/require referencing the module under test; deleted with the module. |
| `app/renderer/src/AnalyzeSourcePicker.tsx` | 10, 44 | defer-to-follow-up | Comment on the CSS gate that hides the picker by default, and a stale tests/e2e/report-first-ux.spec.ts reference; both tied to the picker's deferred fate. |
| `app/renderer/src/App.tsx` | 52 | delete | Import path for report-first-ux-state.js; removed with the module. |
| `app/renderer/src/BuildGuidePanel.tsx` | 69, 86 | delete | Stale comment citing tests/e2e/report-first-ux.spec.ts, which no longer exists in the repo; dead reference regardless of the flag's fate. |
| `app/renderer/src/ModeTabs.test.ts` | 105 | delete | Test title for the precedence-over-Simple-mode case; goes with the clause in simple-mode.ts. |
| `app/renderer/src/ModeTabs.tsx` | 59 | delete | Stale comment citing tests/e2e/report-first-ux.spec.ts, which no longer exists in the repo; dead reference regardless of the flag's fate. |
| `app/renderer/src/RecentServicesPanel.tsx` | 123 | delete | Stale comment citing tests/e2e/report-first-ux.spec.ts, which no longer exists in the repo; dead reference regardless of the flag's fate. |
| `app/renderer/src/ReportCard.tsx` | 88, 103 | delete | JSDoc comments documenting score-circle rows and contextual-links props, both gated behind the epic; removed together with the flag-on branch in ReportCardIsland.tsx. |
| `app/renderer/src/ReportCardIsland.test.ts` | 20, 377, 388 | delete | Test titles/require for the reportFirstUxOn branch; goes with ReportCardIsland.tsx. |
| `app/renderer/src/ReportCardToolbar.tsx` | 159 | delete | Stale comment citing tests/e2e/report-first-ux.spec.ts, which no longer exists in the repo; dead reference regardless of the flag's fate. |
| `app/renderer/src/analyze-source-gate.test.ts` | 110 | defer-to-follow-up | Asserts the exact CSS gate rule `body:not(.report-first-ux) #analyze-source-picker`; the picker's fate (and this gate) is explicitly out of scope for #1431. |
| `app/renderer/src/final-nav-gate.test.ts` | 13, 38, 41, 46, 47, 48, 56, 68, 72 | delete | Entire gate-test file pins body.report-first-ux CSS selectors for nav collapsing; goes with the CSS. |
| `app/renderer/src/inline-app.js` | 487 | delete | Drives the body.report-first-ux class toggle from the predicate; removed with the module. |
| `app/renderer/src/mode-switch.test.ts` | 185 | delete | Test description for reading the flag through to singleColumnState; goes with single-column sync (see single-column section). |
| `app/renderer/src/mode-switch.ts` | 59, 119 | delete | Comments documenting the classic-script coupling and the single-column fold; goes with the typed accessors (see reportFirstUx section). |
| `app/renderer/src/report-first-ux-gate.test.ts` | 9, 18, 23, 24, 32, 34, 38, 39, 42 | delete | Entire gate-test file pins the flag's App.tsx boot wiring and body-class toggle; goes with the flag. |
| `app/renderer/src/simple-mode-body.test.ts` | 56 | delete | Test title for the precedence-over-Simple-mode case; goes with the clause in simple-mode.ts. |
| `app/renderer/src/simple-mode.test.ts` | 32 | delete | Test title for the "keeps the experiment in precedence" case; goes with the clause in simple-mode.ts. |
| `app/renderer/src/single-column-gate.test.ts` | 10 | delete | Comment cross-referencing report-first-ux-gate.test.ts; goes with the whole single-column-gate file (see single-column section). |
| `app/renderer/src/source-tabs-gate.test.ts` | 11, 46, 47, 48, 49, 59, 63, 69 | delete | Entire gate-test file pins body.report-first-ux CSS selectors for the old source tabs; goes with the CSS. |
| `app/renderer/src/styles/app.css` | 160, 173, 184, 193, 194, 195, 196, 202, 203, 210, 1460, 1494 | delete | CSS rules and comments scoped to body.report-first-ux (mode-tab hiding, nav collapsing, score-circle/single-column epic comments); removed with the class toggle, except the #analyze-source-picker rule at line 173 which is deferred with the picker. |
| `app/renderer/src/tool-tabs-gate.test.ts` | 11, 29, 30, 31, 32, 42, 46, 52 | delete | Entire gate-test file pins body.report-first-ux CSS selectors that hide Build Guide/Ring Out tabs; goes with the CSS. |
| `docs/discovery/539-report-card-mockup/mockup-a-score-circle.html` | 4 | keep | Frozen discovery artifact (static HTML mockup); zero production code, no coupling to the live mechanism. |
| `docs/discovery/539-report-card-mockup/mockup-b-inline-ai.html` | 4 | keep | Frozen discovery artifact (static HTML mockup); zero production code, no coupling to the live mechanism. |

### `SOUND_BUDDY_REPORT_FIRST_UX`

| File | Lines | Disposition | Reason |
|---|---|---|---|
| `app/electron/ipc/api.ts` | 317 | delete | JSDoc documenting the env-var override; removed with the field. |
| `app/electron/settings.test.ts` | 68, 313, 314, 318, 319, 323, 325, 331, 830 | delete | Tests for the env-var override reading/precedence; goes with envRead wiring for this setting. |
| `app/electron/settings.ts` | 316, 479 | delete | envRead wiring for this setting, and a comment using SOUND_BUDDY_REPORT_FIRST_UX as the worked example of the transient-env-override contract; the generic envRead pattern used by other settings stays, only this flag's entry and example go. |

### `AnalyzeSourcePicker`

| File | Lines | Disposition | Reason |
|---|---|---|---|
| `app/renderer/src/AnalyzeSourcePicker.test.ts` | 7, 20, 23 | defer-to-follow-up | Component test suite; the component's fate is explicitly out of scope for #1431. |
| `app/renderer/src/AnalyzeSourcePicker.tsx` | 34 | defer-to-follow-up | The component itself; its fate is explicitly out of scope for #1431. |
| `app/renderer/src/App.tsx` | 94, 418 | defer-to-follow-up | Mounts AnalyzeSourcePicker as a direct child; the component's fate is explicitly out of scope for #1431. |
| `app/renderer/src/analyze-source-gate.test.ts` | 12, 21, 40, 41, 42, 45, 48, 75, 80, 87, 97, 106 | defer-to-follow-up | Entire gate-test file pins AnalyzeSourcePicker's mount/behavior; the component's fate is explicitly out of scope for #1431. |
| `app/renderer/src/inline-app.js` | 192, 427 | defer-to-follow-up | Comments noting inline-app.js delegates file choice to AnalyzeSourcePicker.tsx; tied to the picker's deferred fate. |
| `app/renderer/src/root-markup.html` | 14 | defer-to-follow-up | Comment noting the picker now renders reactively rather than from static markup; tied to the picker's deferred fate. |
| `app/renderer/src/root-markup.test.ts` | 122, 123 | defer-to-follow-up | Pins that the live-source capture option was purged, now owned by AnalyzeSourcePicker.tsx; tied to the picker's deferred fate. |
| `app/renderer/src/source-tabs-gate.test.ts` | 27, 29 | defer-to-follow-up | References AnalyzeSourcePicker.tsx as the current home of source routing; tied to the picker's deferred fate. |
| `app/renderer/src/stores/analyzeSourceStore.ts` | 8 | defer-to-follow-up | Comment on where chooseAndAnalyzeFile lives relative to the picker; tied to the picker's deferred fate. |

### `analyzeSourceStore`

| File | Lines | Disposition | Reason |
|---|---|---|---|
| `app/renderer/src/AnalyzeSourcePicker.test.ts` | 8, 13 | defer-to-follow-up | Imports/references the picker's store; tied to the picker's deferred fate. |
| `app/renderer/src/AnalyzeSourcePicker.tsx` | 15, 43 | defer-to-follow-up | Imports the store it renders from; tied to the picker's deferred fate. |
| `app/renderer/src/ModeTabs.tsx` | 15, 70 | defer-to-follow-up | Imports the store to open the picker on tab click; tied to the picker's deferred fate. |
| `app/renderer/src/ReportCardToolbar.tsx` | 17, 206 | defer-to-follow-up | Imports the picker's store; tied to the picker's deferred fate. |
| `app/renderer/src/analyze-source-gate.test.ts` | 12, 22 | defer-to-follow-up | References analyzeSourceStore.ts as part of the picker gate; tied to the picker's deferred fate. |
| `app/renderer/src/inline-app.js` | 193 | defer-to-follow-up | Comment noting routing moved to analyzeSourceStore; tied to the picker's deferred fate. |
| `app/renderer/src/root-markup.html` | 15 | defer-to-follow-up | Comment noting the overlay now renders reactively from analyzeSourceStore; tied to the picker's deferred fate. |
| `app/renderer/src/stores/analyzeSourceStore.test.ts` | 5 | defer-to-follow-up | The store's own test suite; tied to the picker's deferred fate. |

### `analyze-source-state`

| File | Lines | Disposition | Reason |
|---|---|---|---|
| `app/renderer/analyze-source-state.test.ts` | 3, 4 | defer-to-follow-up | Unit suite for the picker's classic-script predicate module; tied to the picker's deferred fate. |
| `app/renderer/src/AnalyzeSourcePicker.test.ts` | 12 | defer-to-follow-up | Comment referencing the module's own test suite; tied to the picker's deferred fate. |
| `app/renderer/src/AnalyzeSourcePicker.tsx` | 28, 42 | defer-to-follow-up | Sources ANALYZE_SOURCES labels/hints/icons and targetModeFor from this module; tied to the picker's deferred fate. |
| `app/renderer/src/App.tsx` | 54 | defer-to-follow-up | Boots analyze-source-state.js as an inline classic-script import; tied to the picker's deferred fate. |
| `app/renderer/src/analyze-source-gate.test.ts` | 17, 25, 31, 32, 82, 113 | defer-to-follow-up | Entire gate-test file pins analyze-source-state.js's boot wiring and header; tied to the picker's deferred fate. |
| `app/renderer/src/source-tabs-gate.test.ts` | 23, 85 | defer-to-follow-up | Reads analyze-source-state.js to assert live routing through targetModeFor; tied to the picker's deferred fate. |

### `single-column`

| File | Lines | Disposition | Reason |
|---|---|---|---|
| `app/renderer/analyze-source-state.js` | 6 | delete | Comment cross-referencing single-column-state.js's module convention; goes with that module. |
| `app/renderer/single-column-state.js` | 4 | delete | The pure single-column-layout predicate module; deleted with the single-column feature (gated behind the report-first-ux epic, #542). |
| `app/renderer/single-column-state.test.ts` | 3, 4 | delete | Unit suite for single-column-state.js; deleted with the module. |
| `app/renderer/src/App.tsx` | 53 | delete | Boots single-column-state.js as an inline classic-script import; removed with the module. |
| `app/renderer/src/ai-carveout-gate.test.ts` | 63 | delete | single-column-state.js is one of many files scanned for AI carve-out tokens; the entry must be removed when the file is deleted, though this gate test itself is unrelated to the experiment. |
| `app/renderer/src/analyze-source-gate.test.ts` | 15 | delete | Comment citing single-column-gate.test.ts as a sibling convention; goes when that file is deleted. |
| `app/renderer/src/inline-app.js` | 515 | delete | Comment on rendering single-column without a tab click; goes with the sync call (see applySingleColumnSync section). |
| `app/renderer/src/live-workspace-view.ts` | 473 | keep | Illustrative comment citing single-column as an example of class-based hiding (ADR-0136); the perf-guard function itself does not read or toggle this class, so it needs no code change if the class disappears — only the example goes stale. |
| `app/renderer/src/mode-switch.test.ts` | 195, 198, 199, 204, 258, 261 | delete | Assertions on the single-column body-class toggle; goes with applySingleColumnSync (see that section). |
| `app/renderer/src/mode-switch.ts` | 59, 121 | delete | Comment plus the classList.toggle('single-column', ...) call; removed with the feature. |
| `app/renderer/src/single-column-gate.test.ts` | 24, 27, 28, 36, 39, 54, 55, 59, 60, 63 | delete | Entire gate-test file pins the single-column layout gate end-to-end; deleted with the feature. |
| `app/renderer/src/source-tabs-gate.test.ts` | 16 | delete | Comment noting this file mirrors single-column-gate.test.ts's markup-deletion convention; goes with that file. |
| `app/renderer/src/styles/app.css` | 1497, 1500, 1501, 1502 | delete | CSS rules for body.single-column (spectrum/source/EQ-pane layout collapse); deleted with the feature. |
| `docs/adr/0136-per-tick-track-node-caching-keys-on-shell-root-identity-plus-boardshapeversion-never-boardshapeversion-alone.md` | 57 | keep | Historical ADR aside noting single-column is unrelated to the cache being discussed; no coupling to the live mechanism, nothing to change. |

### `applySingleColumnSync`

| File | Lines | Disposition | Reason |
|---|---|---|---|
| `app/renderer/src/App.tsx` | 232 | delete | Comment noting inline-app.js still needs applySingleColumnSync; goes with the function. |
| `app/renderer/src/inline-app.js` | 186, 204, 491, 516 | delete | Comments and call sites wiring applySingleColumnSync into the settings-store subscription and boot sequence; deleted with the function. |
| `app/renderer/src/mode-switch.test.ts` | 10, 184, 191, 202 | delete | applySingleColumnSync's own test suite; deleted with the function. |
| `app/renderer/src/mode-switch.ts` | 120, 200 | delete | The applySingleColumnSync function definition and its call site; deleted with the single-column feature. |
| `app/renderer/src/single-column-gate.test.ts` | 14, 43, 44, 48, 49 | delete | Assertions pinning applySingleColumnSync's wiring into inline-app.js; deleted with the single-column feature. |

