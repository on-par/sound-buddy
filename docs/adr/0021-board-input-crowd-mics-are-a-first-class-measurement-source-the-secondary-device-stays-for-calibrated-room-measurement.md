# Board-input crowd mics are a first-class measurement source; the secondary measurement device stays for calibrated room measurement

- Status: Accepted
- Date: 2026-08-15

## Context

A voice note from Patrick (2026-08-13) reports that a crowd mic / additional
microphone can be connected directly to the soundboard (M32R) and used as a
measurement input. If the board-input approach covers the use case, the
dedicated **secondary measurement device** feature (epic #723, #460, ADR 0003)
may no longer be needed as a separate path. Issue #778 asks for the feature to
be evaluated against this board-input alternative and a decision recorded
(keep as-is / deprioritize / remove), with two hard constraints: calibration
and accuracy concerns for the measurement microphone (#461) must stay on the
record and not be silently dropped, and **no removal work begins until Patrick
confirms the direction**. The issue also notes that renderer migration 6k
(#714) touches the same React/IPC surface.

The evaluation shows the board-input path is not hypothetical — it already
ships as the primary measurement path. Settings → Audio renders a board
"Measurement Source" select (`app/renderer/src/LiveSourceSettings.tsx`, #456),
driven by `measurementSourceOptionsHTML`/`normalizeMeasurementSource` in
`app/renderer/src/live-capture-panel.ts` (#456). The selected strip is part of
the primary multitrack capture, so it is time-aligned with the session (same
clock domain, zero drift) and costs no second process. A crowd mic patched to
an M32R channel is exactly that.

But a board channel is **post-console**: the board hint copy in
`app/renderer/src/measurement-source-hints.ts` (#461) says the board feed
"reflects the console's mix, not the room itself", and the
`measurement-mic` classification frames a calibrated measurement mic as "the
gold standard — trust these readings most". The secondary measurement device
is the only path to a physical room mic on a separate device (USB measurement
mic or built-in mic) that **bypasses the console's preamp/EQ** — a second
`stream.py` monitor process reading the device independently of the board
capture (`app/electron/ipc/measurement-source.ts`, metering-only, its own
`measurement-event` channel, fully independent child-process lifecycle). When
it is active, its channel 0 owns the Room readout/EQ slot, badged as "not
time-aligned" (`live-level-readout.ts` + `roomFeed` in
`app/renderer/src/measurement-device-state.ts`, ADR 0003/0013), and it carries
an unconditional time-alignment warning per ADR 0003/0005. Accepted ADR-0009
made the device first-class and always visible.

## Decision

Sound Buddy **keeps the secondary measurement device as-is**. The board-input
crowd-mic path — already implemented as the primary "Measurement Source"
select — is the recommended first choice for a rough crowd/audience reference
and fully covers the use case Patrick describes through the primary device
path alone. The secondary measurement device is retained for the calibrated
room measurement case (#461) that a board channel structurally cannot serve,
because its signal is post-console.

Issue #778 makes **no code, configuration, or test changes** — the "if kept,
no changes" acceptance criterion holds byte-for-byte. Any future
deprioritization or removal reopens this ADR, requires Patrick's confirmation,
and must name the interaction with renderer migration 6k (#714) before
touching the feature's React/IPC surface. Renderer migration #714 remains
obligated to migrate the secondary measurement device as a live feature, not
treat it as removal-candidate dead code.

## Consequences

Positive: no churn to a shipped, tested, ADR-0009-backed feature; the
calibrated-room-mic path survives; the crowd-mic use case is already served at
zero extra cost; the decision, the #461 note, and the removal gate are
permanently on the record per the issue's acceptance criteria.

Negative: the secondary device keeps its second-process cost and its
unconditional time-alignment warning even though the common case (crowd mic)
is now better served by the board path; the two overlapping paths can confuse
users until product copy steers toward the board input; real-rig clock-drift
numbers remain unquantified as ADR 0003/0005 recorded.

## References

- [Issue #778 — Reconsider secondary measurement device](https://github.com/on-par/sound-buddy/issues/778)
- [Issue #461 — measurement-source quality and calibration hints](https://github.com/on-par/sound-buddy/issues/461)
- [Issue #714 — renderer migration 6k](https://github.com/on-par/sound-buddy/issues/714)
- [ADR-0003 — Secondary audio-device measurement on macOS](docs/adr/0003-secondary-audio-device-measurement.md)
- [ADR-0005 — Secondary-device measurement ships flag-gated with an unconditional time-alignment warning](docs/adr/0005-secondary-device-measurement-ships-flag-gated-with-an-unconditional-time-alignment-warning.md)
- [ADR-0009 — Secondary measurement device is first-class and always visible](docs/adr/0009-secondary-measurement-device-is-first-class-and-always-visible-the-flag-is-retired-not-migrated.md)
