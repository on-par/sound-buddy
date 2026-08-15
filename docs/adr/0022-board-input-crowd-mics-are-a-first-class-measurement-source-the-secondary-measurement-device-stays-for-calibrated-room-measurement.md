# Board-input crowd mics are a first-class measurement source; the secondary measurement device stays for calibrated room measurement

- Status: Accepted
- Date: 2026-08-15

## Context

A voice note from Patrick (2026-08-13) reports that a crowd mic can be
patched directly into an M32R console channel and used as the measurement
input, potentially making the dedicated secondary measurement device
(#460, ADR 0003/0005/0009) redundant. Issue #778 asks for the feature to
be evaluated against this board-input alternative and a decision recorded
(keep / deprioritize / remove), with calibration concerns (#461) kept on
the record and no removal work before Patrick confirms. The evaluation
shows the board-input path is not hypothetical: it already ships as the
primary "Measurement Source" select (LiveSourceSettings.tsx, #456) — a
strip of the primary multitrack capture, so it is time-aligned with the
session (same clock domain, zero drift) and costs no second process. But
a board channel is post-console: the board hint copy in
measurement-source-hints.ts says it "reflects the console's mix, not the
room itself." The secondary measurement device is the only path to a
physical room mic on a separate device (USB measurement mic or built-in
mic) that bypasses the console — the #461 calibrated-measurement-mic gold
standard. Accepted ADR-0009 made the device first-class and always
visible, and renderer migration 6k (#714) is mid-flight across the same
React surface.

## Decision

Sound Buddy keeps the secondary measurement device as-is and records this
decision in a new Accepted ADR. The board-input crowd-mic path — already
implemented as the primary "Measurement Source" select — is the
recommended first choice for a rough crowd/audience reference and fully
covers the use case Patrick describes; the secondary measurement device is
retained for the calibrated room measurement case (#461) that a board
channel cannot serve, because its signal is post-console. Issue #778 makes
no code, configuration, or test changes. Any future deprioritization or
removal reopens this ADR, requires Patrick's confirmation, and must name
the interaction with renderer migration #714 before touching the feature's
React/IPC surface.

## Consequences

Positive: no churn to a shipped, tested, ADR-0009-backed feature; the
calibrated-room-mic path survives; the crowd-mic use case is already
served at zero extra cost; the decision, the #461 note, and the removal
gate are permanently on the record per the issue's acceptance criteria.
Negative: the secondary device keeps its second-process cost and its
unconditional time-alignment warning even though the common case (crowd
mic) is now better served by the board path; the two overlapping paths can
confuse users until product copy steers toward the board input; real-rig
clock-drift numbers remain unquantified as ADR 0003/0005 recorded.

## References

- [Issue #778](https://github.com/on-par/sound-buddy/issues/778)
- [Issue #461 — measurement-source quality and calibration hints](https://github.com/on-par/sound-buddy/issues/461)
- [Issue #714 — renderer migration 6k](https://github.com/on-par/sound-buddy/issues/714)
- [ADR-0003 — Secondary audio-device measurement on macOS (spike findings)](docs/adr/0003-secondary-audio-device-measurement.md)
- [ADR-0005 — Secondary-device measurement ships flag-gated with an unconditional time-alignment warning](docs/adr/0005-secondary-device-measurement-ships-flag-gated-with-an-unconditional-time-alignment-warning.md)
- [ADR-0009 — Secondary measurement device is first-class and always visible](docs/adr/0009-secondary-measurement-device-is-first-class-and-always-visible-the-flag-is-retired-not-migrated.md)
