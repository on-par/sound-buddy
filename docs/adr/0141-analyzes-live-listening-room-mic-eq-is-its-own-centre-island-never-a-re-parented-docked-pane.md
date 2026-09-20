# Analyze's live-listening room-mic EQ is its own centre island, never a re-parented docked pane

- Status: Accepted
- Date: 2026-09-20

## Context

`lc-05` (#1468) made room-mic-only live listening reachable from the Analyze tab: choosing
"Listen live" starts the secondary-measurement-device state machine
(`measurement-device-state.ts`) with no board capture, no console connection, and no
`appMode: 'live'` transition. Nothing rendered the result — the only room-mic EQ in the app was
`LiveEqPane.tsx`'s docked `#live-eq-pane` aside, visible only while `appMode === 'live'` (the
Session workspace). `lc-06` (#1469, this slice) makes the EQ the primary, central element of
Analyze's live-listening state, distinct from Session's multitrack-first, docked-pane treatment.

Two ways to get there were on the table:

1. Reuse `LiveEqPane.tsx` itself — re-parent or conditionally reposition the same component so it
   renders centred when Analyze is listening instead of docked when Session is live.
2. Build a separate leaf component and a separate root-markup island for Analyze's state, sharing
   only the pure rendering helpers (`eqPaneSectionParts`/`eqPaneSectionHTML`) that already produce
   the veq arc/bars/labels markup.

`LiveEqPane.tsx` carries a lot that has nothing to do with Analyze's room-mic-only case: a
"Selected" secondary section keyed off `channelConfig`/`selectedChannel`, an inspector (Name/Mode/
Source/Arm/Playback), classification controls, and resize/drag chrome for the docked aside. All of
it assumes a board strip exists. Analyze's live-listening state has no board, no strips, and no
selection — only the room reading itself.

## Decision

Analyze's live-listening EQ is `AnalyzeLiveEqPanel.tsx`, a new leaf component portaled onto a new
`#analyze-live-island` root-markup node (a sibling of `#spectrum-imperative`/`#spectrum-island`/
`#live-island` inside `#spectrum-body`). It never imports, renders, or repositions `LiveEqPane.tsx`
or `#live-eq-pane` — the two are structurally independent, so Session's docked-pane layout and
behavior cannot regress from anything this slice does (AC2 holds by construction, not by
convention). `app.css`'s `body.analyze-listening` block hides the spectrum surfaces and gives
`#analyze-live-island` `flex:1`, mirroring `body.live-active`'s existing precedent for
`#live-island` exactly.

The two islands share rendering, not state or markup ownership: `live-capture-panel.ts` exports
one new pure function, `eqPaneRoomSectionHTML(override: EqPaneRoomOverride)`, wrapping the already-
private `eqPaneSectionParts`/`eqPaneSectionHTML` helpers `eqPaneHTML` (the docked pane's renderer)
already uses — the same veq arc/bars/labels output, reused by export instead of by copy, with a
`'analyze-room'` SVG uid distinct from the docked pane's `'pane-a'`/`'pane-b'` so element ids never
collide between the two islands.

Visibility is gated by `analyzeEntryStore.listening` — a new explicit boolean, set only by
`listenLive()`'s `startListening` branch and cleared only by a new `stopListening()` action —
never inferred from `secondaryMeasurement.status === 'active'`, which is also true when a room mic
is started from Settings during an unrelated Session capture. `analyzeLiveEqView` (new pure module
`analyze-live-eq.ts`) folds `{listening, appMode, secondary, override}` into `hidden | notice |
room`; a `room` view is reachable only from `secondary.status === 'active'` with override data
present, so a `disconnected` (or `blocked`/`starting`/`off`) secondary source always falls through
to `notice` instead of rendering the last override it ever had — the no-frozen-curve requirement
(AC3) is structural, not a convention future code has to remember to preserve.

## Consequences

Positive: Session's docked pane is untouched by this slice — no shared component, no shared root-
markup node, no shared body-class rule — so there is no regression surface for AC2 to violate.
The veq rendering itself (the actual analyzer visuals) is guaranteed to look identical between the
two islands because both call the same private helpers through their own thin public wrapper
(`eqPaneHTML` for the docked pane, `eqPaneRoomSectionHTML` for Analyze's), rather than two
independently-maintained copies drifting apart over time. The `hidden | notice | room` fold makes
the disconnected-state requirement a type-level guarantee: there is no code path that can carry a
stale `override` into a rendered arc once the status leaves `active`.

Negative: two islands now exist for "one room-mic reading," which is duplicate DOM/CSS scaffolding
(`#analyze-live-island` + `body.analyze-listening` alongside `#live-island` + `body.live-active`) a
single conditionally-repositioned component would have avoided. A future slice that wants Analyze's
EQ to gain inspector-style controls (channel labeling, playback routing) cannot lift them from
`LiveEqPane.tsx` — it must build them fresh in `AnalyzeLiveEqPanel.tsx`, since the two are
deliberately not sharing state or markup ownership beyond the pure veq renderer. Any future code
touching this surface must keep using `eqPaneRoomSectionHTML` (never reuse `LiveEqPane` or
`#live-eq-pane`), must keep deriving visibility from `analyzeEntryStore.listening` (never infer it
from secondary-source status), and must not add a meter-rate field to `AnalyzeLiveEqPanel`'s
`useStoreShallow` selector — `lastMeasurementChannels` is read imperatively at render time
(ADR-0005/ADR-0135), the same convention `LiveAdjustmentsPanel.tsx` and `LiveEqPane.tsx` already
follow for their own animation-rate reads.

## References

- [Issue #1469](https://github.com/on-par/sound-buddy/issues/1469)
- [Issue #1468 — lc-05, Analyze tab gains a "Listen live" entry point](https://github.com/on-par/sound-buddy/issues/1468)
- [ADR-0005](./0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md) (discrete state in the store, animation-rate updates straight to the DOM)
- [ADR-0135](./0135-live-window-ticks-never-enter-the-board-shell-s-render-selector.md) (a window/meter-rate value gets its own leaf with its own subscription)
- [Epic #1462](https://github.com/on-par/sound-buddy/issues/1462) (`line-check-calibration`)
