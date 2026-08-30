# The Session ruler is a scrub zone that starts playback when stopped; lanes stay playing-only

- Status: Accepted
- Date: 2026-08-30

## Context

ADR-0015 shipped Session scrubbing as "preview live, commit one seek on pointer
release", and gated the whole interaction on the soundcheckStore `playing` flag —
correct then, because the gesture existed only to move an already-running playback
and the only duration available was the backend progress tick. Issue #1285 asks for a
ruler-level scrub zone that jumps playback to a time "without any track or clip being
selected", which includes the stopped case: with the playing gate in place, a click on
the ruler of a loaded-but-stopped session does nothing, and the only way to reach a
time is Play-from-zero followed by a drag. docs/design-reference.md names Ableton Live
as the interaction model, where the arrangement's scrub area plays from the clicked
point. Two forces push back: seeking is restart-with-start-offset (ADR-0013), so an
accidental click costs a child restart and audible output in a live room, and a
stopped session has no progress tick to clamp the pointer time against.

## Decision

The ruler (.daw-ruler) is a scrub zone whose gesture may begin and commit whenever a
session manifest is loaded, whether or not playback is running; a commit while stopped
starts playback at the clicked time through the existing seekTo /
startPlayback-with-startOffsetSecs path. The lane surface (.daw-lane) keeps ADR-0015's
playing-only gate, and no scrub of either kind begins while a live capture is in record
mode. ADR-0015's commit-on-release policy is untouched — a click is still the degenerate
case of one release-commit, and there is still exactly one startPlayback call per
gesture. The clamp duration resolves in one place (session-ruler-scrub.ts's
sessionScrubDurationSecs): the backend progress tick, then the longest painted take
clip, then session.json's frames/sampleRate; with none of the three the scrub refuses to
start rather than seeking against a guessed duration. Pointer-to-time keeps going
through soundcheckTimelinePreviewFromPointer at the shared SESSION_TIMELINE_SCALE
(ADR-0100/ADR-0101) — the #1284 visible range stays seconds-only until scroll exists
(ADR-0109).

## Consequences

Positive: reaching a time in a loaded take is one gesture on the ruler with nothing
selected, matching the Ableton scrub-area model, and every gate/duration decision is a
pure, unit-tested function rather than a condition buried in a delegated pointer
handler. Negative: a stray ruler click on a loaded session now produces audio and one
playback child restart where it previously did nothing — accepted because the record-mode
block keeps it out of a take in progress and the loaded-session requirement keeps it out
of an idle app. If in-process seeking (ADR-0013 approach b) ever lands, this zone
relaxes to per-move commits with no change to the gate or the duration chain.

## References

- [ADR-0015 — Soundcheck scrub commits seeks on pointer release, not per pointer-move](docs/adr/0015-soundcheck-scrub-commits-seeks-on-pointer-release-not-per-pointer-move.md)
- [ADR-0013 — Playback seeking ships as restart-with-start-offset; in-process seek stays deferred](docs/adr/0013-playback-seeking-ships-as-restart-with-start-offset-in-process-seek-stays-deferred.md)
- [ADR-0109 — The Session timeline's visible range is a seconds range; it does not resolve to pixels until scroll exists](docs/adr/0109-the-session-timeline-s-visible-range-is-a-seconds-range-with-a-single-slot-zoom-back-memory-it-does-not-resolve-to-pixels-until-scroll-exists.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/1285)
