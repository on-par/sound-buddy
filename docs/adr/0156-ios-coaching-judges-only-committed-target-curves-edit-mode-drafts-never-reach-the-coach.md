# iOS coaching judges only committed target curves; edit-mode drafts never reach the coach

- Status: Accepted
- Date: 2026-09-26

## Context

#1558-#1560 made the Analyze target curve editable in place. updateTargetDraft rebuilt
BandDeviationCoach on every drag step and preset tap, and ingest() kept refreshing the coaching
stack and problem pulses once a second. So the hints were judged against a curve still under the
user's finger, and they jumped around and misled. Before, the invariant was "the drawn line and
the coach always agree". That invariant has to relax during editing without letting a discarded
(Cancel) draft ever affect coaching.

## Decision

AnalyzeModel's coach is built only from a resolved target: at init, and in apply() when
commitTargetEdit or cancelTargetEdit resolves the editor. updateTargetDraft moves only the drawn
target (target, targetIsAuto, rtaTargetOffsets), never the coach. While isEditingTarget is true
(exposed as isCoachingFrozen), ingest() does not refresh `coaching` or `problemMarkers`. Both edit
exits clear lastCoachingAt so the next reading refreshes coaching immediately against the resolved
curve. A committed dragged curve (id TargetCurveHandles.customId) is kept in memory as the
session's Custom target (sessionCustomTarget). It is never persisted or synced by this decision.

## Consequences

Coaching output is stable during editing, and Cancel provably can't affect it. During editing the
drawn line and coachingCurve intentionally differ. The invariant "overlay and hints agree" now
holds only outside edit mode, and tests assert that split. Any future draft-producing edit path
(new gestures, presets, undo) must go through updateTargetDraft and must not rebuild the coach. The
Custom curve is lost when the app is terminated until a persistence policy is decided.

## References

- [Issue #1561 — freeze coaching during curve edits](https://github.com/on-par/sound-buddy/issues/1561)
- [ADR-0155 — iOS target-curve handle drags](0155-ios-target-curve-handle-drags-edit-the-48-point-offsets-with-raised-cosine-blending-and-hold-the-level-match-shift-for-the-duration-of-a-drag.md)
