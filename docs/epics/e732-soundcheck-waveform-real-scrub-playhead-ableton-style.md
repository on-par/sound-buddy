# e732 Epic: Soundcheck waveform + real scrub/playhead (Ableton-style): completion record

Issue #732 is a tracking epic, not a feature: render an Ableton-style per-track waveform in
the Virtual Soundcheck tab and add a real scrub/playhead to Soundcheck playback. Every
acceptance criterion is already satisfied in this checkout: all four stories shipped as
squash-merged PRs (#733→#769, #734→#774, #735→#775, #736→#783), each is an ancestor of HEAD,
and the supporting follow-ups that shaped the shipped surface (route hot-swap during playback
#759→#771, meter-card strip #760→#786, waveform re-paint on window resize #735→#787, saved bus
routing #756→#789) are likewise merged. The epic itself stays OPEN on GitHub (verified via
`gh issue view 732` — `state OPEN`, `closedAt null`), and no `docs/epics/` completion record
exists for it yet — the directory holds e18, e56, e317, e383, e410, e455, e471, e610, e656,
and e723, but no e732. Per binding ADR-0018, an epic whose criteria are met by accumulated
merged work is closed by a repo-homed completion record that asserts every criterion from the
checkout and maps each story to its issue, PR, and feature files — it is not closed by
re-implementing already-shipped sub-issues, which ADR-0018 forbids. This record is that
closing evidence. ADR-0019 does not apply: no e732 completion record pre-exists as an ancestor
of HEAD, so the ADR-0018 record must be written first; this is not an empty no-op pass. The
diff is exactly this one new docs/epics/ file.

## Acceptance-criteria checklist

Each criterion from the issue is asserted from this checkout with its evidence. Hashes are the
squash-merge commits reproduced from `git log` (see Verification); the merged sub-issue PR
mapping is: #733→#769, #734→#774, #735→#775, #736→#783.

| Issue criterion | Verified by (this checkout) |
|---|---|
| `playback.py` supports seeking / starting at an offset | `--start-at S` is documented in the usage block (`packages/audio-engine/scripts/playback.py:12`) and parsed at 596-597 (`start_secs = max(0.0, ...)`); `compute_start_frame` (303-308) clamps the seek frame to `[0, total_frames]`; every stem handle runs `h.seek(start_frame)` before the mixdown block (406, preceded by the 400-404 comment/derivation); `session_elapsed` (311-314) reports the session-relative position. Electron: `StartPlaybackOpts.startOffsetSecs` (`app/electron/ipc/api.ts:107`) flows through `buildPlaybackArgs` (`app/electron/ipc/playback.ts:78`), which maps it to `--start-at` only when positive. Python tests: `packages/audio-engine/scripts/test_playback.py` `compute_start_frame`/`session_elapsed` suite, incl. `test_start_at_offsets_audio_and_elapsed`. Issue #733 → PR #769 (`d087a48`). |
| Loading a session decodes stems once into per-track peak buckets (reusing the ADR-0004 bucket-encoding, not the live-streaming mechanism) | `packages/audio-engine/scripts/waveform_peaks.py` decodes each stem in bounded blocks into per-bucket min/max (stereo folds L/R), quantizes to u8 (`QUANT_LEVELS = 256`), interleaves min/max bytes, base64-packs per track, and writes the JSON document to `--out` at 50 buckets/sec — the ADR-0004 technique from `spike_waveform_transport.py`, no live streaming. Orchestration: `app/electron/ipc/waveform-peaks.ts` `runWaveformPeaks` (86) + disk cache (`peakCachePathFor` under userData/soundcheck-peaks at 66, `isPeakCacheFresh` mtime check at 76) so the decode runs once per session and re-loads are instant. Triggered once per session load via `soundcheckStore.chooseSession` (`app/renderer/src/stores/soundcheckStore.ts:180-185`). Issue #734 → PR #774 (`b030f6c`); ADR-0014. |
| Peak data served via IPC | `generate-session-peaks` IPC handler (`app/electron/ipc/playback.ts:118`), delegating to `runWaveformPeaks` and returning `GenerateSessionPeaksResult` (`{ success, cached, peaks: SessionPeaksDto }`, `app/electron/ipc/api.ts:745`). No Pro-gate (like read-session, waveform data never locks). |
| `SoundcheckPanel.tsx` renders Ableton-style stacked per-track lanes | `#sc-waveforms` renders one `.sc-waveform-lane` (name + canvas) per track from `sessionPeakTimeline` (`app/renderer/src/soundcheck-waveform.ts:96`) — one combined lane per track (ADR-0014), all lanes sharing one time axis aligned at x=0 via the shared `pxPerSecond` derived in `SoundcheckPanel.tsx`'s `paintLanes` (188-217). Issue #735 → PR #775 (`df52c07`). |
| Playhead renders; click/drag scrubs and audio jumps | `#sc-playhead` overlay (`app/renderer/src/SoundcheckPanel.tsx:326`); `onWaveformPointerDown` pointer-down/move/up wiring commits exactly one `seekTo` on pointer release (135-154); pure geometry helpers `soundcheckPlayheadLeftPx` / `soundcheckSeekTargetFromClick` (`app/renderer/src/soundcheck-playhead.ts`); `seekTo` (`app/renderer/src/stores/soundcheckStore.ts:235-252`) re-invokes start-playback with `startOffsetSecs`, i.e. ADR-0013 restart-with-start-offset via the ADR-0010 playbackSlot. Issue #736 → PR #783 (`4b5df64`); ADR-0013 + ADR-0015. |
| 60Hz ref-based playhead updates (SpectrogramScrubber-style, straight to DOM refs) | `createSoundcheckTransportController` (`app/renderer/src/soundcheck-transport-controller.ts`) coalesces `soundcheckStore.lastElapsedTick` into one rAF-per-burst patch; `patchPlayheadDom` (`app/renderer/src/SoundcheckPanel.tsx:45-56`) writes `style.left` straight to `#sc-playhead` — no React re-render, CSS transitions never restart (ADR-0005). |
| Four stories landed as separate PRs in order; no DAW-workspace touch | `git log` reproduces #769, #774, #775, #783 as separate merged PRs in story order; `dawWorkspaceEnabled` remains at `app/electron/settings.ts:292` and no DAW commit appears in the epic range. |

## Supporting infrastructure (not issue criteria)

The four stories above rest on merged follow-up PRs that also shaped the Soundcheck surface:

- `app/renderer/src/SoundcheckPanel.tsx` — route hot-swap during playback (#759→#771,
  `e0f5272`): the route select swaps the active bus live without stopping playback.
- `app/renderer/src/SoundcheckPanel.tsx` — meter-card strip (#760→#786, `b501c0b`): the
  RMS/Peak/CLIP meter cards are gone, leaving tracks + playhead only.
- `paintLanes` re-paint on window `resize` (#735→#787, `529d149`): lane canvases re-measure
  instead of going stale at the pre-resize width.
- Saved bus routing (#756→#789, `a1a1b6a`): auto-assign tracks to a channel output by label
  pattern.

Governing ADRs are cited per criterion in the checklist above: 0013 (restart-with-start-offset
seek), 0014 (Soundcheck peaks as a disk-cached background batch, live-mechanism reuse
rejected), 0015 (release-commit scrub — pointer-up commits the seek), 0004 (min/max u8 base64
peak transport), 0005 (animation-rate, ref-based DOM writes), with the ADR-0010 playbackSlot /
peaksSlot spawning playback.py / waveform_peaks.py.

## Verification

Run from this checkout (all green 2026-08-15):

- `git log --oneline | grep -E "#(769|774|775|783|771|786|787|789)"` — reproduces every merged
  sub-issue PR as an ancestor of HEAD: `d087a48` (#769), `b030f6c` (#774), `df52c07` (#775),
  `4b5df64` (#783), `e0f5272` (#771), `b501c0b` (#786), `529d149` (#787), `a1a1b6a` (#789).
- `gh issue view 732 --json state,title,closedAt` — `state OPEN`, `closedAt null` before this
  PR merges; the PR body's `Closes #732` flips it to closed.
- `for n in 733 734 735 736; do gh issue view $n --repo on-par/sound-buddy --json number,title,state,closedAt; done`
  — all four sub-issues report `state CLOSED` with 2026-08-14 `closedAt` timestamps.
- `rg -n "--start-at|compute_start_frame|seek\(" packages/audio-engine/scripts/playback.py` —
  the `--start-at` flag, `compute_start_frame`, and per-stem `h.seek` are present.
- `rg -n "generate-session-peaks|startOffsetSecs" app/electron/ipc/playback.ts app/electron/ipc/api.ts`
  — the `generate-session-peaks` handler and `StartPlaybackOpts.startOffsetSecs` exist.
- `rg -n "sc-waveforms|sc-playhead|seekTo" app/renderer/src/SoundcheckPanel.tsx app/renderer/src/stores/soundcheckStore.ts`
  — the lane markup, playhead overlay, and `seekTo` release-commit wiring exist.
- `rg -n "dawWorkspaceEnabled" app/electron/settings.ts` — still present at
  `app/electron/settings.ts:292`; the DAW workspace was not touched by the epic.
- `git status --porcelain` — exactly one untracked path: the new
  `docs/epics/e732-soundcheck-waveform-real-scrub-playhead-ableton-style.md`; nothing else
  changes.
- `npm run lint` — `tsc --noEmit` clean across all workspaces + app, `eslint --max-warnings 0`
  clean (unchanged by a doc-only diff).
- `./scripts/verify.sh --no-e2e` — install + build + lint + test complete green ("✓ verify
  passed"); e2e skipped by flag, per factory convention. (If e2e is run,
  `app/tests/e2e/virtual-soundcheck.spec.ts` covers the stacked lane rendering, the resize
  re-paint (#735), and the live playhead + click-seek (#736) paths.)

## Constitution compliance

- **TDD**: no new code is written (the closing PR is evidence, per ADR-0018), so there is
  nothing to red-green; the existing per-feature suites
  (`packages/audio-engine/scripts/test_playback.py`, `test_waveform_peaks.py`,
  `app/renderer/src/soundcheck-waveform.test.ts`, `soundcheck-playhead.test.ts`,
  `soundcheck-transport-controller.test.ts`, `app/electron/ipc/waveform-peaks.test.ts`,
  `playback.test.ts`) and the e2e spec (`app/tests/e2e/virtual-soundcheck.spec.ts`) already
  prove the shipped behavior.
- **Coverage ratchet**: no coverage-config change, no `/* c8 ignore */` added, no floor
  lowered; nothing to regress.
- **Test colocation / no meaningless tests / same harness**: not applicable (no new code);
  existing colocated suites + e2e specs remain untouched.
- **Code quality / strict TS / no magic numbers**: not applicable (doc-only).
- **Architecture (pure functions, thin IPC, injected deps)**: not applicable — no runtime
  change; the cited modules already follow it (e.g. `waveform-peaks.ts` injects every
  environment dependency; `soundcheck-waveform.ts`/`soundcheck-playhead.ts` are pure).
- **Quality gates**: `./scripts/verify.sh --no-e2e` and `npm run lint` pass on the closing
  branch, exactly as the e317/e383/e656/e723 closings did.
- **ADR-0018 / ADR-0019**: ADR-0018 governs — no completion record exists, so one is written
  and carries the closing PR. ADR-0019's empty no-op path is deliberately not taken (it only
  applies once a record pre-exists in the tree) and this record says so. Feature-shaping ADRs
  are cited per criterion in the checklist above: 0004 (peak transport), 0005 (animation-rate
  DOM writes), 0010 (playbackSlot/peaksSlot), 0013 (restart-with-start-offset seek), 0014
  (disk-cached background peak batch), 0015 (release-commit scrub).
- **License header**: not needed — the new file is under `docs/`, outside `app/` (the MIT
  side); the `app/electron/licensing.test.ts` structure guard is unaffected because no app
  source file is added.

## Non-goals

- Any coupling to, or change of, the experimental DAW workspace (`dawWorkspaceEnabled`) — the
  issue explicitly forbids touching it, and the shipped epic did not.
- Wiring the Soundcheck waveform into the live-capture peak stream
  (`window.dawWaveformState`, `stream.py`) — the Soundcheck peaks are a static-file,
  disk-cached generation path (ADR-0014).
- Any feature work beyond the shipped real scrubbing (no parallel multi-story factory effort
  on this live-production tool; queued behind epic #723 per the issue).
- Re-implementing or re-queueing any of the four already-merged sub-issues (#733/#734/#735/#736)
  — forbidden by ADR-0018.
- Changing the e2e suites or any product behavior — this PR only records the completion
  evidence; hands-on-service verification was documented in each sub-issue PR and the e2e
  suites now pin the behavior.
