# e610 Trustworthy live coaching during soundcheck and service: completion record

Issue #610 is a tracking epic, not a feature. Its deliverable is a soundcheck-safe live coaching
loop: observe live analysis windows, select at most one high-confidence suggestion, keep that
suggestion stable (persistence, cooldown, and contradiction suppression), let the engineer
acknowledge, dismiss, snooze, or mark a suggestion as tried, and report whether the measured
condition improved afterward — advisory only, never touching the console. Every acceptance
criterion is already satisfied by the four in-scope vertical slices (#611–#614) plus the post-ship
#746 grading-profile desync fix, all of which shipped as squash-merged PRs and are closed
`COMPLETED` on GitHub, with their squash-merge commits in this tree's history. Per binding
ADR-0018, an epic whose criteria are met by accumulated work is closed by a repo-homed completion
record that asserts every criterion from the checkout and maps each story to its PR and feature
files — there is no residual feature code to build. This record is that closing evidence.

## Shipped stories

Titles are the actual GitHub issue titles, read verbatim from `gh issue view`. State is as of
2026-08-14, read from `gh issue view`. Closing PR hashes are the squash-merge commits reproduced
from this checkout's history by the git command in the Verification section. Note that #615/#616
were the *PR* numbers for the story issues #611/#612 — the record cites the issue number as the
Story and the PR number in the Merged-PR column.

| Story | Actual GitHub title | Merged PR | Feature files in this tree |
|-------|--------------------|-----------|---------------------------|
| #611 | feat: Rank live candidates and show one high-confidence coaching card | [#615](https://github.com/on-par/sound-buddy/pull/615) (`77a4946`) | `app/renderer/live-adjustments-state.js` (`clipCandidates`, `rankCandidates`, `CATEGORY_PRIORITY`, `selectCoachingCandidate`, `coachingCardHTML`, `MIN_CONFIDENCE`), `app/renderer/src/inline-app.js` (one-card `panelHTML` wiring), `app/renderer/src/live-adjustments-gate.test.ts`, `.lap-card*` styles |
| #612 | feat: Stabilize live coaching with persistence and cooldown rules | [#616](https://github.com/on-par/sound-buddy/pull/616) (`95bb2e0`) | `live-adjustments-state.js` (`createCoachingState`, `advanceCoaching`, `allCoachingCandidates`, `PERSISTENCE_WINDOWS`, `RETAIN_CONFIDENCE`, `RECOVERY_WINDOWS`, `REPLACEMENT_MARGIN`, `MIN_ACTIVE_HOLD_MS`, `COOLDOWN_MS`, `OPPOSITE_IDS`), `inline-app.js` (per-window-tick `advanceCoaching`), gate tests |
| #613 | feat: Add live coaching acknowledge, snooze, dismiss, and tried actions | [#617](https://github.com/on-par/sound-buddy/pull/617) (`17e351b`) | `live-adjustments-state.js` (`acknowledgeCoaching`, `snoozeCoaching`, `resumeCoaching`, `dismissCoaching`, `markTriedCoaching`, `coachingView`, `SNOOZE_MS`, `DISMISS_ESCALATION_DB`, `SNOOZE_BYPASS_CATEGORIES`), `inline-app.js` (`data-lap-action` routing), `.lap-card-actions`/`.lap-action`/`.lap-card-cue`/`.lap-card-observing`/`.lap-card-snoozed` + `prefers-reduced-motion` styles |
| #614 | feat: Evaluate whether a tried live suggestion improved the measured condition | [#618](https://github.com/on-par/sound-buddy/pull/618) (`867d0e5`) | `live-adjustments-state.js` (`observationContext`, `observeWindow`, `evaluateOutcome`, `acknowledgeOutcome`, `outcomeCardHTML`, `OBSERVATION_WINDOW_MS`, `MEANINGFUL_CHANGE_DB`, `MIN_OBSERVATION_SAMPLES`, `RESOLVED_SEVERITY_DB`), `inline-app.js` (`lapObservationContext` per tick, `outcome-ack` routing), `.lap-card-outcome`/`.lap-outcome-detail`/`.lap-outcome-metric` styles |
| #746 | Broadcast grading profile silently desyncs live coaching from the report card: live-adjustments-state.js forks grading.js's thresholds | [#749](https://github.com/on-par/sound-buddy/pull/749) (`c099572`) | `live-adjustments-state.js` (`hotDiffDb`/`quietDiffDb`/`clipRiskPeakDbfs` read `window.grading.CONFIG` per call), `app/renderer/live-adjustments-state.test.ts` (broadcast-vs-casual fixture test) |

**Foundation note (not a shipped story of this epic).** The "experimental live adjustments enabled"
precondition of AC1 comes from epic #515 (CLOSED/COMPLETED, "Epic: Experimental DAW-style live
monitoring and recording workspace"): #522 (PR #534, `c25bcde`: `liveAdjustmentsEnabled` default-off
setting + `#live-adjustments-toggle`), #523 (PR #535, `7981793`: `mixCandidates`), #525 (PR #537,
`5aa744f`: `inputCandidates`/`focusHTML`). The coaching surface described here builds directly on
that already-shipped experimental recommendation surface.

