# Analyze's results rail is an analyzeStage-owned second column, with its own arc-* id namespace

- Status: Accepted
- Date: 2026-09-24

## Context

Report Card shipped as a peer destination — its own workspace mode (`reportcard` /
`body.rc-active`), its own tab, its own always-mounted `ReportCardIsland` portaled onto
`#report-card`. Product direction (#1487) is one Analyze home: the live EQ workspace plus the
folded results of analysis (grade, recording-type pills, handoff note, recommendations) surfaced
directly in Analyze chrome, so a result never requires bouncing to the separate Report Card tab.

Two structural constraints shaped the slice:

`analyzeEntryStore.listening` (#1469, lc-06) is deliberately narrow — "is the room mic actively
streaming" — and `analyzeLiveEqView`/`AnalyzeLiveEqPanel` gate the whole Analyze stage on it. That
flag goes false the moment a listen stops, including the "Load file…" handoff `chooseFile()` always
performs first (#1485). Gating the results rail on `listening` too would make a freshly-loaded
file's result flash into existence and then vanish the instant the picker closed the listen down —
exactly the defect #1487 reports for the current Report-Card-tab handoff, just relocated.

`ReportCardIsland` is portaled and mounted at all times, even while `#reportcard-view` is hidden by
`body.analyze-listening` (ADR-0143) — it just isn't visible. A folded rail that reused any `rc-*`
element id (`#rc-ring`, `#rc-rec-type`, `#rc-note-input`, …) would create a second element with the
same `id` in the live DOM, which is invalid HTML and would break `ReportCardIsland`'s own e2e
selectors (`document.getElementById` returns the first match; a second one is silently unreachable
and undebuggable from the selector alone).

ADR-0143 also states directly: *"New chrome added to the Analyze live-listening screen belongs
inside `#analyze-live-island`, subordinate to the EQ card. Anything that would re-introduce a
competing full-height column beside it needs a new issue and an update to this ADR"* — and separately
flags the "fold, never shrink" rule as foreclosing "a future split-view Analyze layout without
revisiting this ADR." #1487 is that issue; this ADR is that update.

## Decision

**`analyzeEntryStore` gains `analyzeStage`**, a strictly broader flag than `listening`: set to
`true` by `enterAnalyze()` (both the dialog and listen-live forks), cleared only by a new
`exitAnalyze()`, which `mode-switch.ts`'s `switchMode()` calls on every real switch (the Analyze tab
itself never reaches `switchMode()` — `resolveModeSwitch`'s `analyzeEntry` branch short-circuits
first — so every `switchMode()` call is a navigation away from Analyze). `analyzeStage` survives a
`listening → stopListening() → chooseFile()` handoff; `listening` keeps its exact prior meaning and
is untouched by `exitAnalyze()`, so today's tab-switch behavior around an in-progress listen is
unchanged.

**`analyzeLiveEqView`'s visibility gate widens** from `listening` to `listening || analyzeStage`
(still `&& appMode !== 'live'`, AC2 unchanged). The room curve itself still requires `listening` —
`analyzeStage` alone can only ever reach an idle `'notice'`, never `'room'` — so a stage-only visit
never renders a stale room reading.

**The Analyze stage becomes two columns.** `AnalyzeLiveEqPanel.tsx` wraps its existing
`.analyze-live-eq` output and a new `AnalyzeResultsPanel` leaf in a `.analyze-stage` flex row:
the EQ keeps `flex:1` (unchanged, still the dominant column per ADR-0143's "fold, never shrink"
spirit for the *stage* around it), the rail is a fixed `320px` with its own scroll. `AnalyzeResultsPanel`
is a plain nested component, not a second portal — mirroring how `ReportCard.tsx` nests inside
`ReportCardIsland.tsx` rather than getting its own mount point.

**The rail reuses grading verbatim, under a disjoint id namespace.** A new pure `analyze-results.ts`
resolves the same `currentAnalysis`-then-`liveSource` priority as `getReportCardSource` (imported,
not re-derived) and folds the injected grading API's `computeGrade`/`computeScore`/
`analyzeRecordingType`/`computeRecommendations`/`getGradingProfile` — no forked grading math (AC2).
`AnalyzeResultsPanel.tsx` renders that fold with `gradeRingHTML`/`recTypePillHTML`/`recListHTML`/
`commitReportCardNote` verbatim, but every element id is `arc-*` (`#arc-ring`, `#arc-rec-type`,
`#arc-note-input`, `#arc-recommendations`) — never `rc-*` — so it can never collide with the
always-mounted `ReportCardIsland`.

**History/Recent stays on the existing Report Card island.** `loadHistoryEntry` writes
`historySummary` onto `analysisStore` and calls `switchMode('reportcard')` — a real workspace-mode
switch, which now also fires `exitAnalyze()`. The results rail only ever reads
`currentAnalysis`/`liveSource`, never `historySummary`, so a History visit renders on the classic
Report Card tab exactly as it does today; AC4 explicitly allows this, and duplicating the frozen
history-card render path into a second `arc-*` variant would be exactly the "second grading UI" AC2
forbids.

## Consequences

Positive: a result now survives the file-load handoff that used to strand it back on a separate tab.
No new grading math, no new portal, no id collisions — `analyzeStage` is one boolean and
`exitAnalyze()` is one `set()` call. The `arc-*`/`rc-*` split gives every future contributor a
mechanical rule ("Analyze-rail element → `arc-*`, Report Card island element → `rc-*`") instead of a
prose warning.

Negative: two independent note-draft `useState` trees now exist for the same `lastSavedSummaryFile`
— an edit typed into the Analyze rail's handoff-note field and an edit typed into the (hidden)
Report Card tab's field do not share draft state, only the committed value once either blurs. This
is judged acceptable because `body.analyze-listening`/`analyzeStage` keeps `#reportcard-view` hidden
for the entire time the rail is visible (ADR-0143), so a user cannot see or type into both at once in
the same session. `analyzeLiveEqView`'s three-kind view (`hidden`/`notice`/`room`) now has two
distinct paths into `'notice'` (a real device-status problem while listening, vs. an idle stage with
nothing streaming) — acceptable because both render through the same generic `.eq-pane-empty-hint`
copy slot, just different text.

## References

- [Issue #1487 — Fold Report Card results into Analyze chrome](https://github.com/on-par/sound-buddy/issues/1487)
- [ADR-0141 — Analyze's live-listening room-mic EQ is its own centre island, never a re-parented docked pane](./0141-analyzes-live-listening-room-mic-eq-is-its-own-centre-island-never-a-re-parented-docked-pane.md)
- [ADR-0143 — body.analyze-listening is a full-stage workspace mode](./0143-body-analyze-listening-is-a-full-stage-workspace-mode-the-live-eq-owns-the-stage-and-secondary-panels-fold-rather-than-shrink.md)
