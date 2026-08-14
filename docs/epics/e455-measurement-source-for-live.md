# e455 Measurement Source for Live Capture: completion record

Issue #455 is a tracking epic, not a feature. Its deliverable is a measurement source for live
capture: a session channel (or, later, a separate device) that is the signal the app judges the
room by, with Monitor and Record modeled as separate states so recording can begin from an
already-live monitored source without a restart or a reselection. Every acceptance criterion is
already satisfied by the six sub-issues (#456–#461), all of which shipped as squash-merged PRs and
are closed `COMPLETED` on GitHub, with their squash-merge commits in this tree's history. Per
binding ADR-0018, an epic whose criteria are met by accumulated work is closed by a repo-homed
completion record that asserts every criterion from the checkout and maps each story to its PR and
feature files — there is no residual feature code to build. This record is that closing evidence.

## Shipped stories

Titles are the actual GitHub issue titles, read verbatim from `gh issue view`. State is as of
2026-08-14, read from `gh issue view`. Closing PR hashes are the squash-merge commits reproduced
from this checkout's history by the git command in the Verification section.

| Story | Actual GitHub title | Merged PR | Feature files in this tree |
|-------|--------------------|-----------|---------------------------|
| #456 | feat: Choose measurement source from existing live channels | [#526](https://github.com/on-par/sound-buddy/pull/526) (`4616ecf`) | `app/renderer/src/live-capture-panel.ts` (`normalizeMeasurementSource`, `measurementSourceOptionLabel`, `measurementSourceOptionsHTML`, `measurementSourceBadgeText`, `measurementChannel`), `app/renderer/src/stores/liveCaptureStore.ts` (`measurementSource` state + `setMeasurementSource`), `app/renderer/src/LiveSourceSettings.tsx` (board "Measurement Source" select), `app/renderer/src/rig-panel.ts` (rig-snapshot persistence), `app/renderer/src/inline-app.js`, `app/renderer/src/root-markup.html` |
| #457 | feat: Use selected measurement source for room-analysis indicators | [#527](https://github.com/on-par/sound-buddy/pull/527) (`1e8a356`) | `measurementChannel`/`measurementSourceBadgeText` in `live-capture-panel.ts`; the live report-card source derived from the Room feed in `app/renderer/src/stores/bridge.ts` (roomFeed-aware subscription) |
| #458 | feat: Start recording from an already-live monitored source | [#592](https://github.com/on-par/sound-buddy/pull/592) (`df893f7`) | `liveMode: 'monitor' \| 'record'` + `promoting` transient in `app/renderer/src/stores/liveCaptureStore.ts` and `app/renderer/src/inline-app.js` (promote flow); the measurement source survives the promote untouched |
| #459 | spike: Prove secondary audio-device measurement on macOS | [#513](https://github.com/on-par/sound-buddy/pull/513) (`02dcf27`) | `packages/audio-engine/scripts/spike_dual_capture.py` (+ `test_spike_dual_capture.py`), `docs/adr/0003-secondary-audio-device-measurement.md`, `scripts/verify.sh` spike wiring |
| #460 | feat: Add secondary audio-device measurement source support | [#698](https://github.com/on-par/sound-buddy/pull/698) (`f19ad57`) | `app/electron/ipc/measurement-source.ts` (start/stop-measurement IPC), `app/renderer/src/measurement-device-state.ts` (pure state machine: `applyStartResult`, `applyStreamEnded`, `reconnectDecision`, `roomFeed`, `roomPaneOverride`), `app/renderer/src/SecondaryMeasurementPanel.tsx`, secondary actions in `liveCaptureStore.ts`, `app/electron/ipc/api.ts` (`StartMeasurementOpts`); EQ-pane Room slot follow-up [#722](https://github.com/on-par/sound-buddy/pull/722) (`b8a4b4e`) |
| #461 | feat: Add measurement-source quality and calibration hints | [#790](https://github.com/on-par/sound-buddy/pull/790) (`a0afce8`) | `app/renderer/src/measurement-source-hints.ts` (kind taxonomy + hedged copy), consumed by `LiveSourceSettings.tsx` (`boardSourceHint`) and `SecondaryMeasurementPanel.tsx` (`sourceHintForDevice`) |

## Acceptance-criteria checklist

Each epic criterion is asserted from this checkout with its evidence.

- [x] **Live Capture receiving multiple session channels lets the user choose one channel as the
      measurement source.** → #456 (PR #526): `measurementSource` strip index in
      `liveCaptureStore.ts`, the "Measurement Source" select in `LiveSourceSettings.tsx` fed by
      `measurementSourceOptionsHTML`, normalized by `normalizeMeasurementSource`, and persisted in
      the CaptureRig snapshot (`rig-panel.ts`).
- [x] **The chosen channel is labeled as the active measurement source in the UI.** →
      `measurementSourceBadgeText` in `live-capture-panel.ts` renders "Measuring: <label>" in the
      live header.
- [x] **Room-analysis meters and guidance use the selected measurement source.** → #457 (PR #527):
      `measurementChannel` resolves the analysis indicator's tick channel from `measurementSource`;
      the live report-card source is derived through `roomFeed` in `bridge.ts`; the EQ pane's Room
      slot reads the same Room feed (board strip or, when active, the secondary source via
      `roomPaneOverride`, #722).
- [x] **The multitrack recording setup remains intact when a measurement source is chosen.** →
      `measurementSource` is a renderer-side strip index only; the `startLive` payload
      (`liveCaptureStore.ts` `startCapture`) carries device/channels/window/interval/mode/recordDir/
      arm/labels and never `measurementSource`; #456's diff was renderer-only — no stream.py or IPC
      change (ADR-0003: session-channel measurement "reuses the single existing capture stream").
- [x] **Monitoring and recording are modeled as separate states; starting recording from an
      already-live monitored source does not require reselecting the source.** → #458 (PR #592):
      `liveMode: 'monitor' | 'record'` with the `promoting` transient for the promote-in-place
      transition; the measurement source is orthogonal state and survives the promote. Note that
      ADR-0014 (#772/#776/#777) later evolved this into the always-monitoring Live tab with the
      top-bar Record as the sole transport — recording from an already-live source still requires no
      reselection, so the criterion holds.
- [x] **The UI still shows which source is being measured while recording.** → the "Measuring:
      <label>" badge and the EQ pane Room slot are driven by `roomFeed()`/`measurementSourceBadgeText`
      independent of `liveMode`.
- [x] **Separate-device capture is gated on the feasibility spike; Sound Buddy does not imply
      time-aligned multi-device measurement is production-ready until the spike passes.** → #459
      (PR #513) merged 2026-07-19 **before** #460 merged 2026-08-08; the product ships an
      unconditional time-alignment warning (`alignmentWarningHTML` in
      `measurement-device-state.ts`) whenever a secondary source is selected (ADR-0003/0005) and
      never claims sample-aligned production measurement.
- [x] **A spike proves secondary-device measurement on macOS (clock alignment, sample rate,
      permission UX, device disconnect handling, fallback behavior) before secondary-device support
      ships.** → #459: `spike_dual_capture.py` + `test_spike_dual_capture.py` + ADR-0003 cover
      concurrency, timestamps & sample rates, drift over 10–30 min, device-class differences,
      permission lifecycle, disconnect handling, and degradation/fallback — wired into
      `scripts/verify.sh`.
- [x] **Secondary-device measurement support is added only after clock, sample-rate, and permission
      behavior are understood.** → #460 (PR #698) shipped after #459 and ADR-0003, as a metering-only
      secondary stream process with independent lifecycle/event channel and the unconditional warning.

## Governing-condition evidence

The epic's Verification lines, asserted from this checkout:

- **UX copy uses "Measurement source" grouped by origin: "Session channels" first, "Audio devices"
  later.** → Settings → Audio composes `RigControls` → `LiveSourceSettings` (the board "Measurement
  Source" select — session channels) → `SecondaryMeasurementPanel` (the "Secondary Measurement
  Device" select — audio devices) → `CaptureCadenceControls` (`SettingsPanel.tsx`). The grouping is
  realized by ordering + labels; the literal heading words "Session channels"/"Audio devices" do not
  appear (recorded honestly under Discrepancies).
- **Selecting a session-channel measurement source works against the existing capture stream without
  changing the capture engine.** → #456's diff was renderer-only; no change to `stream.py`,
  `live-capture.ts`, or the IPC contract.
- **Manual scenario checks…** → covered by the shipped behavior plus the unit tests of the pure
  helpers (`measurementChannel`, `measurementSourceBadgeText`, `roomFeed`, `applyStartResult`,
  `applyStreamEnded`, `reconnectDecision`, `classifySourceName`).
- **Stories #456–#461 are tracked and link back to this epic.** → each story issue body references
  #455 and each is CLOSED/COMPLETED (gh-verified).

## Discrepancies / evolution notes

Mirroring e383's "Transcript swap note" and e410's "Discrepancies documented", the following are
recorded honestly rather than papered over:

- **No transcript swap.** The epic's "In scope" list is prose without per-story numbers; the story
  numbers map 1:1 to #456–#461 in the order given, and each actual issue title matches its
  description — no swap.
- **Real-rig drift numbers are still pending.** ADR-0003's measured results came from a machine with
  zero input devices; the drift findings are "documented behavior — pending real-rig confirmation."
  #460 shipped regardless, but honestly gated: metering-only secondary stream, unconditional
  time-alignment warning, Aggregate Device recommendation. The product never implies production-ready
  time-aligned multi-device measurement.
- **The "Session channels first, Audio devices later" grouping is realized by ordering + labels, not
  literal section headings.** Settings → Audio's composition order (board "Measurement Source" select
  before the "Secondary Measurement Device" select) delivers the grouping the epic's verification
  line describes, but the literal words "Session channels"/"Audio devices" do not appear in the UI.
- **Post-ship evolutions that preserve the criteria.** #458's in-tab Monitor/Record toggle was
  superseded by ADR-0014 (#772/#776/#777): the Live tab is always-monitoring, the top-bar Record is
  the sole transport, and stopping a recording demotes to monitoring — recording from an already-live
  source still needs no reselection. #460's opt-in flag was retired by ADR-0009 (#730): the secondary
  device is first-class and always visible, warning still unconditional.

## Verification

Run from this checkout (all green as of 2026-08-14):

- `git log --all --oneline | grep -E '\(#(526|527|592|513|698|790)\)'` — reproduces all six merged
  PR numbers with the exact short hashes cited above: `4616ecf` (#526), `1e8a356` (#527),
  `df893f7` (#592), `02dcf27` (#513), `f19ad57` (#698), `a0afce8` (#790).
- `git merge-base --is-ancestor 4616ecf HEAD && git merge-base --is-ancestor 1e8a356 HEAD && git
  merge-base --is-ancestor df893f7 HEAD && git merge-base --is-ancestor 02dcf27 HEAD && git
  merge-base --is-ancestor f19ad57 HEAD && git merge-base --is-ancestor a0afce8 HEAD` — each
  squash-merge commit reports ancestor-of-HEAD, proving all six story PRs are in this tree's history.
- `for i in 456 457 458 459 460 461; do gh issue view $i --json number,state,stateReason; done` —
  all six report `CLOSED` with `stateReason: COMPLETED`, matching the table's State column; each
  issue body references the epic (#455).
- `gh issue view 455 --json state,title` — `OPEN` with title "Epic: Measurement source for live
  capture" before this PR; the PR's `Closes #455` body line is what closes it.
- `./scripts/verify.sh --fast` — passes on the accumulated tree. The diff is doc-only, so compile,
  lint, tests, and the coverage ratchet are untouched.
