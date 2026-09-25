# 'analyze' is a landed appMode, and Simple-mode Report Card requests redirect to the Analyze stage inside switchMode

- Status: Accepted
- Date: 2026-09-24

## Context

#1505 moved Report Card results into Analyze chrome and #1512 hid the Report Card tab in
Simple mode, but boot (liveCaptureStore's initial appMode), boot restore (clampBootMode's
fallback) and five programmatic `switchMode('reportcard')` call sites could still land a Simple
user on a tab-less Report Card workspace (`body.rc-active` + `#reportcard-view.active`, no tab
selected). Until now `appMode` only ever held a `WorkspaceMode`; clicking the Analyze tab never
changed it (ADR-0145: every `switchMode()` call leaves Analyze). The redirect had to happen
before settings load (App.tsx's synchronous first paint runs with `isSimpleMode(null) === false`),
never auto-start room-mic capture, and not require editing every call site (the hidden tab's own
programmatic click, `RecentServicesPanel`, `BuildGuidePanel`, `LiveSessionOffers`, the onboarding
demo).

`enterAnalyze()` was considered and rejected as the redirect target: it starts a room-mic listen
when a secondary device is configured, or opens the entry dialog — a cold boot or a history/menu
file load must never auto-start audio capture or pop a modal. Widening `WorkspaceMode` to include
`'analyze'` was also rejected: `switchMode()` unconditionally calls `exitAnalyze()`, and
`resolveModeSwitch` already routes the Analyze tab to `analyzeEntry` — widening `WorkspaceMode`
would break both invariants and every exhaustive `WORKSPACE_MODES` consumer.

## Decision

`appMode` may hold `'analyze'`, meaning the Analyze stage is the screen the app landed on. It is
not a `WorkspaceMode`. `mode-switch.ts`'s `showAnalyzeStage()` is the only function that sets it:
it clears the workspace-mode body classes (`rc-active`, `live-active`, `#reportcard-view.active`,
every `.tab-content.active`), opens the stage through `analyzeEntryStore.showStage()`
(`analyzeStage` only, never `listening` or the entry dialog) and re-syncs single-column.

`liveCaptureStore`'s initial `appMode` is `'analyze'`. `clampBootMode`'s fallback is `'analyze'`
for any mode outside `visibleTabModes(settings)` — including `'reportcard'` itself in Simple mode,
and any unrecognized mode in Advanced mode too, since AC3 requires the initial value to always be
Analyze. `switchMode('reportcard')` redirects to `showAnalyzeStage()` whenever `isSimpleMode(settings)`
holds, as the very first statement, so every existing and future caller is covered without edits at
each call site. Advanced mode and a still-loading settings store (`settings === null`) keep the old
Report Card behavior. `restoreBootMode` gets a matching `'analyze'` branch ahead of its
workspace-mode one. App.tsx's boot paint calls a new `applyInitialMode(mode)`, which dispatches
`'analyze'` to `showAnalyzeStage({ boot: true })` and any `WorkspaceMode` to `switchMode(mode, { boot: true })`
— the old `if (isWorkspaceMode(initialMode)) switchMode(...)` guard would have silently no-op'd on
the new `'analyze'` initial value. The Analyze tab's own click still goes through `enterAnalyze()`
and does not change `appMode`.

## Consequences

Every Simple-mode route to results ends on the Analyze stage, including routes added later,
because the redirect lives in the one choke point (`switchMode`). Cost: `appMode` is no longer
always a `WorkspaceMode`, so code that compares `appMode` to a mode must not assume otherwise.
Cold boot with no saved mode now lands on Analyze in Advanced mode too, which overrides epic
#1419's report-first default — flagged as a note-only conflict for a human to reconcile, not
addressed by this change. `analyzeStage` now has a second setter, `showStage()`, next to
`enterAnalyze()`. Any new code path that lands on Analyze without a user click must use
`showAnalyzeStage()`, not `enterAnalyze()`, so it never starts audio capture on its own.

Toggling Advanced → Simple while Report Card is already active is not redirected by this change —
no `switchMode()` call happens on a settings toggle, so a tab-less Report Card can persist until
the next navigation. Left as a follow-up (candidate: hook `installSimpleModeBodyClassSync`).

## References

- [Issue #1510](https://github.com/on-par/sound-buddy/issues/1510)
- [ADR-0145 — Analyze's results rail is an analyzeStage-owned second column](./0145-analyzes-results-rail-is-an-analyzestage-owned-second-column-with-its-own-arc-id-namespace.md)
