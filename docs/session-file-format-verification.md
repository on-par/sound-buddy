# Captured-session file format verification (#1296)

This is the record that the Session timeline alignment epic (#1259 → parent #1267) changed
nothing about what Sound Buddy persists for a captured session, plus the standing gate that keeps
the next geometry change from being able to change it silently.

## Why this exists

Sound Buddy writes exactly one durable customer artifact per recording: a session folder holding
PCM_24 stem WAVs and a `session.json` manifest emitted by
[`packages/audio-engine/scripts/stream.py`](../packages/audio-engine/scripts/stream.py)'s
`write_session_manifest`. Customers re-open those folders in Virtual Soundcheck and the Session tab
weeks later, so the format is a compatibility surface, not an implementation detail. The Session
timeline epic was the largest body of work ever to land next to the session reader
([`app/electron/ipc/playback.ts`](../app/electron/ipc/playback.ts)'s `read-session` handler), so this
document answers, with commands and their real output, whether any of that geometry work leaked into
the on-disk format. See
[ADR-0126](./adr/0126-the-captured-session-file-format-is-pinned-by-an-exact-serialization-golden-test-and-every-format-change-appends-to-a-written-verification-record.md)
for the decision this record backs.

## What counts as "session file format"

| Artifact | Shape |
| --- | --- |
| `session.json` | `name`, `createdAt`, `sampleRate`, `tracks[]` where each track is `id`, `label`, `kind`, `sourceChannels`, `file`, `frames` |
| Stem WAVs | PCM_24, 1ch (mono) or 2ch (stereo), at the session's `sampleRate` |
| Session folder contents | Exactly the stem WAVs plus `session.json` — no other file |

Two adjacent things are explicitly **not** session file format and are out of scope, though both
were checked below and neither changed:

- The Soundcheck peaks cache under `app.getPath('userData')/soundcheck-peaks` (ADR-0014) is a
  regenerable derived cache, not session data.
- `settings.json` is app preferences, not a per-session file.

## The before/after comparison (#1296's acceptance criterion)

Two base commits bound the epic:

- **Epic base commit `7790e1d`** (`docs: add Ableton DAW timeline gauntlet (#1261)`, 2026-08-30) —
  the commit immediately before `c8dfd23` (`feat(renderer): introduce shared timeline scale model
  with zoom states (#1268)`), the first commit of epic #1259.
- **Parent #1267 (alignment series) base commit `894631b`** (`Preserve the loop range when returning
  to start (#1318) (#1324)`) — the parent of `4339add` (#1325).

Command run against the persistence surface, from `7790e1d` to `HEAD` of this branch:

```bash
git diff --stat 7790e1d..HEAD -- \
  packages/audio-engine/scripts/stream.py \
  packages/audio-engine/scripts/playback.py \
  packages/audio-engine/scripts/waveform_peaks.py \
  app/electron/settings.ts \
  app/electron/ipc/live-capture.ts \
  app/electron/ipc/playback.ts \
  app/electron/ipc/waveform-peaks.ts \
  app/tests/fixtures/session
```

Output: **empty** — every file on the persistence surface is byte-identical across the entire epic.

Findings from reading the epic's commits on this range:

- The only main-process change anywhere in the epic is `#1294`'s test hook:
  `ipcMain.handle('test-hooks-enabled', …)` in `app/electron/ipc/settings.ts`, its
  `areTestHooksEnabled` bridge in `app/electron/preload.ts`, and the matching `AppInfoApi` method in
  `app/electron/ipc/api.ts`. It reads `process.env.SOUND_BUDDY_TEST_HOOKS`, adds no `AppSettings`
  field and no `SETTING_SPECS` entry, and writes nothing to `settings.json` or to any session folder.
- The only new `fs.writeFileSync` call added anywhere in the epic is in
  `app/tests/e2e/timeline-default-scale-visual.spec.ts` (#1295), which writes a PNG test artifact into
  the Playwright output dir — not a session folder.

## The standing gate

The format is now pinned so a future change cannot alter it silently:

- **`SessionManifestFormatContract`** in
  [`packages/audio-engine/scripts/test_stream.py`](../packages/audio-engine/scripts/test_stream.py) —
  asserts the exact serialized text of `session.json` against a golden literal (2-space indent, no
  trailing newline, pinned key order at both levels), asserts `sampleRate`/`frames` serialize as JSON
  integers even when fed numpy scalars, asserts `file` paths stay directory-relative, and exercises the
  `os.path.normpath` fallback when `session_dir` has a trailing separator.
- **`test_no_new_persisted_artifacts_beside_the_stems_and_manifest`** in the existing
  `SessionRecording` class — asserts a finalized session folder's contents are exactly its stem WAVs
  plus `session.json`.
- **A real-fixture `read-session` case** in
  [`app/electron/ipc/playback.test.ts`](../app/electron/ipc/playback.test.ts) — drives the on-disk e2e
  fixture (`app/tests/fixtures/session`, the fixture every Session-timeline e2e spec loads) through the
  real handler and asserts every track carries only writer-emitted keys, all relative.

Commands:

```bash
./scripts/verify.sh --no-e2e
./.venv/bin/python3 packages/audio-engine/scripts/test_stream.py   # fall back to python3 if there is no venv
npm test --prefix app -- app/electron/ipc/playback.test.ts
```

## Manual verification with a real rig

A human with a physical input device can get a literal before/after file diff:

```bash
git worktree add ../sb-before 7790e1d
cd ../sb-before/app && npm run dev   # record a short session, note the armed channels
cd -                                  # back to this checkout
cd app && npm run dev                 # record the same channels on the same device
diff \
  <(jq -S 'del(.name, .createdAt) | .tracks |= map(del(.frames))' ../sb-before/<session-dir>/session.json) \
  <(jq -S 'del(.name, .createdAt) | .tracks |= map(del(.frames))' <session-dir>/session.json)
ffprobe <session-dir>/01-*.wav   # or soxi — compare subtype, channel count, sample rate per stem
```

`name`, `createdAt` and `frames` are expected to differ between two independent recordings (folder
name, wall-clock timestamp, and take length) and are excluded from the diff above so a reviewer does
not mistake them for a format change; every other field should diff clean.

## Pass criteria

- The `git diff --stat` above is empty over the persistence surface.
- `./scripts/verify.sh --no-e2e`, the Python test file, and `playback.test.ts` are all green.
- If the manual real-rig diff is run, it shows differences only in `name`, `createdAt` and `frames`.

## Result record

| Date | Commit range | How it was verified | Result |
| --- | --- | --- | --- |
| 2026-08-31 | `7790e1d..HEAD` (branch `ship-it/1296-verify-session-timeline-alignmen`, BUILD pass for #1296) | **Machine-verified**: `git diff --stat 7790e1d..HEAD -- <persistence surface>` produced empty output (pasted above). `python3 packages/audio-engine/scripts/test_stream.py -v` — 93 tests, all `ok`, including the 5 new `SessionManifestFormatContract` cases and the new `SessionRecording` no-new-artifacts case. `npm test --prefix app -- electron/ipc/playback.test.ts` — 28 tests, all passed, including the new real-fixture `read-session` case. **Not run**: the real-rig manual diff — this pass has no physical input device or PortAudio access; the procedure above is for a human with a rig. | Format unchanged; standing gate added. |

A future format change appends a new row to this table stating what changed and how old sessions
still load, and updates the golden literal in `SessionManifestFormatContract` in the same PR — see
ADR-0126.
