# 'analyze' is a landed appMode, and Simple-mode Report Card requests redirect to the Analyze stage inside switchMode

- Status: Accepted (amended 2026-09-27, #1576, #1587 and #1602 — see Amendments)
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
*(Amended by #1587/#1602: the teardown now lives in a private `landAnalyzeWorkspace()` helper
shared by `showAnalyzeStage()` and the Analyze tab's `enterAnalyzeFromTab()`; `showAnalyzeStage()`
is still the only **silent** setter.)*

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
and does not change `appMode`. *(Superseded for the tab click by the 2026-09-27 #1587 amendment below.)*

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

## Amendment (2026-09-27, #1576)

Dogfood of #1574 showed that cold Analyze home, the default landing screen since #1510, paints a
File-mode stage with no live RTA, even for users who have a room mic configured. This amendment
authorizes exactly one exception to the Context's rejection of `enterAnalyze()`-style auto-listen:

- **Permitted:** automatically starting the room-mic listen (the same listen-live path the Analyze
  tab's configured-device fork uses) **only when both** of these hold:
  1. hydration has settled (`restoreBootMode`'s post-`deps.hydration` step, never
     App.tsx's synchronous boot paint / `applyInitialMode`) **and** the app is still on the landed
     Analyze home (`appMode === 'analyze'`, unchanged since boot paint, which is the same
     `getCurrentMode() !== bootMode` guard #1507 added); and
  2. a secondary measurement device is configured (`secondaryMeasurement.deviceName !== ''`).
- The auto-start must never open `AnalyzeEntryDialog`. With no secondary device configured, cold
  Analyze home keeps today's non-modal File-mode stage and starts no mic capture at all.
- Full `enterAnalyze()` is still not the seam for this. Its no-device fork opens the entry dialog.
  The exception must call only the listen-start path, behind the two conditions above.

**Unchanged:** `showAnalyzeStage()` stays silent. It never starts a listen and never opens the
entry dialog. Every redirect that goes through it also stays silent: History (`loadHistoryEntry`),
Report Card (`switchMode('reportcard')`'s Simple-mode redirect, `openReportCard`), onboarding
(`runFirstAnalysis`), File > Open, and the boot paint itself. The Decision's closing rule still
binds everything outside this exception: any new path that lands on Analyze without a user click
uses `showAnalyzeStage()` and never starts audio capture by itself. Session's `LiveEqPane`
isolation (ADR-0141) is not affected.

- [Issue #1576](https://github.com/on-par/sound-buddy/issues/1576)
- [Issue #1574](https://github.com/on-par/sound-buddy/issues/1574)

## Amendment (2026-09-27, #1587)

Dogfood of #1575 showed that clicking the Analyze tab from Session leaves `appMode === 'live'`
and `body.live-active` set. `analyzeLiveEqView` hides the Analyze island whenever
`appMode === 'live'`, so the user lands on dead Session chrome, and "Listen live" from the entry
dialog appears to bounce to Settings or menu. The Decision's rule that the Analyze tab click
"does not change `appMode`" is the cause, and it is amended as follows:

- **Permitted:** a user-initiated Analyze tab entry (`resolveModeSwitch`'s `analyzeEntry`
  branch, from `ModeTabs.tsx`) may set `appMode` to `'analyze'` and leave the prior workspace:
  it clears the workspace-mode body classes (`rc-active`, `live-active`,
  `#reportcard-view.active`, every `.tab-content.active`) the same way `showAnalyzeStage()`
  does, and only then applies the existing `enterAnalyze()` entry rule (listen live with a
  configured secondary device, otherwise the entry dialog).
- **Session → Analyze is a real mode transition** (`appMode` `'live'` → `'analyze'`), not a
  stage overlay painted on top of `appMode: 'live'`. Returning to Session goes through
  `switchMode('live')` as before, which sets `appMode` back to `'live'`. `analyzeLiveEqView`'s
  `appMode === 'live'` hide gate is kept, so Session's docked `LiveEqPane` owns that screen again.
- The Analyze tab still never reaches `switchMode()`, and `WorkspaceMode` is still not widened
  to include `'analyze'`. The Context's rejection of that widening stands.

**Unchanged:** this permission applies only to the user's Analyze tab click, which may start a
listen or open the dialog because the user asked for Analyze. `showAnalyzeStage()` stays silent.
Every redirect that goes through it also stays silent and is unaffected by this amendment:
History (`loadHistoryEntry`), Report Card (`switchMode('reportcard')`'s Simple-mode redirect,
`openReportCard`), onboarding (`runFirstAnalysis`), File > Open and the boot paint. None of them
starts a listen or opens the entry dialog. The #1576 cold-boot auto-listen exception is also
unchanged. Session's `LiveEqPane` isolation (ADR-0141) still holds: nothing is re-parented.

- [Issue #1587](https://github.com/on-par/sound-buddy/issues/1587)
- [Issue #1575](https://github.com/on-par/sound-buddy/issues/1575)

### Implementation (#1595, recorded by #1602)

- `mode-switch.ts`'s private `landAnalyzeWorkspace()` is the single teardown for both Analyze
  landings: `setAppMode('analyze')`, persist `lastAppMode` (skipped on boot), remove
  `live-active`, `rc-active`, `#reportcard-view.active` and every `.tab-content.active`, then
  `applySpectrumForMode('analyze')` and re-sync single-column. `showAnalyzeStage()` and
  `enterAnalyzeFromTab()` both call it, so the two paths cannot drift.
- `enterAnalyzeFromTab()` (dispatched from `ModeTabs.tsx` on `resolveModeSwitch`'s
  `analyzeEntry` decision) runs the teardown **only when entering from a non-Analyze workspace**
  (`appMode !== 'analyze'`, e.g. Session), then applies the unchanged `enterAnalyze()` entry
  rule. Already on Analyze, the tab click is exactly `enterAnalyze()`: no re-teardown, no
  settings write.
- This does not apply to the silent redirects. History (`loadHistoryEntry`), Report Card
  (`switchMode('reportcard')`'s Simple-mode redirect, `openReportCard`), onboarding
  (`runFirstAnalysis`), File > Open and the boot paint still go through `showAnalyzeStage()`,
  which never starts a listen or opens the entry dialog. Their behavior is unchanged.
- Session's docked `LiveEqPane` isolation (ADR-0141) is unaffected: Analyze's live EQ stays its
  own `#analyze-live-island`, and nothing is re-parented or imported across the two.

- [Issue #1602](https://github.com/on-par/sound-buddy/issues/1602)
- [PR #1595](https://github.com/on-par/sound-buddy/pull/1595)
