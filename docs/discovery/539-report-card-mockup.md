# Spike: static mockup of score-circle Report Card + inline AI section (#539)

## What was mocked and why

The UI/UX audit (`soundbuddy-ui-ux-audit.md`, 2026-07-19) recommends two layout
changes to the Report Card — the app's most-viewed screen: (a) replace the flat
metrics list with a Lighthouse-style score circle and color-coded, expandable
per-metric rows, and (b) fold the standing "AI Engineer" panel into a
collapsed inline section instead of a separate rail. Both are real production
layout changes, so before e17-01 (score circle) or e17-02 (inline AI) touch
`app/renderer`, this spike produces cheap static HTML/CSS mockups — using a
real sample grade, not placeholder numbers — so the direction can get a go/no-go
on the issue first.

## How to view

Open either file directly in a browser (no server, no build step):

- `docs/discovery/539-report-card-mockup/mockup-a-score-circle.html`
- `docs/discovery/539-report-card-mockup/mockup-b-inline-ai.html`

Screenshots are also committed alongside this doc: `mockup-a.png`, `mockup-b.png`.

Both files are self-contained (design tokens copied inline, nothing linked
into `app/`), have zero `<script>` tags, and use only native `<details>/
<summary>` for the one expand affordance — no interactivity beyond what a
browser gives that element for free.

## Buildability sanity check

Each mockup element was checked against the current DOM/data it would need to
be built from:

| Mockup element | Existing source |
| --- | --- |
| Score + letter grade | Already computed by `grading.js`'s `computeGrade`/`computeScore` and rendered today via `gradeRingHTML()` (`app/renderer/src/report-card.ts:171-196`) — the ring itself is not new, only its context (replacing the flat table as the primary metric view) is. |
| Per-row expand → measured/target/impact | `GradeExplanation.deductions` / `.notMeasured` (`report-card.ts:34-53`, the e2-05 breakdown), same data `whyGradeHTML()` already renders (`report-card.ts:303-342`). The five rows mocked here map onto `buildMetricRows()`'s existing metric list (`report-card.ts:265-282`) — no new metric needs computing. |
| Metric tones (good/check/issue) | `GradingPillApi` classifiers already exist and are two-way mirrors of the grade (`rcRmsStatus`, `rcPeakStatus`, `rcDrStatus`, `rcCentroidStatus` — `app/renderer/grading.js:324-349`). Every tone and target string in the mockup was read from these functions and `CONFIG`, not invented. |
| Real sample grade | `app/renderer/grading.golden.json`, case `rms_out_of_band_drop` (grade B, score 89, one deduction: RMS -22.0 dBFS vs. -20 to -14 dBFS target). No golden case in the file carries more than one deduction, so the spec's "prefer a richer multi-deduction case if one exists" doesn't apply — this was the only real option, and it's exactly the case the spec named. |
| Inline AI content (mockup B) | `#ai-output`'s narrative slot and `.pro-gate`'s copy/markup (`root-markup.html:340-351`) — both already exist, just currently rendered in a side `aside`, not inline. |

### Gap found: the "standing AI rail" doesn't actually show on the Report Card today

The audit's framing ("the current Report Card renders … a standing AI rail")
doesn't match the DOM as inspected: `app/renderer/src/styles/app.css` has

```css
body.rc-active #ai-panel { display:none; }
```

`#ai-panel` is scoped to the Live/Soundcheck tabs and is already hidden
whenever the Report Card view is active. There is no literal right rail next
to the Report Card to "fold inward" today.

Mockup A reflects that reality — it has no AI panel at all, matching current
production. Mockup B's inline section is therefore not a *migration* of an
existing element but a **net-new addition**: AI content has never appeared on
the Report Card screen before. That's a materially bigger scope question than
"move a panel" — e17-02 should decide explicitly whether Report Card AI
feedback is in scope, rather than treating it as a reshuffle of something that
already exists there.

One smaller gap: this golden case has no `truePeakDbtp` measurement (it's a
`sox`-only fixture, no `loudness` object), so the "Peak / True Peak" row shows
sample peak only with a note that true peak wasn't measured for this
recording — matching `buildMetricRows()`'s real conditional rendering
(`report-card.ts:268`), not a mockup shortcut.

No other gaps found — the per-row expand data, tones, and targets all traced
to real, already-computed values.

## Recommendation

**Go, with one scope change flagged for e17-02.** The score-circle-plus-rows
treatment (e17-01) is a straightforward visual reorganization of data the app
already computes — nothing new to build. The inline AI treatment (e17-02)
should proceed, but its spec should explicitly note that it introduces AI
content to the Report Card for the first time (not just relocates existing
content), since that changes its Pro-gating and layout-budget considerations
versus a simple panel move.

This decision must be recorded on issue #539 (or the spike PR) before e17-01
or e17-02 begin implementation, per the issue's acceptance criteria.
