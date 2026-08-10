# Live-session controls relocate into the spectrum panel; Settings dialog composes moved controls directly, not via portals

- Status: Accepted
- Date: 2026-08-10

## Context

#tab-live's left column mixed two kinds of controls: static per-week setup (rig, device,
measurement source, secondary device, meter cadence, record folder) and per-session live
controls (Monitor/Record mode, Start/Stop/Record transport, preflight, capture status).
Epic #723 moves the first group into Settings → Audio (this story, #727) and leaves the
second group's own redesign — a persistent top transport bar — to #729, which depends on
#728 (auto-start monitoring). #729's own issue text states the left column is "removed by
#727", so #727 cannot leave a column-shaped placeholder behind; but #729 hasn't landed yet,
so the per-session controls need a working, unredesigned home for the interval between
#727 and #729 shipping.
Separately: root-markup.html's per-control island divs (rig-controls-island,
secondary-measurement-island, capture-cadence-island) exist as static HTML specifically so
React can createPortal onto them before boot scripts finish — but the Settings dialog
(#settings-dialog) has no such static per-control markup; it's a single React component
(SettingsPanel.tsx) that already renders 100% of its own contents as JSX. Adding new static
island divs solely to preserve the portal pattern there would be pure indirection with no
purpose once every source is already a React component.

## Decision

1. Rig picker, device+refresh, measurement source, secondary measurement device, and
   meter-rate/window-secs sliders (RigControls, LiveSourceSettings [new, split out of
   LiveControls], SecondaryMeasurementPanel, CaptureCadenceControls) are rendered as
   direct JSX children inside SettingsPanel.tsx's #settings-pane-audio — no createPortal,
   no island divs. SettingsPanel takes a `booted: boolean` prop (passed from App.tsx) to
   gate these four subcomponents' mount timing, replacing the {booted && createPortal(...)}
   guard those components previously got for free from App.tsx.
2. The #tab-live DOM node (Pro gate, Mode toggle, preflight, transport, status/offer rows)
   relocates as a whole, unmodified unit from inside <aside id="source-panel"> to the top
   of <section id="spectrum-panel">, keeping its id/class so the existing `.tab-content`
   active-sweep (mode-switch.ts) and `body.not-pro #tab-live` Pro-gate CSS need no changes.
   mode-switch.ts's switchMode() adds `body.classList.toggle('live-active', mode ===
   'live')`; app.css adds `body.live-active #source-panel { display:none; }`, mirroring the
   existing `body.rc-active #source-panel` rule. #spectrum-panel's existing `flex:1` then
   claims the freed width with no further CSS.
3. Any future story (#729) that redesigns Mode/transport into a persistent top bar changes
   only the contents/position of this relocated #tab-live node (or replaces it outright) —
   it does not need to touch #source-panel, the other five tabs that share it, or the
   Settings-owned controls from this story.

## Consequences

Positive: Settings composition has zero indirection — adding, removing, or reordering a
control in Settings → Audio is a one-line JSX change, not a two-file (markup + portal)
change. #source-panel's collapse is driven by the same body-class pattern already used for
Report Card, so there's exactly one pattern to learn for "this tab hides the left column."
#729 inherits a working, already-relocated Mode/transport surface to redesign in place
rather than having to first solve where it lives.
Negative: SettingsPanel now has a `booted` dependency it didn't have before, coupling it
(weakly) to App.tsx's boot sequencing — a future contributor adding another Settings-tab
control that itself needs boot-ready globals must remember to gate it, since the compiler
won't catch a missing `booted &&`. The #tab-live relocation makes root-markup.html's
structure a bit less self-explanatory (a `.tab-content` living inside `#spectrum-panel`
instead of `#source-panel` is a genuine exception to the pattern every other tab follows) —
left documented via HTML comments at both the old and new locations.

## References

- [Epic #723 — Decouple Live-tab Source panel into Settings](https://github.com/patrob/sound-buddy/issues/723)
- [#729 — Promote Record to a persistent top transport bar](https://github.com/patrob/sound-buddy/issues/729)
- [Issue #727](https://github.com/on-par/sound-buddy/issues/727)
