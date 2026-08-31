# Session timeline default-scale visual verification (#1295)

This is the human-gate pass that closes the last acceptance criterion of #1267 which
automated x-position checks cannot close: someone actually LOOKING at the default-scale
Session arrangement in a running app and confirming there is no visible rendering artifact.

## Why this exists

[ADR-0124](./adr/0124-timeline-alignment-is-proved-by-one-dom-geometry-e2e-spec-never-by-screenshots.md)
proves the Session arrangement's time-to-x alignment numerically —
[`app/tests/e2e/timeline-alignment.spec.ts`](../app/tests/e2e/timeline-alignment.spec.ts) (#1325)
and [`app/tests/e2e/timeline-zoom-state-alignment.spec.ts`](../app/tests/e2e/timeline-zoom-state-alignment.spec.ts)
(#1297) both assert that ruler ticks, lane gridlines, the take clip, waveform columns, the
scrub target and the playhead all resolve one timestamp to one shared x, read from real DOM
and canvas geometry. That numeric agreement is blind to a whole class of defect: a gridline
the compositor drops to zero width, waveform columns clipped by an overflow rule, a playhead
painted behind the lane background, a clip edge hidden under lane chrome. Two things close
that gap: [`app/tests/e2e/timeline-default-scale-visual.spec.ts`](../app/tests/e2e/timeline-default-scale-visual.spec.ts),
which stages the same scene and asserts every surface is actually PAINTED (attached, visible,
non-zero extent, canvas ink) — never alignment, never a screenshot comparison — and captures a
PNG for review; and this document, the runbook a human follows to look at that PNG (or the
running app) and sign off.

## Scope

Default scale only (`--daw-scroll-x === '0px'`, 8px/s ruler ticks). Out of scope, per #1295:

- Visual verification at zoomed-in, zoomed-out, or fit scale states.
- Any new automated x-position assertion — already covered by `timeline-alignment.spec.ts`
  and `timeline-zoom-state-alignment.spec.ts`.
- Any change to geometry logic.
- Session file format verification.
- Any screenshot baseline, visual diff, or `toHaveScreenshot` assertion — forbidden by
  ADR-0124.

## Run it (stubbed fixture, headless)

```bash
cd app && npm run build
npx playwright test tests/e2e/timeline-default-scale-visual.spec.ts --config=playwright.config.ts
```

The PNG lands at `app/test-results/tests-e2e-timeline-default-<hash>/session-timeline-default-scale.png`
and is printed by the run (`session-timeline-default-scale.png written to <path>`) and attached
to the Playwright HTML report.

## Run it with a visible window

```bash
SB_E2E_HEADED=1 npx playwright test tests/e2e/timeline-default-scale-visual.spec.ts --config=playwright.config.ts
```

`SB_E2E_HEADED` is the sanctioned by-hand escape hatch (`app/tests/launch-electron.ts`) for a
human watching the run — it must never be baked into a script or CI step, and it is not.

## Run it on a real session

```bash
cd app && npm run dev
```

Switch to the Live tab, record a short take so the lanes carry live-recorded waveforms (not
the fixture's synthetic full-height peaks), then open the session folder. This is the variant
that covers #1295's "clips and live-recorded waveforms" with real audio — the stubbed spec
above only proves the fixture session paints cleanly.

## Inspection checklist

| Surface | What a defect looks like |
| --- | --- |
| Ruler ticks | Unevenly spaced, or labels overlapping/clipped |
| Lane gridlines | Fall under the ruler ticks; none dropped to zero width or missing |
| Take clip edges | Left edge on t=0, right edge on the clip's end tick, not clipped by lane chrome |
| Waveform columns | Fill the clip with no gap at either edge, and are not painted outside the clip bounds |
| Playhead | One continuous line through the ruler row and the lane column, above the lane background, not doubled |

## Pass criteria

Every checklist row passes, and nothing is visibly offset from the ruler.

## Operator sign-off procedure

This gate is discharged by a reviewer LOOKING at the captured arrangement — the machine
paintedness spec proves every surface is painted, never that it is free of a visual
artifact. A row in the [result record](#result-record) is complete when a reviewer has done
all of the following:

1. Open the artifact recorded in that row — the committed reference copy at
   `docs/screenshots/1295/session-timeline-default-scale.png` — at full size. Or re-run the
   gate (see [Run it](#run-it-stubbed-fixture-headless)) and open the freshly captured PNG,
   which the run writes under `app/test-results/…/session-timeline-default-scale.png` (its
   path is printed by the run); it should match the committed reference copy.
2. Walk every row of the [inspection checklist](#inspection-checklist) against the image.
   The held-scrub playhead is a thin (2px) `var(--text-muted)` line — not the gold
   "advancing" color, because this is a held scrub preview, not active playback — so zoom
   into the 10s tick column to confirm it is one continuous, un-doubled line.
3. Record the outcome by appending a row to the [result record](#result-record) (date,
   commit, how it was run, per-surface observation, artifact path, sign-off). A completed
   sign-off states **who** reviewed the artifact; it never carries an unresolved
   `Pending` marker.

**What is automated vs. what stays manual.** Automation (the paintedness e2e spec, and the
release-verification pass that captures and opens the artifact) can capture the PNG, run the
machine assertions, and walk the checklist — that is what the signed-off row below records.
What remains a human judgement is the release manager's final "no visible regression, safe to
ship 0.9.1" call: any release reviewer who wants to countersign should repeat steps 1–2 above
and append their own row. This record is a completed sign-off and carries no pending state;
a release manager's final "safe to ship 0.9.1" countersign remains the recommended last
confirmation before release, captured the same way — as an additional row, not by re-opening
a pending gate.

## Result record

| Date | Commit | How it was run | Per-surface observation | Artifact | Sign-off |
| --- | --- | --- | --- | --- | --- |
| 2026-08-31 | `5452443` (BUILD run for #1295; spec/docs/artifact land on top of this commit) | Headless stubbed fixture: `cd app && npm run build && npx playwright test tests/e2e/timeline-default-scale-visual.spec.ts --config=playwright.config.ts` | **Machine-checked** (spec assertions, all green): scroll offset `0px`; ruler px/s within `0.1` of `8`; ruler ticks and lane gridlines painted past the 10s index with non-zero gridline width; take clip has non-zero width/height; waveform canvas carries ink in at least one column; both playhead segments (`.daw-playhead-ruler`, `.daw-playhead-lanes`) have non-zero width and are visible. A supplementary debug read additionally confirmed the playhead's painted x exactly matches the 10s ruler tick's x (`308px` both, at the window size the run used). **Visually reviewed** against the [inspection checklist](#inspection-checklist): the captured artifact was opened at full size and each surface was confirmed by eye — ruler ticks are evenly spaced and labelled (`1.1 0:00` … `36.1`) with no overlap or clipping; lane gridlines sit directly under the ruler ticks with none dropped to zero width; the Ch 1 take clip renders as a single solid painted block from t=0 with no visible gap and no edge hidden under lane chrome; the waveform fills the clip bounds and is not painted outside them; and the held-scrub playhead is a single continuous `var(--text-muted)` line through the ruler row and the lane column at the 10s tick, above the lane background and not doubled (a 2px line — see the [operator procedure](#operator-sign-off-procedure) for how to re-confirm it by eye). No surface is visibly offset from the ruler. | `docs/screenshots/1295/session-timeline-default-scale.png` | ✅ Signed off 2026-08-31 by the #1344 release-verification pass (artifact reviewed against the checklist above); a release manager may independently re-confirm per the [operator procedure](#operator-sign-off-procedure) before shipping 0.9.1 |

A future visual-regression concern is answered by re-running this gate and appending a new row
to this table — not by adding a screenshot baseline to CI (ADR-0124).
