# Soundcheck per-track waveform peaks ship as a disk-cached, background Python batch with one combined lane per track

- Status: Accepted
- Date: 2026-08-14

## Context

Soundcheck (epic #732) needs per-track waveform data computed from already-recorded stem WAVs, but the only existing waveform machinery is stream.py's live peak-frame stream, which resets on every capture Start and has no path for a loaded session. The bucket-encoding technique is already decided by ADR-0004 (u8-quantized min/max, interleaved bytes, base64 — encode_frame_b64, WAVEFORM_BUCKETS_PER_SEC=50), and ADR-0010 already decided that any Python child-process lifecycle routes through createPythonStreamSlot. What ADR-0004/0010 did NOT decide: whether the static-file generation runs synchronously on session load or as a background/cached step; where the result is cached; how a stereo stem maps to lanes; and the IPC/DTO contract the renderer and the story-3 rendering build against. These are cheap to ship either way but expensive to change once story 3 renders from the shape. Full-length decode is inherently minutes-scale (a 60-min, 32-track session is ~5.5B samples / tens of GB through soundfile), so synchronous generation is out. The app treats user-chosen session folders as read-only data, so the cache must not be a session-dir sidecar.

## Decision

Soundcheck peak generation ships as waveform_peaks.py (a production counterpart to the #519 spike), invoked in the background by a generate-session-peaks IPC handler after a session is loaded. The script decodes each stem in bounded blocks, emits one combined min/max lane per track (stereo folds L/R per bucket), quantizes to u8 and base64-packs interleaved min/max bytes at 50 buckets/sec, and writes the JSON document to --out. The app caches the document under app.getPath('userData')/soundcheck-peaks, keyed by session dir, and reuses it while it is newer than session.json and every stem file. The IPC contract is generateSessionPeaks(sessionDir) resolving { success: true, cached, peaks: SessionPeaksDto } or { success: false, error }.

## Consequences

Loads never block on decode; reloads of the same session are instant via cache; the renderer store holds a typed SessionPeaksDto that story 3 renders directly. Stereo tracks show one lane rather than two, and each track's bucketCount reflects its own length. The cache is app-owned (no writes into user session folders) at the cost of a small userData footprint; a session whose stem files are modified without session.json changing may serve stale peaks until the cache is invalidated; and the first load of a long session waits minutes for peaks to be ready (the UI shows the loaded manifest immediately and receives peaks asynchronously).

## References

- [ADR-0004 — Real-time waveform peak transport for live capture](docs/adr/0004-waveform-peak-transport.md)
- [ADR-0010 — Python child-process stream lifecycle](docs/adr/0010-python-child-process-stream-lifecycle-is-owned-by-one-deep-module-never-re-copied-per-domain.md)
- [Issue #734](https://github.com/on-par/sound-buddy/issues/734)
