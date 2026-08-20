# Console panel meters ride the existing live-state channel pair, throttled at the console to 5 Hz

- Status: Accepted
- Date: 2026-08-20

## Context

#978 completes #885 by adding meter levels to the live console panel. Two transports
already existed and neither needed to be built: #977's start/stop-console-live-state
handler pair with its console-live-state push channel, and #883's startMeterSubscription,
which opens the /meters push subscription, decodes /meters/1 blobs, and renews the
subscription inside the console's ~10s silent-lapse window. ADR-0076 had already
reserved the console's four-client /xremote + /meters budget for exactly this slice.

Two questions were open. First, the IPC shape: a second start-console-meters /
stop-console-meters pair, or reuse of the live-state pair. A second pair means two
lifecycles the renderer must keep in sync, two ways to leak a subscription on teardown,
and a wider ADR-0075 read allowlist — for a panel where meters and channel state are
always started and stopped together.

Second, the frame rate. A bare `,s` subscribe streams at ~20 Hz. Pushing 20 Hz x 32
values into consoleStore would re-render the whole channel list at animation rate,
which is precisely what ADR-0005 ("discrete spectrum state in the store, animation-rate
updates straight to the DOM") and ADR-0013 (the shared rAF meter controller) exist to
prevent. The alternative to throttling is building a rAF/direct-DOM bypass for a
read-only panel a human glances at — cost with no benefit, when the console itself
throttles for free through the `,siii` time-factor form (#883: interval = 50ms x tf).

## Decision

Meters ride the existing pair. start-console-live-state starts both the #977 /node
channel poll and a /meters subscription against the same IP, holding a second
module-level handle that stopLiveStateSubscription() tears down alongside the first —
on stop, on a replacing start, and in the start failure path. The ADR-0075 IPC read
allowlist stays at exactly four channels; what widens is the OSC read vocabulary
(/meters, /xremote, /renew), pinned by console-read-only-gate.test.ts, which now scans
console-meters.ts and console-subscription.ts as well.

Meter frames are throttled at the console: console.ts passes
CONSOLE_METER_TIME_FACTOR = 4, giving 200ms frames (5 Hz). Meter values therefore stay
discrete state in consoleStore alongside channel state, and no renderer code opens a
second animation loop for them. Any future console surface that needs frames faster
than the store can absorb must take ADR-0005's route — bypass the store and write the
DOM — rather than raising this time factor.

Frames cross the bridge as a third variant of ConsoleLiveStateEvent,
`{ meters: ConsoleMeterFrameDto }`, carrying the 32 input levels only, linear and
unscaled exactly as the console reports them. Conversion to dBFS happens at the display
edge in ConsolePanel.tsx (meterDbfs / formatMeterDbfs / meterBarPercent), mirroring the
package's own rule that dB conversion is the caller's job. Meter subscription liveness
events ('reconnect', 'degraded-to-polling') are logged in main and change nothing in the
UI — degraded/offline UI is R5's scope, and the channel poll keeps running regardless.

## Consequences

Positive: no new IPC channel, no new preload runtime code, and one teardown path that
cannot leave half the stream running. The console's scarce subscription budget is spent
once per watching session. Store-held meter state stays honest with ADR-0005 without a
bespoke rAF path, and gate coverage extends over the meter transport for free.

Negative: meters cannot be watched without also polling channel state, and 5 Hz is
visibly coarser than a console's own meter bridge — a fast transient can fall between
frames, so this panel reads levels, it does not replace a real meter bridge. Because the
renewal/liveness events are logged only, a silently refused subscription (four-client cap
already hit) shows as flat meters next to live channel rows until R5 gives that state a
UI.

## References

- [#978 — feat: Console panel — live meter state, end-to-end (R3a/R3b)](https://github.com/on-par/sound-buddy/issues/978)
- [ADR-0076 — Live console channel state is a polled /node walk; the /xremote push budget stays reserved for meters](docs/adr/0076-live-console-channel-state-is-a-polled-node-walk-the-xremote-push-budget-stays-reserved-for-meters.md)
- [ADR-0075 — The console IPC surface is read-only by construction](docs/adr/0075-the-console-ipc-surface-is-read-only-by-construction-two-read-channels-guarded-by-a-source-scan-gate.md)
- [ADR-0005 — Discrete spectrum state in the store, animation-rate playback updates straight to the DOM](docs/adr/0005-discrete-spectrum-state-in-the-store-animation-rate-playback-updates-straight-to-the-dom.md)
