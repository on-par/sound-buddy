# Settings row grid is applied by CSS scoped to .settings-pane, never by editing shared row classes

- Status: Accepted
- Date: 2026-08-21

## Context

The Settings dialog reuses row classes that predate it: `.ai-field` and
`.ai-enable-row` came from the retired AI Engineer tab, `.select-label`
and `.select-row` are the shared select recipe, `.slider` is the shared
slider. Those same classes are rendered outside Settings by
FeedbackDialog, SoundcheckPanel and CurveEditorDialog, so #1009's
two-column grid cannot be pushed into the base rules without changing
layouts the issue puts out of scope.

The Audio pane's rows are not rendered by SettingsPanel.tsx at all —
ADR-0007 moved RigControls, LiveSourceSettings,
SecondaryMeasurementPanel and CaptureCadenceControls into the pane as
direct JSX children, and #757 added PreflightSettings. Giving every row
an explicit `.settings-row` wrapper class would therefore mean editing
five components (and their colocated tests) whose markup only Settings
renders, for a purely visual change. The pane also carries a live
constraint: `body.not-pro #settings-pane-audio > :not(.pro-gate)` gates
Pro access off the pane's *direct children*, so any new DOM level has to
keep `.pro-gate` at that level.

## Decision

The Settings two-column row grid is expressed entirely as descendant
rules scoped under `.settings-pane` / `.settings-group` in app.css.
Shared row classes (`.ai-field`, `.ai-field-label`, `.select-label`,
`.select-row`, `.ai-enable-row`, `.slider`, `.record-row`,
`.rig-actions`, `.storage-path-row`) keep their base rules byte-for-byte
and are re-laid only inside the dialog. The control column's width and
the row gutter come from `--settings-control-w` and `--settings-row-gap`
in tokens.css, not literals, alongside #1008's `--settings-card-w` /
`--settings-card-h` / `--settings-rail-w`.

SettingsPanel.tsx owns exactly two pieces of new markup: a local
`SettingsGroup` wrapper (`<section class="settings-group">` plus
`<h3 class="settings-group-title">`) and a leading
`<span class="settings-row-label">` on each checkbox row so the caption
lands in column 1. The five composed Audio components are wrapped, never
edited, and `.pro-gate` stays a direct child of `#settings-pane-audio`.

Any future Settings control is added by rendering one of the existing
row classes inside a `SettingsGroup` — it inherits the grid for free.
Widening the grid to a surface outside the dialog means writing a new
scoped block for that surface, not unscoping these rules.

## Consequences

Positive: the visual change lands in ~5 files with no edits to shared
components; other `.rig-dialog` consumers are provably untouched
(asserted in styles.test.ts); new Settings rows get the grid with no
per-row markup ceremony; every dimension stays token-driven.

Negative: the row layout is implied by descendant selectors rather than
declared per row, so reading a single component no longer tells you how
its row will look inside Settings — the coupling lives in app.css's
Settings block and in this ADR. Markup that puts more than two element
children in a row container (e.g. SecondaryMeasurementPanel's trailing
`.device-hint` paragraphs) needs an explicit `grid-column:2` rule rather
than falling out automatically.

## References

- [Issue #1009 — feat: Lay out Settings controls as token-driven aligned rows](https://github.com/on-par/sound-buddy/issues/1009)
- [Epic #999 — Settings chrome: sidebar navigation, row grid, contextual help strip](https://github.com/on-par/sound-buddy/issues/999)
