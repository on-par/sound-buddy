# The DAW tab merges Live and Soundcheck; an in-tab transport drives the timeline (supersedes ADR-0014)

- Status: Accepted
- Date: 2026-08-20

## Context

ADR-0014 (2026-08-14) froze the Live tab as permanently monitor-mode: no
Monitor/Record toggle, no preflight screen, and — explicitly — "no in-tab
start/stop transport ... may ever be reintroduced into `#tab-live`". #757
deleted the in-tab controls and made the persistent top-bar Record button
the sole capture transport. That decision was right for what the tab was:
a single live-capture timeline, where a second Start/Stop control was a
redundant parallel path with its own gated preflight.

Separately, Virtual Soundcheck (#46, epic e732) shipped a second surface
that already carries everything a playback timeline needs — `playback.py
--start-at` seeking (ADR-0013), disk-cached per-track waveform peaks
(ADR-0004 and the e732 peaks ADR), stacked per-track lanes with a
release-commit scrub playhead (ADR-0015), route hot-swap over an NDJSON
stdin channel, and saved label-pattern buses (#756).

The two tabs are one object seen twice. Live records multitrack stems;
Soundcheck plays those same stems back through the console. Soundcheck has
no capture. Live has no playback. Neither has the other half, and the user
has to change tabs to move between recording a service and listening to
it.

Patrick's direction (2026-08-20), after reviewing the arrangement-view
design, is to merge them into one DAW tab that monitors, records and plays
back, with a real transport.

That invalidates ADR-0014's premise rather than its reasoning. ADR-0014
assumed the tab has exactly one timeline — a live capture, which has no
position to scrub and therefore nothing for a transport to do that the
Record button did not already do. A playback timeline has a position. A
position needs a transport.

## Decision

**1. `#tab-live` becomes the DAW tab; `#tab-soundcheck` is deleted.**
Monitoring, recording and playback share one timeline. The Soundcheck
tab, its `soundcheck` mode in `mode-switch.ts`, its entry in
`ModeTabs.tsx`, and its separate Pro gate are removed;
`SoundcheckPanel.tsx`'s playback path moves into the DAW tab. Its
capabilities are preserved in the merged surface, not dropped: session
loading becomes the toolbar's take picker, track routing and saved buses
become the routing surface, the master mixdown toggle becomes the master
bus row, and the waveform lanes become the arrangement lanes.

The tab is labelled **"Session"** in the header, not "DAW". The audience
is a volunteer running Sunday sound, and "DAW" is jargon they may not
own; "Session" names what the tab holds and reads naturally beside
Analyze and History. "DAW" stays the internal vocabulary — `#tab-live`,
`appMode: 'live'`, `dawWorkspaceEnabled`, `dawShellHTML` and the `.daw-*`
class prefix all keep their names, so routing, `body.live-active` and the
Pro-gate rules need no churn.

**2. An in-tab transport is reinstated.** Play, stop, loop,
return-to-start, seek, and the elapsed clock live in the DAW tab's
toolbar. **This supersedes ADR-0014's prohibition on an in-tab
transport.** Everything else in ADR-0014 stands: the tab is still
always-monitoring, there is still no Monitor/Record mode toggle, and
preflight still blocks a bad Record press inline via `#arm-hint` rather
than as a screen.

**3. The record control is one action with two affordances, never two
paths.** The in-tab transport's record button and the persistent top-bar
Record button render the same phase state (`liveTransitionState`
`capturePhase`) and dispatch the same `recordCapture` / `stopLiveCapture`
calls. The top-bar button is retained precisely because it is persistent —
a recording must be stoppable from any tab without navigating back. Two
affordances over one state is a DAW convention (transport bar plus
shortcut); two independent code paths is what ADR-0014 rejected, and that
rejection stands.

**4. Monitoring does not stop during playback.** Playing a take routes
stems to outputs while the inputs keep metering — measuring the room while
the recording stands in for the band is the whole point of a virtual
soundcheck. The MONITOR/PLAYBACK control selects which timeline the lanes
and playhead display; it does not start or stop capture, and it is
therefore not the mode toggle ADR-0014 forbade.

**5. Capture and playback do not both own the transport.** Pressing record
while a take is playing stops playback first. `liveSlot` and
`playbackSlot` remain separate Python children owned by their own stream
slots per ADR-0010; nothing here merges them.

**6. Every configured track gets a lane, armed or not.** `channelConfig`
is already a curated list the user built strip by strip, so it *is* the
track list; arm state is a recording decision, never a visibility one.
Making lanes appear and disappear with arm would reflow the timeline
under the user's cursor mid-soundcheck. Crowding on a large rig is solved
by the existing group fold (`.live-group-fold`, #483), not by hiding
tracks.

**7. Routing is a collapsible bottom drawer, not a dialog.** The
track-by-bus matrix is a whole-rig view and needs the full width the
320px inspector cannot give it, but `docs/design-reference.md` reserves
modal overlays for momentary choices. The drawer toggles from the
toolbar, spans the tab, and leaves the timeline visible above it.

Per-tick rendering is unchanged and still governed by ADR-0020 and
ADR-0005: the board renders from discrete store state, and animation-rate
values — meters, waveform lanes, the playhead — patch straight to the DOM
via the existing meter controller. Lane waveforms stay canvas
(`drawDawWaveformLane`); they never round-trip through React state.

## Consequences

Positive: one surface for the whole job, so recording a service and
listening back to it stop being separate destinations. Soundcheck's
playback engine gains a real timeline UI instead of a side panel. The tab
finally reads as the DAW that `docs/design-reference.md` has named as the
interaction model since #669. Deleting `#tab-soundcheck` removes a tab, a
mode, a Pro gate, and their e2e specs.

Negative: `#tab-live` becomes the app's largest surface, and it now reads
both `liveCaptureStore` and `soundcheckStore` — this ADR deliberately does
not merge those stores, so the tab depends on two. The record affordance
now exists in two places, which will drift unless both are driven from the
one phase state above. Users who knew the feature by the name "Soundcheck"
lose that tab, so the take picker must make "open a past session"
discoverable. And `dawWorkspaceEnabled` must gate a much larger surface for
longer than it has so far.

## References

- [ADR-0014 — Live capture is always-monitoring and mode-less; transport lives only in the persistent top bar](0014-live-capture-is-always-monitoring-and-mode-less-transport-lives-only-in-the-persistent-top-bar.md) — superseded in part by this record
- [ADR-0010 — Python child-process stream lifecycle is owned by one deep module](0010-python-child-process-stream-lifecycle-is-owned-by-one-deep-module-never-re-copied-per-domain.md)
- [ADR-0013 — Playback seeking ships as restart-with-start-offset](0013-playback-seeking-ships-as-restart-with-start-offset-in-process-seek-stays-deferred.md)
- [ADR-0015 — Soundcheck scrub commits seeks on pointer release](0015-soundcheck-scrub-commits-seeks-on-pointer-release-not-per-pointer-move.md)
- [ADR-0020 — The live-capture workspace board renders from discrete store state](0020-the-live-capture-workspace-board-renders-from-discrete-store-state-per-tick-values-patch-straight-to-the-dom-via-the-existing-meter-controller-adr-0005-extension.md)
- [docs/epics/e732 — Soundcheck waveform + real scrub/playhead completion record](../epics/e732-soundcheck-waveform-real-scrub-playhead-ableton-style.md)
- [docs/design-reference.md — Ableton Live as the interaction model](../design-reference.md)
- [#46 — Virtual Soundcheck](https://github.com/on-par/sound-buddy/issues/46)
- [#757 — remove the in-tab Live transport and mode toggle](https://github.com/on-par/sound-buddy/issues/757)
- [#989 — move console controls out of Live into a Console workspace](https://github.com/on-par/sound-buddy/issues/989)
