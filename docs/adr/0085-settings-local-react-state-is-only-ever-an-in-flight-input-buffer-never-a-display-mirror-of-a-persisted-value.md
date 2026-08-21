# Settings local React state is only ever an in-flight input buffer, never a display mirror of a persisted value

- Status: Accepted
- Date: 2026-08-21

## Context

ADR-0084 (#1021) removed Settings' Save/Cancel and ruled that no Settings
control may be "staged in local React state and flushed on close". #1022
then had to decide, control by control, which of SettingsPanel.tsx's
remaining useState hooks were the forbidden thing. Two looked identical
from the outside — both were seeded from `settings?.<field>` and both were
re-synced by the same dialog-open effect — but they exist for opposite
reasons. `consoleNetworkConsentGranted` was a pure mirror: the row only
ever displays the persisted boolean, and holding a copy meant a consent
change made outside the dialog (the first-run grant modal, ADR-0006 /
ADR-0013) went unseen until the dialog was closed and reopened.
`shareChurchName` is the in-flight buffer for #1020's 400ms debounced
committer: the input must show what the user has typed during the window
before the write settles, so deleting it would make the field snap back
to the persisted value on every keystroke. Without a written rule, the
next person reading "delete local state mirrors" as a blanket instruction
deletes the church-name buffer too and breaks typing, or the next new
control re-adds a display mirror because one was already there.

## Decision

A `useState` in SettingsPanel.tsx (or any Settings pane component) is
permitted only when it holds a value the user is actively editing that has
not yet been committed — an in-flight input buffer for a debounced or
blur-flushed committer. Every value a Settings control *displays* is read
directly from settingsStore's persisted `settings` on each render, via a
pure derivation (`instantSettingValues`, `storageFolderDisplay`, or a
one-line `!!settings?.<field>` const). No Settings control may keep a
local copy of a persisted field for display purposes, and the dialog-open
effect may not re-sync one. Locally-fetched, non-settings data (the
storage seed's defaultPath/usageText, the app version) and pure UI state
(the selected section, the active help row) are not mirrors and are
unaffected. `app/renderer/src/batch-settings-gate.test.ts` enforces the
other half of ADR-0084 by scanning every file under app/renderer/src for
`buildStoragePatch`, `StorageToggles`, `TOGGLE_KEYS`, `saveAll` and
`SaveAllFields`; its token list is built by string concatenation so the
gate file is immune to its own scan, the same technique
app/electron/ai-carveout-gate.test.ts uses for the retired LLM surface.

## Consequences

Positive: the Settings dialog can no longer show a stale value for
anything a user can change from outside it, and the "is this state legal?"
question has a one-sentence answer instead of a case-by-case judgement.
The gate makes ADR-0084's no-Save rule enforced rather than merely
documented, and its self-immunity means the issue's own `rg` verification
stays clean. Negative: a commit that fails leaves the UI briefly showing
the pre-change value, because there is no optimistic local update to hide
the round-trip — for the console-consent Revoke button, that means the
button stays visible until updateSettings resolves. The gate is a
string-scan, so it cannot catch a batch-save path rebuilt under new names;
it guards against the old machinery returning, not against the pattern
being reinvented. Concatenated tokens read awkwardly and need their
explanatory comment kept alive.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1022)
- [Epic](https://github.com/on-par/sound-buddy/issues/1000)
- [ADR-0084 — Settings has no Save](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0084-settings-has-no-save-the-dialog-s-only-action-is-a-close-only-done.md)
