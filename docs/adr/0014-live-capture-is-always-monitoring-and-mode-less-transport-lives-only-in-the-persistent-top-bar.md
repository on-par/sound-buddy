# Live capture is always-monitoring and mode-less; transport lives only in the persistent top bar

- Status: Accepted
- Date: 2026-08-14

> **Partly superseded by [ADR-0080](0080-the-daw-tab-merges-live-and-soundcheck-an-in-tab-transport-drives-the-timeline-supersedes-adr-0014.md)**
> — merging Virtual Soundcheck into the tab gives it a second, seekable
> playback timeline, so the in-tab transport prohibition below no longer
> holds. Always-monitoring, the absence of a Monitor/Record mode toggle,
> and inline `#arm-hint` preflight all still stand.

## Context

Sound Buddy's Live tab shipped a Monitor/Record mode toggle plus a
full-screen preflight gate and in-tab Start/Stop transport. #729/#741
added a DAW-style top-bar Record button that promotes a running monitor
session to a recording in place (#458), so the mode toggle and its gated
preflight checklist became a redundant parallel path. Patrick's direction
(2026-08-11) is GarageBand/Ableton-style: the tab is always listening
(monitoring auto-starts, #728), and the only transport is a top-bar
Record⇄Stop button. Preflight validation must still block a bad Record
press, but inline (#arm-hint), not as a screen. The change is UI-only —
the backend startLive({ mode, arm, labels }) contract and persisted rigs
still carry a mode. Because the mode toggle is gone, every user-initiated
stop is a record session, so the monitor-only session report card
(#488/#261) becomes unreachable unless record sessions also offer it.

## Decision

The Live tab is permanently monitor-mode: no Monitor/Record toggle, no
in-tab start/stop transport, and no preflight checklist panel may ever be
reintroduced into #tab-live. The persistent top-bar Record button is the
sole start/stop control for Live capture, cycling Record⇄Stop with
transient Starting/Stopping states; an idle press starts monitoring first
(liveMode normalized to 'monitor') then promotes in place. Preflight
validation (device connected / channel routing / baseline match) gates a
bad Record press via the existing #arm-hint inline blocker, and the
preflight checklist + Save baseline live in Settings → Audio. Every
stopped session with window data offers the session report card; record
sessions additionally offer to reveal the saved folder.

## Consequences

Positive: the Live tab reads as a DAW — strips always metering, one
Record button — the extra gated screen is gone, and the shipped preflight
and report-card features stay reachable. Negative: liveMode remains an
internal implementation detail with no UI, so engineers can no longer
"preview" a record-mode routing before committing (mitigated by the
promote-in-place flow); and the always-visible arm controls expose a
record-enable affordance whose meaning (armed strips = session stems)
is now discoverable only via the inline blocker and Settings.

## References

- [#458 — promote a running monitor session to a recording in place](https://github.com/on-par/sound-buddy/issues/458)
- [#729 / #741 — top-bar Record button + record-transport](https://github.com/on-par/sound-buddy/issues/729)
- [#728 — Live-tab auto-start of monitoring](https://github.com/on-par/sound-buddy/issues/728)
- [docs/design-reference.md — Ableton Live as the interaction model](https://github.com/on-par/sound-buddy/blob/main/docs/design-reference.md)
- [Issue #757](https://github.com/on-par/sound-buddy/issues/757)
