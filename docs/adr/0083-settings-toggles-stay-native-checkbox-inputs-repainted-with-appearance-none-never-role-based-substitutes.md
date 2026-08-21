# Settings toggles stay native checkbox inputs repainted with appearance:none, never role-based substitutes

- Status: Accepted
- Date: 2026-08-21

## Context

Epic #999 recompacts the Settings dialog, and the obvious way to make a
checkbox match a compact visual language is the usual web recipe: hide
the input (`opacity:0`, `sr-only`, or `display:none`) and paint a sibling
`<span>` track, or drop the input entirely for a `<button role="switch">`
pill. Both are wrong here.

The Settings surface is verified by `app/tests/e2e/settings.spec.ts`,
which drives `#usage-signal-toggle` with Playwright `.check()` and
`.uncheck()`. Those calls run actionability checks against the located
element: a zero-opacity, zero-sized or `display:none` input is not
actionable, and a `role="switch"` button is not a checkbox at all. Either
substitution turns a green e2e suite into a flaky or failing one, and it
costs real users the native keyboard and assistive-technology behavior
that an `<input type="checkbox">` gets for free — for a purely cosmetic
gain.

ADR-0082 already establishes that Settings styling is expressed as CSS
scoped under `.settings-pane` and never by editing the shared row classes
that FeedbackDialog, SoundcheckPanel and CurveEditorDialog also render.
The toggle chrome inherits that constraint: `.ai-enable-row input {
accent-color:var(--gold-500); }` is a shared base rule and stays as it is.

## Decision

Every toggle inside the Settings dialog is an `<input type="checkbox">`
and is restyled in place: `appearance:none` on the input itself, with the
unchecked, `:checked`, `:focus-visible` and `:disabled` states painted
from design tokens by rules scoped `.settings-pane input[type="checkbox"]`
in `app/renderer/src/styles/app.css`. The box size comes from the
`--settings-toggle-size` token, colors from the existing surface/border/
gold tokens, and the focus ring from `--glow-focus`.

The input is never hidden, never zero-sized, and never wrapped by or
replaced with a `role="switch"` / `role="checkbox"` element, a `<button>`,
or any other custom control. The checked state is carried by the input's
own background color; the `::after` checkmark is decorative, so checked
and unchecked stay distinguishable even if the pseudo-element does not
render.

Control identifiers (`#usage-signal-toggle`, `#crash-reporting-toggle`,
`#weekly-reminder-toggle`, `#daw-workspace-toggle`,
`#live-adjustments-toggle`) are stable contract with the e2e suite and are
not renamed by styling work. Any future Settings toggle is added the same
way — a native checkbox inside a `SettingsGroup` row — and inherits this
chrome for free.

## Consequences

Positive: Playwright `.check()`/`.uncheck()`, Space-bar operation, form
semantics and screen-reader announcements all keep working with no ARIA
re-implementation; the visual change is CSS-only, so no renderer statement
coverage moves; other dialogs that render `.ai-enable-row` are provably
untouched; every dimension is token-driven.

Negative: the achievable look is bounded by what can be painted on a
replaced form control — an animated sliding-thumb switch is effectively
off the table, and the checkmark relies on a pseudo-element on an input,
which is a Chromium-supported but non-universal technique (acceptable
because the app ships its own Chromium, and because the fill carries the
state regardless).

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1010)
- [Epic](https://github.com/on-par/sound-buddy/issues/999)
- [ADR-0082 — Settings row grid is applied by CSS scoped to .settings-pane](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0082-settings-row-grid-is-applied-by-css-scoped-to-settings-pane-never-by-editing-shared-row-classes.md)