## Acceptance-criteria checklist

Each epic criterion is asserted from this checkout with its evidence. The five criteria are the
epic's acceptance criteria, quoted from the #610 issue body.

- [x] **When experimental live adjustments are enabled and multiple live conditions are detected,
      evaluating the current monitoring window shows at most one active coaching suggestion
      representing the highest-priority supported condition, instead of a recommendation stream.** →
      `rankCandidates` (`live-adjustments-state.js`) sorts by a fully deterministic comparator —
      category (`CATEGORY_PRIORITY = { clipping: 2, tonal: 1 }`), then confidence, then severity,
      then scope, then id — and `selectCoachingCandidate` returns the single top candidate that
      clears the `MIN_CONFIDENCE` gate. `advanceCoaching` holds exactly one `active`; `panelHTML`
      renders exactly one card via `coachingCardHTML`. Tests: `'returns the single top-ranked
      candidate when several clear the gate (AC scenario 1)'`, `'orders clipping before tonal even
      when the tonal candidate has higher confidence (AC scenario 2)'`, and `'renders exactly one
      .lap-card in every state'` (`app/renderer/live-adjustments-state.test.ts`). The gate test
      locks the wiring: `advanceCoaching` + `allCoachingCandidates` called once per window tick, the
      single card passed to `panelHTML` (`app/renderer/src/live-adjustments-gate.test.ts`). Honest
      note under Discrepancies: the pre-#615 overall-mix and focused-input candidate lists still
      render beneath the card, labeled "suggestions to consider, not instructions".
- [x] **When no candidate meets the configured confidence and persistence thresholds, no actionable
      coaching suggestion is shown (non-actionable monitoring status may still be shown).** →
      `selectCoachingCandidate` returns `null` below `MIN_CONFIDENCE`; `advanceCoaching` promotes a
      candidate only after `PERSISTENCE_WINDOWS` consecutive windows; `coachingCardHTML(null)`
      renders the `lap-card-monitoring` "not enough evidence to advise yet" card. Tests:
      `'returns null when every candidate is below MIN_CONFIDENCE (AC scenario 3)'`, `'ignores a
      transient condition — one qualifying window then nothing does not activate'`, and `'activates
      a persistent condition after exactly PERSISTENCE_WINDOWS consecutive windows'`.
