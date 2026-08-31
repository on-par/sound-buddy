# The captured-session file format is pinned by an exact-serialization golden test, and every format change appends to a written verification record

- Status: Accepted
- Date: 2026-08-31

## Context

Sound Buddy writes exactly one durable customer artifact per recording: a session folder holding
PCM_24 stem WAVs and a session.json manifest emitted by
packages/audio-engine/scripts/stream.py's `write_session_manifest`. Customers re-open those folders
in Virtual Soundcheck and the Session tab weeks later, so the format is a compatibility surface, not
an implementation detail — a silently added, renamed, or reordered field is a customer-data problem,
not a test problem. Until now nothing guarded it: the existing test_stream.py cases assert a
top-level key SET and a few values, which passes unchanged if a field is added, if key order flips,
or if sampleRate starts serializing as 48000.0 because a numpy scalar leaked in. The Session timeline
epic (#1259/#1267) made that gap concrete — a large body of geometry work landed next to the session
reader, and the only way to answer "did this change what we write to disk?" was to read every commit
by hand. The obvious automated answer (record a session before and after, diff the folders) cannot
run in CI: it needs PortAudio and a real input device, and the manifest carries a wall-clock
createdAt and a directory-derived name, so two real recordings never diff clean. A JSON Schema would
accept any key order and would add a dependency to a Python runtime deliberately held to numpy +
soundfile + sounddevice (ADR-0015).

## Decision

packages/audio-engine/scripts/test_stream.py owns a `SessionManifestFormatContract` test class that
calls `write_session_manifest` directly and asserts the file's exact serialized TEXT against a golden
literal in the test body — 2-space indent, no trailing newline, top-level key order
name/createdAt/sampleRate/tracks, per-track key order id/label/kind/sourceChannels/file/frames, and
integer-serialized sampleRate and frames. A companion case asserts a finalized session folder
contains exactly its stem WAVs plus session.json, so no new persisted artifact can appear beside them
unnoticed. The e2e fixture app/tests/fixtures/session/session.json is held to the same key contract
through the real `read-session` handler in app/electron/ipc/playback.test.ts, so a spec can never be
made to pass by inventing a manifest field. The golden literal is written by hand from the intended
format, never regenerated from the writer's current output. Changing the captured-session format is
therefore always a deliberate two-part act: update the golden literal in the same PR as the writer,
and append a dated row to docs/session-file-format-verification.md stating what changed and how old
sessions still load. Verifying that a change did NOT alter the format is answered by running this
gate plus the documented persistence-surface `git diff`, not by re-recording sessions.

## Consequences

Positive: the customer-facing artifact gets a deterministic, dependency-free, always green-or-red
gate that runs on any host with numpy — including hosts with no audio device — and catches the whole
silent-drift class (added field, reordered keys, float leakage, a new sidecar file, a doctored
fixture). "Did this change the session format?" becomes a one-command question instead of a
commit-by-commit read. The verification record gives future format changes a migration-compatibility
paper trail. Negative: the golden literal is a hand-written duplicate of the writer's dict, so an
intentional format change costs a second edit, and a careless author can make a real regression green
by pasting the writer's new output over the literal — reviewers must treat a changed golden literal as
a format change requiring a record entry, which is the cost this ADR deliberately accepts. The
exact-text assertion is also strict about whitespace, so switching json.dump's indent or separators is
a breaking change by construction; that is intended, since those bytes are what customers' files
contain.

## References

- [Issue #1296](https://github.com/on-par/sound-buddy/issues/1296)
- [ADR-0015 — Audio-engine DSP stays numpy-only; the packaged Python runtime carries no scipy](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0015-audio-engine-dsp-stays-numpy-only-the-packaged-python-runtime-carries-no-scipy.md)
- [ADR-0124 — Timeline alignment is proved by one DOM-geometry e2e spec, never by screenshots](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0124-timeline-alignment-is-proved-by-one-dom-geometry-e2e-spec-never-by-screenshots.md)
