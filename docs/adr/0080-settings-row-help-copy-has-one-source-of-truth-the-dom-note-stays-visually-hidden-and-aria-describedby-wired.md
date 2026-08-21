# Settings row help copy has one source of truth; the DOM note stays, visually hidden and aria-describedby-wired

- Status: Accepted
- Date: 2026-08-21

## Context

The Settings redesign epic (#999) replaces per-row `.ai-dialog-note` prose with a
single contextual help strip in the dialog footer. A naive implementation deletes
the paragraphs and shows the copy on hover only. That breaks two things at once:
`app/tests/e2e/settings.spec.ts` asserts `#usage-signal-note` contains "anonymous"
and "never audio" (a deliberate guard on privacy copy, #145), and hover-only help
is invisible to keyboard and screen-reader users — the redesign would remove
information from exactly the users least able to get it elsewhere.

The alternative failure mode is duplication: leave the prose inline in JSX and
retype it into a help table for the strip. Settings copy here is privacy-critical
(usage signal, crash reporting, console network consent). Two copies of a privacy
disclosure drift, and the drift is invisible until someone reads both.

Stories 2-4 of #999 will rewrite this dialog's layout underneath these rows, so
whatever convention story 1 sets is what every future Settings row is built
against.

## Decision

`app/renderer/src/settings-help.ts` owns the Settings row help copy as the single
source of truth: one `SettingsHelpEntry` per row, keyed by the existing
`SettingsControl` union. SettingsPanel.tsx renders both surfaces from that table —
the `#<row>-note` paragraph (always in the DOM, carrying `.settings-note-hidden`,
never `display:none` and never removed) and the footer `#settings-help-strip`. Each
control sets `aria-describedby` to its note element's id. The strip is
`aria-hidden="true"`: it is a visual affordance, and assistive tech already reads
the same words through `aria-describedby`.

`resolveSettingsHelp(active, section)` is pure — it takes the hovered-or-focused
control and the current section and returns a string, with the section description
as the fallback for "nothing active" and for any control with no help entry. The
pointer/focus wiring is a pure `settingsHelpHandlers(control, setActive)` factory,
so the hover/focus/exit behavior is unit tested without a DOM.

Any future Settings row that needs guidance adds an entry to
`SETTINGS_HELP_ENTRIES`. It does not add a prose paragraph to the JSX.

## Consequences

Positive: the note copy cannot drift from the strip copy, because there is only one
copy. Keyboard and screen-reader users keep full access to the guidance after the
layout collapses. The e2e privacy-copy guards keep working without being loosened.
The resolution logic is testable as a pure function, satisfying the constitution's
"extract pure functions and test those" rule with no jsdom.

Negative: Settings help copy now lives one file away from the markup it describes,
so a reviewer reading SettingsPanel.tsx alone no longer sees the prose. The
`SettingsControl` union becomes load-bearing for a second concern (it already maps
rows to sections via `settingsSectionFor`), and settings-help.ts takes a type-only
import from SettingsPanel.tsx — erased at compile time, so there is no runtime
import cycle, but the two files are coupled by that union. Row help is limited to a
single string per row; a row needing rich or conditional guidance will need this
table widened rather than special-cased in JSX.

## References

- [Epic #999 — Settings chrome: sidebar navigation, row grid, contextual help strip](https://github.com/on-par/sound-buddy/issues/999)
- [#1007 — Preserve accessible settings guidance with a contextual help strip](https://github.com/on-par/sound-buddy/issues/1007)
