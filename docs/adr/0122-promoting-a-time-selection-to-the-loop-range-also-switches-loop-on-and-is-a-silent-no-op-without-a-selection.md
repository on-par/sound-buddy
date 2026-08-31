# Promoting a time selection to the loop range also switches Loop on, and is a silent no-op without a selection

- Status: Accepted
- Date: 2026-08-31

## Context

#1317 adds a control that converts the arrangement's time selection
(`sessionTimeSelection`, time-selection.ts) into the loop range
(`sessionLoopRegion`, loopBrace.render.ts). Two forces shaped the design.

First, visibility. Since #1314, `loopBraceVisible` gates the brace on
soundcheckStore's `looping` flag, and loopBrace.render.ts deliberately carries
no enablement concept of its own (guarded by a test in
daw-workspace-shell.test.ts). So setting a range while Loop is off would
silently write a span the user cannot see — which fails the story's own
acceptance criterion that "the loop brace renders at that range". Ableton
Live, the interaction model in docs/design-reference.md, behaves the same
way: Loop Selection sets the brace and activates the loop.

Second, availability. The time selection lives in a leaf model, not React
state, precisely so daw-shell-runtime.ts can import it without closing an ESM
cycle. The Session toolbar markup is built once per render from
`SessionTabPlaybackView`, which knows nothing about the selection. Making the
button's `disabled` attribute track selection presence would mean subscribing
LiveCapturePanel to the selection model and re-rendering the whole board on
every selection change — a real cost for a cosmetic gain, and one that would
pull selection state into React against the grain of #1304's leaf design.

## Decision

`promoteSelectionToLoop` (app/renderer/src/loopFromSelection.ts) returns null —
writing nothing and repainting nothing — when there is no current time
selection or no loaded session. When there is one, it writes the selection's
endpoints through `LoopRegionModel.setRegion` (which marks the range seeded, so
#1314's seed-once default can never overwrite a promoted range) and reports
`enableLooping: true` when `looping` was false, which the caller honors by
calling `soundcheckStore.toggleLoop()` exactly once. Promotion never turns Loop
off.

The "Loop Selection" button in session-tab-playback.ts is enabled whenever a
recorded session is loaded and is never gated on selection presence; a press
with no selection is a deliberate, silent no-op. Future work that wants the
button to reflect selection presence must do it without moving the selection
model into React state.

## Consequences

Positive: one press gets a user from "I dragged out the span I care about" to a
visible, looping brace over that span, with no extra Loop press. The promotion
policy is a pure, fully unit-tested function with the model injected, so the
brace-visibility rule and the no-op rule are both provable without a DOM. The
selection model stays a leaf, and the panel's render cost is unchanged.

Negative: a press with no selection gives no feedback at all — the user cannot
tell the button from a broken one. We accept that for this slice rather than
pay for selection-driven re-renders; if it proves confusing, the fix is an
inline hint, not a disabled attribute. Also, promotion is a one-way, one-shot
copy: later edits to the time selection do not follow the loop range, and there
is no undo, so a promotion overwrites a hand-dragged loop range irreversibly.

## References

- [Issue #1317 — Promote a time selection to the loop range](https://github.com/on-par/sound-buddy/issues/1317)
- [Issue #1314 — Toggle Loop to show/hide the brace while preserving the loop range](https://github.com/on-par/sound-buddy/issues/1314)
