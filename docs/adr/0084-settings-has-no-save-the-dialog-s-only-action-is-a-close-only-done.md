# Settings has no Save — the dialog's only action is a close-only Done

- Status: Accepted
- Date: 2026-08-21

## Context

Sound Buddy's Settings dialog began (#91, #204) as a staged form: local React state
seeded on open, a Cancel that discarded it, and a Save that diffed the staged values
against the persisted AppSettings and emitted one patch. Epic #1000 dismantled that
model control by control — #1018 moved the seven grading/reminder/telemetry/labs
controls onto commitInstantSetting, #1019 moved the storage folder onto
commitStorageDir/chooseStorageFolder, #1020 moved the church name onto a debounced
committer, and ADR-0013 (#1013) had already made console-network consent a dedicated
grant IPC with a revoke-only patch path. By the time #1021 was picked up, handleSave's
buildStoragePatch call was provably always null and Cancel had nothing left to cancel:
the footer advertised a transactional contract the dialog no longer honoured, and any
new control could quietly re-attach itself to the vestigial Save path.

## Decision

The Settings dialog's action area holds exactly one control: a primary
`#settings-dialog-done` button labelled "Done" whose onClick is the shared
`closeSettingsDialog` — identical to the backdrop click, the title-bar ✕ and the
document-level Escape handler. Closing Settings never writes a settings patch. Every
Settings control persists its own value at the moment it changes, through a
single-key commit helper (commitInstantSetting, commitStorageDir, the church-name
committer, or a dedicated IPC in the console-consent case). No Settings control may be
staged in local React state and flushed on close, and no Save/Apply/Cancel affordance
may be reintroduced. `saveAll`/`SaveAllFields` in SettingsPanel.tsx and
`buildStoragePatch`/`StorageToggles`/`TOGGLE_KEYS` in storage-settings.ts — the last
machinery of the staged model — are deleted rather than left as unreferenced exports.

## Consequences

Positive: the dialog's affordances now match its behaviour, so a user cannot lose a
change by closing with the wrong control, and every close path (Done, Escape, ✕,
backdrop) is one line of code that cannot drift. The always-null diff and its ~90 lines
of tests leave the tree. Future Settings work has one obvious shape to follow.
Negative: there is no longer any way to abandon a set of edits — a mis-toggled control
is persisted immediately and must be toggled back, and #1021's scope explicitly excludes
adding undo or confirmation. Controls whose commit is debounced (the church name) can
land their write shortly after the dialog closes; a reopen inside that window shows the
pre-debounce value until the write settles, which is the same race Cancel/Escape have
had since #1020. Any control that genuinely needs atomic multi-field validation will
have to be a nested confirm-style sub-dialog, not a return of Save.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1021)
- [Epic](https://github.com/on-par/sound-buddy/issues/1000)
