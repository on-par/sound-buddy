# Spike: make live monitoring clearly lead to a Report Card (#479)

## Current flow & confusion points

Patrick's reported confusion is real — the code confirms it at three moments in
the Live tab flow:

1. **Before start.** The Live tab (`app/renderer/src/root-markup.html:100-176`)
   shows a device picker, monitor/record toggle, sliders, Preflight, and a
   `Start Capture` button (`root-markup.html:176`). Nothing on the panel says a
   monitoring session produces a Report Card.

2. **During.** `#live-status` reads `Monitoring · meters 10/s`
   (`inline-app.js:1905-1906`) — that's machinery, not outcome. Meanwhile every
   window tick calls `syncLiveSource()` (`inline-app.js:2372-2375`,
   `2509-2527`), which writes `liveSource` into `analysisStore`, and
   `ReportCardIsland.tsx` (via `getReportCardSource()`, `inline-app.js:2517`)
   renders a real live Report Card titled `Live capture — Main (window #N)` —
   but only on the **Report Card tab**, which the user has no reason to visit
   mid-capture. The only outcome-ish cue is `#ai-countdown` ("Next AI analysis
   in Ns", `inline-app.js:2337-2354`), and that only appears when AI (a Pro
   feature) is enabled.

3. **After stop (monitor mode).** `stopLive()` (`inline-app.js:1913-1944`)
   hides the status/indicator and retitles the spectrum "Stopped". Record mode
   gets a completion affordance: the `#rec-offer` row "Session saved *name*.
   [Open folder]" (`root-markup.html:178-181`, `inline-app.js:1929-1943`).
   **Monitor mode gets nothing.** The frozen live card is still viewable on the
   Report Card tab (`liveWindows` is not cleared on stop unless a new run
   starts or history/live-tab-reentry clears it — see `inline-app.js:2653`,
   `3041`), but it is never announced, never persisted
   (`persistAnalysisSummary`, `inline-app.js:2563-2585`, runs on file-based
   analyses but not for live-capture cards), and is silently lost on quit or
   when a file/history load clears `liveSource`.

Net effect: a user who runs Monitor mode start-to-finish never sees anything
that says "this produced a Report Card" — before, during, or after.

## Recommendation

Reuse the existing `#rec-offer` completion-offer pattern — it's exactly this
affordance, already built for record mode. The smallest slice is two tiny
cues, one story:

- **Pre-start cue.** One static muted line under `Start Capture`, next to
  `#live-status` (`root-markup.html:178`), visible only while idle:

  > "Capture builds a live Report Card as it runs."

  Hidden while running — the status line takes over once a capture starts.

- **Stop transition.** In `stopLive()`, when `liveMode === 'monitor'` and at
  least one window tick arrived (`liveWindows.length > 0`), show the same
  offer-row pattern:

  > "Report card ready." — **[View report card]**

  The button action is the exact navigation `loadHistoryEntry` and friends
  already use: `document.querySelector('.mode-tab[data-mode="reportcard"]').click()`
  (precedent at `inline-app.js:1562`, `2382`, `2425`, `2434`, `2654`). Either
  reuse `#rec-offer` with swapped text/action, or add a sibling `#rc-offer` row
  using the same CSS classes.

Deliberately **out of this slice** (carried into the follow-up issue as
non-goals): persisting live cards to Recent Services, changing the in-session
status copy, and any auto-tab-switch on stop — record mode's offer
deliberately doesn't auto-navigate, so the new monitor-mode offer should match
that.

## Follow-up story

Filed as a GitHub issue in this repo (title, body, and `Refs #479` below) —
see link at the bottom of this brief.

> ### Summary
> The Live tab never tells a user that a monitoring session produces a Report
> Card — not before starting, not while running, and not after stopping. Add
> two small cues that close the loop, reusing the `#rec-offer` completion-offer
> pattern already built for record mode.
>
> ### The two cues
> 1. **Pre-start cue** — a static muted line under `Start Capture`, next to
>    `#live-status` (`root-markup.html:178`), reading "Capture builds a live
>    Report Card as it runs." Visible only while idle; hidden once a capture is
>    running.
> 2. **Stop offer** — when a monitor-mode capture stops and at least one window
>    tick arrived, show an offer row: "Report card ready." with a "View report
>    card" button that navigates to the Report Card tab
>    (`document.querySelector('.mode-tab[data-mode="reportcard"]').click()`,
>    matching the precedent at `inline-app.js:2654`). Reuse `#rec-offer` or add
>    a sibling `#rc-offer` row with the same CSS classes.
>
> ### Acceptance criteria (Gherkin)
> - *Given* the Live tab is idle in monitor mode, *when* the user views the
>   capture controls, *then* a visible line states the session builds a Report
>   Card, *and* it is hidden while a capture is running.
> - *Given* a monitor-mode capture received at least one window tick, *when*
>   the user stops the capture, *then* a "Report card ready." offer with a
>   "View report card" action appears, *and* activating it lands the user on
>   the Report Card tab showing the live capture card.
> - *Given* a monitor-mode capture stopped before any window tick (or record
>   mode was used), *then* the report-card offer does not appear (record mode
>   keeps its existing session-saved offer).
>
> ### Out of scope
> - Persisting live-capture cards to Recent Services / history.
> - Changing the in-session status copy (`#live-status`).
> - Auto-tab-switch on stop — the offer button is the only navigation, matching
>   record mode's existing behavior.
> - Any analytics/telemetry — the app is fully local by design.
>
> Refs #479

## Signals

Sound Buddy is fully local with no telemetry — a core design decision — so the
success signal for the follow-up isn't analytics, it's tests:

- Unit tests on the offer-visibility logic, kept as a pure, testable function
  (`mode === 'monitor' && windows > 0`) per the "extract pure functions"
  architecture rule.
- Assertions added to the existing e2e specs covering the Live tab.
- Success criterion: the acceptance tests above pass, and the pre-start cue is
  visible without scrolling at the app's default window size.

## Follow-up

Follow-up: #488