- [x] **When a live coaching suggestion is active and subsequent analysis windows fluctuate within
      the allowed tolerance, the suggestion remains stable and is not immediately replaced by a
      contradictory suggestion.** → `advanceCoaching` retention (`RETAIN_CONFIDENCE`,
      `RECOVERY_WINDOWS`), replacement margin + hold (`REPLACEMENT_MARGIN`, `MIN_ACTIVE_HOLD_MS`,
      higher-priority-category bypass), and cooldown + opposite suppression (`COOLDOWN_MS`,
      `OPPOSITE_IDS`). Tests: `'retains the active card through minor fluctuation, tracking the
      newest confidence'`, `'does not replace the active card when a challenger stays below the
      replacement margin'`, `'the hold window blocks an early over-margin replacement; a
      higher-priority category bypasses it'`, and `'suppresses immediate contradictory advice during
      cooldown, then activates once cooldown expires'`.
- [x] **When the engineer marks a suggestion as tried and enough post-action analysis data is
      available, Sound Buddy reports whether the measured condition improved, worsened, or remained
      inconclusive, preserving the engineer as the final decision-maker.** → `markTriedCoaching`
      captures the before-state and opens an `OBSERVATION_WINDOW_MS` window on the same metric,
      source, and scope; `observeWindow` samples the condition once per analysis window (invalidated
      on source/focus changes and, for tonal readings, while clipping); `evaluateOutcome` scores
      improved/worsened/unchanged/inconclusive (with `insufficient-data` and `source-changed`
      reasons); `outcomeCardHTML` renders one outcome card whose copy refuses causation ("it can't
      prove your change caused it", "Sound Buddy measures; it does not prove cause") and never
      touches the console ("Advisory only — Sound Buddy never changes your console");
      `acknowledgeOutcome` returns to monitoring with the evaluated condition (and its opposite, if
      any) in cooldown. Tests: the `observationContext`/`observeWindow`/`evaluateOutcome`/
      `acknowledgeOutcome`/`coachingView` describes in `live-adjustments-state.test.ts`, plus the
      gate tests asserting the per-tick `lapObservationContext` flow, the `outcome-ack` routing, and
      `markTriedCoaching(lapCoaching, lapNow, lapObservationContext())`.
- [x] **Initial thresholds, timing windows, and presentation are tunable (to be refined through
      pilot evidence).** → every threshold and window is a named module-level constant in
      `live-adjustments-state.js` (`MIN_WINDOWS`, `MIN_CONFIDENCE`, `HIGH_CONFIDENCE`,
      `CONFIDENCE_BASE`, `PERSISTENCE_WINDOWS`, `RETAIN_CONFIDENCE`, `RECOVERY_WINDOWS`,
      `REPLACEMENT_MARGIN`, `MIN_ACTIVE_HOLD_MS`, `COOLDOWN_MS`, `SNOOZE_MS`,
      `DISMISS_ESCALATION_DB`, `OBSERVATION_WINDOW_MS`, `MEANINGFUL_CHANGE_DB`,
      `MIN_OBSERVATION_SAMPLES`, `RESOLVED_SEVERITY_DB`, `SNOOZE_BYPASS_CATEGORIES`), and the three
      detection thresholds (`hotDiffDb`/`quietDiffDb`/`clipRiskPeakDbfs`) read `window.grading.CONFIG`
      live on every call (#746) so they track grading.js's tuning. Honest note under Discrepancies:
      this is code-level tunability between pilots, not a Settings UI.

## Governing-condition evidence

The epic's Verification lines, asserted from this checkout:

- **"Deterministic fixtures and simulated live windows verify ranking, confidence thresholds,
  cooldowns, and before/after outcomes."** → `app/renderer/live-adjustments-state.test.ts` is
  fixture-driven — hot-bass/harsh/vocal/clipping/focused-input windows, transient-then-quiet
  sequences, broadcast-vs-casual grading, post-tried sample sequences — and names the three AC
  scenarios ("AC scenario 1/2/3").
- **"Each child story delivers one end-to-end user outcome with observable behavior (prioritization,
  stability, presentation, and outcome slices)."** → #611 (one ranked coaching card), #612
  (stability state machine), #613 (disposition actions), #614 (before/after outcome loop).
- **"All new code follows repo standards: test-first (red/green), colocated unit tests, and coverage
  must not regress."** → every story shipped its colocated `live-adjustments-state.test.ts` and the
  wiring gate `live-adjustments-gate.test.ts`, and passed the verify gate (coverage ratchet green on
  each PR).
- **"`npm run lint` and `npm test` (or the full `./scripts/verify.sh` gate) pass with all existing
  tests still green."** → `./scripts/verify.sh --fast` is green on this accumulated tree (see
  Verification).

