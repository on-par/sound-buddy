# The arrangement's accessibility state is a hidden, non-live status group painted by the shell runtime

- Status: Accepted
- Date: 2026-08-31

## Context

The Session arrangement models four independent states — playhead, insert marker,
clip selection and time-range selection (#1301, #1303, #1304) — and every one of
them reached the user through pixels alone: empty, unlabelled `.daw-playhead`,
`.daw-insert-marker` and `.daw-time-selection` spans plus a lane class. #1306 asks
for an accessible representation of all four with no new visible instructional copy.

The obvious shape — one `aria-live="polite"` region announcing "the state that just
changed" — collides with ADR-0005 and with how the arrangement actually paints.
`renderPlayhead` runs inside a requestAnimationFrame loop during playback and
recording; it is the single writer of the shared playhead mark and it already calls
`renderInsertMarker` every frame. Any label painted on that path inside a live
region would fire a screen-reader announcement up to sixty times a second, which is
worse for the user than the silence it replaces. The acceptance criteria are also
explicit that the trigger is a screen reader *inspecting* the arrangement, not being
interrupted by it.

The second force is module shape. `daw-shell-runtime.ts` is imported by
`timeline-scale.ts`, so anything the runtime itself imports must not reach back into
the scale — the reason `clip-selection.ts` and `time-selection.ts` were deliberately
built as leaf modules that import nothing. The natural time formatter,
`formatRulerElapsed`, lives in `timeline-ruler-labels.ts`, which imports
`timeline-scale.ts`, and is therefore unreachable from a module the runtime imports.

## Decision

The arrangement's accessible state ships as a visually-hidden `role="group"` region,
`.daw-arrangement-a11y`, emitted by `dawShellHTML` as the last child of
`.daw-arrangement`, holding one span per state. It carries no `aria-live`,
`role="status"` or `role="alert"`, and no future change may add one: the region is
inspected, never announced. `daw-shell-runtime.ts`'s `renderAccessibilityLabels()`
is the region's single writer; it derives all four strings from the pure, leaf
`timeline-accessibility-labels.ts` and writes a span only when that span's text
actually changed, so the per-frame playhead path performs at most one DOM write per
whole second.

`timeline-accessibility-labels.ts` imports nothing, following `clip-selection.ts`
and `time-selection.ts`. Its `formatAccessibleTime` is a hand-duplicated m:ss
formatter rather than an import of `formatRulerElapsed`, and a drift test pins the
two to identical output over a fixed fixture set — the ADR-0011 pattern.

The painted affordances (`.daw-playhead`, `.daw-insert-marker`,
`.daw-time-selection`) are marked `aria-hidden="true"`: pixels stay pixels, and the
hidden region is the one place the arrangement speaks.

## Consequences

Positive: a screen reader or accessibility inspector can read all four states at any
time, as four distinct strings, and the representation is painted from the same
shared models as the pixels, so it cannot drift from what is on screen. Playback
generates no announcement storm. No visible copy is added, so the Ableton-style
chrome is unchanged. The label logic is a pure function, unit-tested with no DOM.

Negative: state changes are not proactively announced — a user who moves the insert
marker must navigate to the region to hear the new position. If a future story wants
change announcements, it must introduce a *separate* live region fed only by
discrete events (clicks, drags, session load), never by the rAF playhead path, and
supersede this ADR explicitly. The duplicated time formatter is a second place m:ss
is spelled out, kept honest only by its drift test.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1306)
- [ADR-0011 — hand-duplicated, drift-tested pure predicate](https://github.com/on-par/sound-buddy/blob/main/docs/adr/0011-isaborterror-stays-a-hand-duplicated-drift-tested-pure-predicate-instead-of-routing-through-the-bundled-cjs-loader.md)
