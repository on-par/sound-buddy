# body.analyze-listening is a full-stage workspace mode — Analyze's live EQ owns the whole stage, and secondary panels fold rather than shrink

- Status: Accepted
- Date: 2026-09-20

## Context

Analyze's live-listening room-mic EQ shipped as `#analyze-live-island` inside `#spectrum-panel`
(ADR-0141). `#spectrum-panel` is `flex:1` inside `#workspace`, which shares `#stage` with
`#reportcard-view` (640px, `var(--rc-panel-w)`) and sits beside `#source-panel` (260px,
`var(--panel-w)`). Clicking Analyze does not change the workspace mode —
`analyzeEntryStore.enterAnalyze()` starts listening and nothing calls `switchMode` — so whatever
chrome the previous tab had stays on screen. On the app's 1200x800 default window that left the
"primary" live EQ roughly 520px wide while the report card alone held 640px, which is the defect
#1496 reports. Worse, a Simple-mode user on History carries `body.single-column`, whose
`#spectrum-panel { display:none; }` hides the live EQ entirely.

The repo already had two precedents for exactly this situation — `body.rc-active` and
`body.live-active` each fold `#source-panel` away so the active workspace gets the full stage —
but `body.analyze-listening` had only visibility rules for the islands inside `#spectrum-body`,
none for the stage around them. The remaining choice was whether to shrink the competing panels or
fold them, and whether a mode class set by a React leaf component may reach outside its own island
in the cascade.

## Decision

`body.analyze-listening` is a full-stage workspace mode class, in the same family as
`body.rc-active` and `body.live-active`, and `app.css` states that in one block: `#source-panel`
and `#reportcard-view` are hidden, `#spectrum-panel` is forced visible so `body.single-column`
cannot fold the stage the island lives in, and `.analyze-live-eq`'s primary section fills the freed
area as a single inset card. Competing panels fold; they are never shrunk to a rail. Every rule is
scoped to `body.analyze-listening` so the layout reverts the instant `AnalyzeLiveEqPanel` drops the
class.

The room curve keeps `width:100%; height:auto`. `veqArcSVG` emits a 900x280 viewBox with the
default `xMidYMid meet` while `.veq-bars` and `.veq-db-scale` are positioned by `VEQ_INSET`
percentages derived from `CURVE_VB` — so the SVG grows with the container and never gets a forced
height or `preserveAspectRatio="none"`, which would letterbox the plot area and silently misalign
the bars and dB ticks from the curve. A future slice that wants a taller chart must change the
viewBox or the inset math, not stretch the element.

New chrome added to the Analyze live-listening screen belongs inside `#analyze-live-island`,
subordinate to the EQ card. Anything that would re-introduce a competing full-height column beside
it needs a new issue and an update to this ADR.

## Consequences

Positive: the live EQ occupies effectively the whole stage (~97% of body width on the default
window, up from ~43%), the Simple-mode History blind spot is closed, and the rule set reads as an
obvious sibling of the two existing full-stage mode classes. Because it is pure CSS keyed on an
already-owned body class, there is no new runtime code, no new store field, and no coverage
surface.

Negative: the report card is not visible while listening, so an engineer who wants to compare a
loaded file's card against the live room must stop listening first — accepted, since loading a
file already tears the listen down (#1485). The CSS-gate unit test pins selector text, so renaming
`#reportcard-view` or `#source-panel` now breaks a test in two places. And the "fold, never shrink"
rule forecloses a future split-view Analyze layout without revisiting this ADR.

## References

- [Issue #1496 — Give the Analyze live EQ a large primary layout region](https://github.com/on-par/sound-buddy/issues/1496)
- [ADR-0141 — Analyze's live-listening room-mic EQ is its own centre island, never a re-parented docked pane](./0141-analyzes-live-listening-room-mic-eq-is-its-own-centre-island-never-a-re-parented-docked-pane.md)

## Amendment (2026-09-24, ADR-0145)

#1487 is the "new issue" this ADR's Decision and Negative-consequences sections both anticipated for
a split-view Analyze layout. ADR-0145 authorizes exactly one addition: `.analyze-stage`, a flex row
inside the still-`#analyze-live-island`-gated stage, giving the room EQ (`.analyze-live-eq`, still
`flex:1`, still the dominant column) a fixed-width sibling column (`.analyze-results-rail`) for the
folded report-card results. `#source-panel`/`#reportcard-view` stay folded exactly as this ADR
requires — the new column lives entirely inside the stage this ADR already owns, not beside it.