## Discrepancies / evolution notes

Mirroring e455's and e471's honest-recording sections, the following are recorded rather than
papered over:

- **No transcript swap.** The epic's "Concrete vertical slices" list maps 1:1 in order to
  #611/#612/#613/#614, and each actual issue title matches its slice description. Note the epic's
  own issue numbers for the first two slices (#611/#612) were reused as the PR numbers (#615/#616);
  the record cites the issue number as the Story and the PR number in the Merged-PR column.
- **The candidate list below the card.** The pre-#615 overall-mix and focused-input candidate lists
  still render beneath the single coaching card, explicitly labeled "suggestions to consider, not
  instructions"; the single actionable coaching surface is the card.
- **"Tunable" is code-level, not a Settings UI.** AC5's "tunable (to be refined through pilot
  evidence)" is satisfied by named module-level constants plus the live `window.grading.CONFIG`
  reads (see the checklist); no user-facing tuning surface was added — one was not in the epic's
  in-scope list.
- **#746 is a post-ship fix.** Merged after the four in-scope slices, it keeps the coaching
  thresholds on the broadcast grading profile so the live card and the report card cannot judge the
  same signal by different numbers.
- **Foundation stories shipped under epic #515** (toggle #522, mix candidates #523, per-input
  candidates #525), not this epic. They supply the "experimental live adjustments enabled"
  precondition of AC1; the coaching loop built on them is this epic's deliverable.
- **Out-of-scope items did not ship.** No automatic console changes, OSC write access, or
  AI-generated free-form live instructions exist in the coaching path (the card copy states "Sound
  Buddy never changes your console"); the post-service report card is untouched.

## Verification

Run from this checkout (all green as of 2026-08-14):

- `git log --all --oneline | grep -E '\(#(615|616|617|618|749)\)'` — reproduces the five
  squash-merge commits with the exact short hashes cited above: `77a4946` (#615), `95bb2e0` (#616),
  `17e351b` (#617), `867d0e5` (#618), `c099572` (#749). The same grep also surfaces the pre-squash
  branch commits from earlier factory runs carrying the same numbers — expected, they are not the
  squash-merge commits the record cites. `git log --all --oneline | grep -E '\(#(534|535|537)\)'`
  reproduces the epic-#515 foundation commits `c25bcde` (#522), `7981793` (#523), `5aa744f` (#525).
- `git merge-base --is-ancestor 77a4946 HEAD && git merge-base --is-ancestor 95bb2e0 HEAD && git
  merge-base --is-ancestor 17e351b HEAD && git merge-base --is-ancestor 867d0e5 HEAD && git
  merge-base --is-ancestor c099572 HEAD` — each squash-merge commit reports ancestor-of-HEAD,
  proving all four story PRs plus the #746 fix are in this tree's history.
- `for i in 611 612 613 614 746; do gh issue view $i --json number,state,stateReason,title; done` —
  all five report `CLOSED` with `stateReason: COMPLETED`, with the exact titles in the table above.
- `gh issue view 610 --json state,title` — `OPEN` with title "Epic: Trustworthy live coaching
  during soundcheck and service" before this PR; the PR's `Closes #610` body line is what closes it.
- `gh issue view 515 --json state,stateReason,title` — `CLOSED` / `COMPLETED`, "Epic: Experimental
  DAW-style live monitoring and recording workspace" — the foundation epic the Foundation note cites.
- `./scripts/verify.sh --fast` — passes on the accumulated tree. The diff is doc-only, so compile,
  lint, tests, and the coverage ratchet are untouched.
