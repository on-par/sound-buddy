# Analyze's listen channel is a single in-memory selection, and switching it restarts the one-channel measurement stream

- Status: Accepted
- Date: 2026-09-25

## Context

#1524 (Pro MVP, product lock 2026-09-25) lets a Pro user pick which input of a multi-input room-mic
interface Analyze listens to. Two things constrain the design. The measurement stream
(measurement-source.ts, ADR 0003) is metering-only and single-channel by contract. And the AC
requires that switching N -> M leaves no N state behind. A multichannel stream filtered in the
renderer would put an index into every consumer (roomPaneOverride, roomFeed, live grading, badge),
and it would keep old-channel windows in secondaryWindows after a switch. Multi-select is out of
scope for this issue, but it is the obvious next ask, so the shape of the selection needs a
recorded owner.

## Decision

The Analyze listen channel is one 0-based integer, `listenChannel`, owned by analyzeEntryStore and
held in memory only (never persisted to settings.json). It reaches the main process only as
StartMeasurementOpts.channel. measurementChannelToken() turns it into the stream's one channel
token, and an omitted or invalid value means '0'. Changing it while listening always goes through
selectListenChannel(), which awaits stopSecondaryMeasurement() before startSecondaryMeasurement().
No component may filter a multichannel measurement stream by index, and no component may start the
new channel before the old stream has stopped. The measurement stream stays one channel wide. A
future multi-select must record a new decision rather than widen this field into an array.

## Consequences

Positive: every downstream consumer keeps reading channel [0] of the measurement tick unchanged.
The AC2 no-leftover-state guarantee holds by construction, because the store's stop/start already
empties the buffers. The Settings-started room mic keeps channel 0 because it omits `channel`.
Negative: a switch costs one stream.py restart, so there is a short gap (about one window) with no
curve. The choice is forgotten on app restart. Multi-select will need a redesign of the stream
contract, not an incremental change.

## References

- [Issue #1524 — Pro: channel listening / selection (single-select MVP)](https://github.com/on-par/sound-buddy/issues/1524)
