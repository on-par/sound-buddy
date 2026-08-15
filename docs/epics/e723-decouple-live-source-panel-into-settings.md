# e723 Epic: Decouple Live-tab Source panel into Settings; secondary measurement becomes first-class: completion record

Issue #723 is a tracking epic, not a feature: decouple the Live tab's Source panel into
Settings — moving the rig/device/measurement-source/secondary-device/meter-cadence controls
out of the Live tab's left column into a Settings "Audio" pane — promote Record to a
persistent top-bar transport, and make the secondary measurement device first-class by
retiring its "experimental" opt-in flag. Every acceptance criterion is already satisfied in
this checkout: all seven stories shipped as squash-merged PRs (#724→#731, #725→#737,
#726→#738, #727→#739, #728→#740, #729→#741, #730→#742), each is an ancestor of HEAD, and the
supporting building blocks (top-bar transport cleanup #757→#772, promote-in-place #458→#592,
header readout #767→#773, stop-demote fix #776→#780, and the TD-001 slice 6c live-meter
infrastructure #701) are likewise merged. The epic itself stays OPEN on GitHub (verified via
`gh issue view 723`), and no `docs/epics/` completion record exists for it yet — the directory
holds e18, e56, e317, e383, e410, e455, e471, e610, and e656, but no e723. Per binding
ADR-0018, an epic whose criteria are met by accumulated merged work is closed by a repo-homed
completion record that asserts every criterion from the checkout and maps each story to its
issue, PR, and feature files — it is not closed by re-implementing already-shipped sub-issues,
which ADR-0018 forbids. This record is that closing evidence. ADR-0019 does not apply: no e723
completion record pre-exists as an ancestor of HEAD, so the ADR-0018 record must be written
first; this is not an empty no-op pass. The diff is exactly this one new docs/epics/ file.

## Acceptance-criteria checklist

Each criterion from the issue is asserted from this checkout with its evidence. Hashes are the
squash-merge commits reproduced from `git log` (see Verification); the merged sub-issue PR
mapping is: #724→#731, #725→#737, #726→#738, #727→#739, #728→#740, #729→#741, #730→#742.

| Issue criterion | Verified by (this checkout) |
|---|---|
| Secondary measurement block migrated off the legacy bridge into React, no visible behavior change (own PR) | `app/renderer/src/SecondaryMeasurementPanel.tsx` (+ `measurement-device-state.ts` pure helpers) is React; `root-markup.html` has no legacy secondary block and `inline-app.js` keeps only the `secondaryMeasurementActive()` runtime helper, not a UI block. Issue #724 → PR #731 (`05bfe9d`). |
| Meter-rate/window sliders migrated off the legacy bridge into React, no visible behavior change (own PR) | `app/renderer/src/CaptureCadenceControls.tsx`; `inline-app.js:1365` documents `#meter-interval`/`#window-secs` are React-owned. Issue #725 → PR #737 (`924d40f`). |
| A Settings "Audio" tab exists (empty shell, own PR) | `SettingsPanel.tsx` `settings-tab-btn-audio`/`settings-pane-audio`; `SettingsSection` includes `'audio'`. Issue #726 → PR #738 (`862079b`). |
| Rig/device/measurement-source/secondary-device/meter-cadence sliders live in Settings → Audio; Live tab's left column removed (own PR) | `#settings-pane-audio` composes RigControls/LiveSourceSettings/SecondaryMeasurementPanel/CaptureCadenceControls directly as JSX (no createPortal — ADR-0007); `root-markup.html` `#tab-live` relocated into `#spectrum-panel` and `mode-switch.ts` collapses `#source-panel` via `body.live-active`. Issue #727 → PR #739 (`24f6f43`). |
| Live tab auto-starts monitoring on open using last-used rig/device (own PR) | `live-auto-start.ts` `decideLiveAutoStart` + `mode-switch.ts` `maybeAutoStartLive` on `mode === 'live'` (gated on persisted `activeRigId`, ADR-0008). Issue #728 → PR #740 (`12e8e47`). |
| Record promoted to a persistent top transport bar, replacing the buried Monitor/Record toggle (own PR) | `RecordButton.tsx` + `record-transport.ts` + `#record-button-island` in `root-markup.html` `#header-right`; `LiveControls.tsx` documents the in-tab Mode toggle / LiveTransportControls are gone (#757, ADR-0014). Issue #729 → PR #741 (`2291bde`) and #757 → PR #772 (`ad5877c`); promote-in-place #458 → PR #592 (`df893f7`); stop-demote fix #776 → PR #780 (`77de7ea`, ADR-0015); header readout #767 → PR #773 (`c8892b1`). |
| Secondary measurement device first-class: "experimental" opt-in flag/checkbox gate removed while device selection stays (own PR) | `secondaryMeasurementEnabled` absent from `app/electron/settings.ts`; only the legacy-retirement test `settings.test.ts:945` remains (ADR-0009, following the #659 precedent); `SecondaryMeasurementPanel` always renders with an unconditional time-alignment warning (ADR-0005). Issue #730 → PR #742 (`06342da`). |

## Supporting infrastructure (not issue criteria)

The seven stories above rest on merged building blocks that also shaped the Live tab:

- `app/renderer/src/LiveWorkspace.tsx` + `live-meter-controller.ts` (TD-001 slice 6c, #701) —
  the per-tick live-meter patch controller and workspace island that the always-monitoring Live
  tab renders through; `live-level-readout.ts` + the `#live-level-readout` markup are the #767
  top-right dBFS readout (ADR-0014) that the always-monitoring tab needs to be self-explanatory.
- `app/renderer/src/mode-switch.ts` + `App.tsx` — `maybeAutoStartLive` wiring (#728), the
  `body.live-active` source-panel collapse (#727), and the RecordButton/SettingsPanel
  `createPortal` mounts (`#record-button-island`, `#settings-island`; `booted` prop gating).

## Verification

Run from this checkout (all green 2026-08-15):

- `git log --oneline | grep -E "#(731|737|738|739|740|741|742|772|780|773|592)"` — reproduces
  every merged sub-issue PR as an ancestor of HEAD: `05bfe9d` (#731), `924d40f` (#737),
  `862079b` (#738), `24f6f43` (#739), `12e8e47` (#740), `2291bde` (#741), `06342da` (#742),
  `ad5877c` (#772), `df893f7` (#592), `c8892b1` (#773), `77de7ea` (#780).
- `gh issue view 723 --json state,title,closedAt` — `state OPEN`, `closedAt null` before this
  PR merges; the PR body's `Closes #723` flips it to closed.
- `rg -n "secondaryMeasurementEnabled" app/electron/settings.ts` — no matches: production
  settings no longer carry the flag (ADR-0009); the only remaining reference anywhere is the
  legacy-retirement test at `app/electron/settings.test.ts:945`.
- `rg -n "settings-tab-btn-audio|settings-pane-audio" app/renderer/src/SettingsPanel.tsx` — the
  Audio tab button (`#settings-tab-btn-audio`) and pane (`#settings-pane-audio`) exist and
  compose RigControls/LiveSourceSettings/SecondaryMeasurementPanel/CaptureCadenceControls
  (+ PreflightSettings) directly as JSX, `SettingsSection` includes `'audio'`.
- `rg -n "record-button-island|id=\"record-button\"" app/renderer/src/root-markup.html
  app/renderer/src/RecordButton.tsx` — the top-bar Record island/button exist in `#header-right`;
  `LiveControls.tsx` documents that the in-tab Mode toggle and LiveTransportControls are gone
  (#757, ADR-0014).
- `rg -n "tab-live|live-active" app/renderer/src/root-markup.html app/renderer/src/mode-switch.ts`
  — `#tab-live` lives inside `#spectrum-panel` (not `#source-panel`) and `mode-switch.ts`
  collapses `#source-panel` via `body.live-active` (#727).
- `git status --porcelain` — exactly one untracked path: the new
  `docs/epics/e723-decouple-live-source-panel-into-settings.md`; nothing else changes.
- `npm run lint` — `tsc --noEmit` clean across all workspaces + app, `eslint --max-warnings 0`
  clean (unchanged by a doc-only diff).
- `./scripts/verify.sh --no-e2e` — install + build + lint + test complete green ("✓ verify
  passed"); e2e skipped by flag, per factory convention.

## Constitution compliance

- **TDD**: no new code is written (the closing PR is evidence, per ADR-0018), so there is
  nothing to red-green; the existing per-feature suites (`SecondaryMeasurementPanel.test.ts`,
  `CaptureCadenceControls.test.ts`, `record-transport.test.ts`, `live-auto-start.test.ts`,
  `live-level-readout.test.ts`, `live-meter-controller.test.ts`, `LiveWorkspace.test.ts`,
  `settings.test.ts`, …) and the e2e specs (`app/tests/e2e/live-capture.spec.ts`,
  `settings.spec.ts`) already prove the shipped behavior.
- **Coverage ratchet**: no coverage-config change, no `/* c8 ignore */` added, no floor
  lowered; nothing to regress.
- **Test colocation / no meaningless tests / same harness**: not applicable (no new code);
  existing colocated suites + e2e specs remain untouched.
- **Code quality / strict TS / no magic numbers**: not applicable (doc-only).
- **Architecture (pure functions, thin IPC)**: not applicable; no runtime change.
- **Quality gates**: `./scripts/verify.sh --no-e2e` and `npm run lint` pass on the closing
  branch, exactly as the e317/e383/e656 closings did.
- **ADR-0018 / ADR-0019**: ADR-0018 governs — no completion record exists, so one is written
  and carries the closing PR. ADR-0019's empty no-op path is deliberately not taken (it only
  applies once a record pre-exists in the tree) and this record says so. Feature-shaping ADRs
  are cited per criterion in the checklist above: 0005 (secondary device ships flag-gated with
  an unconditional time-alignment warning), 0007 (settings dialog composes moved controls
  directly, no portals), 0008 (auto-start gated on the persisted active rig), 0009 (secondary
  device first-class, flag retired), 0014 (live capture always monitoring, transport only in
  the persistent top bar), 0015 (top-bar stop is a demote to monitoring, not a full stop).
- **License header**: not needed — the new file is under `docs/`, outside `app/` (the MIT
  side); the `app/electron/licensing.test.ts` structure guard is unaffected because no app
  source file is added.

## Non-goals

- Any change to the preflight baseline island beyond what shipped with the relocation (already
  done — `PreflightSettings` in `#settings-pane-audio`).
- New measurement capabilities or behavior changes to existing measurement logic.
- Rewrites outside the Live-tab Source region.
- Re-implementing or re-queueing any of the seven already-merged sub-issues (ADR-0018).
- Changing the e2e suites or any product behavior — this PR only records the completion
  evidence; the Live-tab-visible changes' hands-on-service verification was documented in each
  sub-issue PR and their e2e suites now pin the behavior.
