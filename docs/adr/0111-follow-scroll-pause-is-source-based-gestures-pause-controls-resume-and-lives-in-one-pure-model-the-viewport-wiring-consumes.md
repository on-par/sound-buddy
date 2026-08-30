# Follow-scroll pause is source-based — gestures pause, controls resume — and lives in one pure model the viewport wiring consumes

- Status: Accepted
- Date: 2026-08-30

## Context

The Session arrangement gained an overview strip (#1282), fit/zoom controls (#1284) and a
ruler scrub zone (#1285); #1283 will wire real horizontal scroll and zoom gestures to the
visible range, at which point an automatic "chase the playhead" behaviour and the user's own
navigation are in direct competition — the classic DAW problem Ableton solves with its Follow
switch. Two questions had to be settled before either side is written. First, what counts as
"manual" — the same visible-range change can arrive from a trackpad gesture or from a toolbar
button, and treating them alike would make a fit-full click pause the very follow behaviour
the user pressed it to re-establish. Second, where the state lives — ADR-0109 pins the visible
range as a seconds-only model that does not resolve to pixels until scroll exists, and ADR-0005
pins animation-rate playback updates as imperative DOM writes that bypass React state, so a
follow implementation that re-rendered React every frame to chase the playhead would violate
it. The pause/resume state machine was explicitly split out of #1283 into #1286 so the policy
is settled and unit-tested before any viewport code depends on it.

## Decision

Follow-scroll's pause policy is decided by the SOURCE of an interaction, not by the kind of
view change it produces. Pointer/wheel gestures over the timeline column ('manual-scroll' for a
horizontal delta, 'manual-zoom' for a ctrl/meta-modified wheel — what a macOS trackpad pinch
reports) pause follow; a pure vertical wheel is lane scrolling, not time navigation, and never
pauses. Every control-driven action resumes: Play, Return-to-start, a committed scrub seek, and
every fit/zoom toolbar button (fit-full, zoom-in, zoom-out, zoom-to-selection, zoom-back). The
whole policy lives in app/renderer/src/timeline-follow-scroll.ts as one pure reducer
applyTimelineFollowEvent over a two-field model (following + the pause cause) plus the pure
wheel classifier timelineFollowEventForWheel — no follow decision may be re-derived inline in a
handler or duplicated into a gesture module. The model is local React view state in
LiveCapturePanel beside timelineZoom (#1284's precedent): it is navigation, not capture or
session data, and is neither stored nor persisted. A Follow toggle in the Session toolbar
renders the state and is itself an explicit resume. The paged-follow derivation
timelineFollowRange(model, range, ctx) is pure and expressed in seconds only (ADR-0109): while
paused it returns the caller's range unchanged, and while following it pages the range so a
playhead outside it lands on the left edge, span preserved and clamped to the duration.
#1283's viewport wiring calls that function per animation frame and applies the result
imperatively (ADR-0005) — it must not invent its own auto-scroll, and it must feed its gestures
through applyTimelineFollowEvent rather than reading or writing the follow flag directly.

## Consequences

Positive: the "who is driving the view" question has exactly one answer in one unit-tested pure
module, so #1283 can wire scroll to the viewport without re-litigating it; the source-based rule
means a user's fit-full or zoom-to-selection click never leaves follow mysteriously off; the
paused/following state is visible and directly resumable from the toolbar instead of being an
invisible mode. Negative: until #1283 lands, follow has no viewport to move, so this slice's
user-visible behaviour is the toggle's state alone — the paging derivation ships unit-tested but
unused, which is deliberate and named here rather than discovered later. A wheel that is
simultaneously horizontal and modifier-held is classified as a zoom, which is a judgement call
the classifier makes in one place if it ever needs revisiting.

## References

- [ADR-0109 — The Session timeline's visible range is a seconds range; it does not resolve to pixels until scroll exists](docs/adr/0109-the-session-timeline-s-visible-range-is-a-seconds-range-with-a-single-slot-zoom-back-memory-it-does-not-resolve-to-pixels-until-scroll-exists.md)
- [ADR-0005 — Discrete spectrum state in the store, animation-rate playback updates straight to the DOM](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
- [ADR-0110 — The Session ruler is a scrub zone that starts playback when stopped; lanes stay playing-only](docs/adr/0110-the-session-ruler-is-a-scrub-zone-that-starts-playback-when-stopped-lanes-stay-playing-only.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/1286)
- [Issue](https://github.com/on-par/sound-buddy/issues/1283)
