# Loop enablement lives in soundcheckStore.looping; the loop region model stays enablement-free

- Status: Accepted
- Date: 2026-08-31

## Context

#1313 landed the loop brace as a render-only affordance: `sessionLoopRegion`
(loopBrace.render.ts) holds the range, and `dawShellHTML` emitted the brace whenever a
recorded session was loaded — deliberately "gated by availability, not the looping enable
flag", with a test pinning that. #1314 has to make the existing Session-toolbar Loop button
show and hide the brace while preserving the range across toggles.

There were two places the "is looping on" bit could live. `soundcheckStore.looping` already
existed (it is what `toggleLoop()` flips and what renders the button's `aria-pressed`), but
it drove nothing else. The alternative was to give `LoopRegionModel` its own
`enabled`/`setEnabled` pair and hide the brace from inside `renderLoopBrace`. That second
option would have created two independent booleans for one user-visible state, and the
button's pressed state and the brace's presence would then be free to disagree — precisely
the drift the shell's other affordances (playhead, insert marker, time selection) avoid by
painting every surface from one shared model.

Range preservation across a toggle also needed a home. Storing "the range" inside an
enablement-aware object invites a future slice to clear it on disable; keeping the two
concerns in separate objects makes preservation structural rather than a rule someone has to
remember. The remaining question was how the brace should hide: remove it from the markup, or
keep it and flip `display` from the painter. `playheadVisible` in `dawShellHTML` already
establishes markup-level gating as this shell's convention, and removing the element also
removes the (soon draggable) handles from the hit-testing surface for free.

## Decision

`soundcheckStore.looping` is the single source of truth for whether the arrangement loop is
enabled. `dawShellHTML` emits the `.daw-loop-brace` span (and its handles) only when
`loopBraceVisible(state.sessionPlayback)` is true — a loaded session AND looping on — so
switching Loop off removes the brace from the DOM rather than hiding it from the painter.

`LoopRegionModel` never gains an enabled/disabled concept. It owns the range and one extra
piece of state: a `seeded` flag, set by `setRegion` and cleared by `resetForSession`, that
lets `applyDefaultIfUnseeded(region)` place a default range the first time looping is
switched on for a session and leave every later toggle alone. Because the model knows nothing
about enablement, the range survives a toggle-off by construction.

The toggle's two policies — visibility derivation and what "a sensible default" is — live in
the pure leaf module `loopToggle.ts` (`loopBraceVisible`, `defaultLoopRegionFor`,
`seedLoopRegionOnToggle`), unit-tested without a DOM, so the c8-ignored delegated click
handler in `LiveCapturePanel.tsx` stays a one-line delegation. Future loop slices (drag,
resize, promoting a time selection to a loop) must call `setRegion` on the shared model and
must not reintroduce an enablement flag there.

## Consequences

Positive: the Loop button's pressed state and the brace's presence cannot disagree — they
read the same boolean. Range preservation across toggles needs no code: the model is not told
about the toggle at all. Handles leave the DOM while looping is off, so the later drag slice
gets no phantom hit targets. The default-range policy is one tested pure function rather than
a literal buried in a click handler.

Negative: #1313's "gated by availability, not the looping enable flag" tests are inverted by
this ADR, and its e2e spec must click Loop before asserting the brace — a visible churn cost
for a two-story sequence. The brace is now absent, not merely hidden, so any future code that
wants to measure the loop region from the DOM must read the model instead. And enablement
state sits in the soundcheck store while the range sits in a module-level model: two homes for
one feature, accepted because each home already owned its half.

## References

- [Issue #1314 — Toggle Loop to show/hide the brace while preserving the loop range](https://github.com/on-par/sound-buddy/issues/1314)
- [Issue #1313 — render a loop brace with start/end handles on the Session ruler](https://github.com/on-par/sound-buddy/issues/1313)
