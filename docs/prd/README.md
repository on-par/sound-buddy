# Sound Buddy — Analysis & Capture Overhaul (PRD set)

This directory breaks a large multi-feature request into shippable, one-at-a-time
increments. Each PRD is self-contained: problem, scope, data-model changes, UI, and
acceptance criteria. Release order is chosen so each feature builds on the last and
each is independently valuable.

## Release order

| # | Feature | PRD | Rationale for order |
|---|---------|-----|---------------------|
| 1 | AI/LLM disabled by default | [01](01-ai-off-by-default.md) | Trivial, low-risk, decouples the roadmap from AI complexity. Ship first. |
| 2 | EQ spectrum curve (vertical levels) | [02](02-eq-spectrum-curve.md) | The visual centerpiece. Requires a richer spectrum in `spectrum.py`; that new data model is the foundation for #3–#5. |
| 3 | Time-sampled spectrum across the file | [03](03-time-sampled-spectrum.md) | Adds the time dimension to the curve from #2; surfaces in analysis view + report card. |
| 4 | Speech vs. music delineation | [04](04-speech-vs-music.md) | Per-frame classification; rides on the time-frames introduced in #3. |
| 5 | Ideal profile to measure against | [05](05-ideal-profile.md) | Compares the measured curve (#2) against a target. Simple built-in targets now; WAV-derived later. |
| 6 | Real-time multi-channel live capture | [06](06-realtime-multichannel-capture.md) | Separate subsystem: faster cadence, monitor-vs-record, per-device channel & mono/stereo selection. |

## Shared foundation

Features 2–5 all depend on a **spectrum data-model upgrade** in
`packages/audio-engine/scripts/spectrum.py` and `packages/audio-engine/src/types.ts`.
The upgrade is additive: the existing 7 scalar `bands` stay (back-compat for the CLI
report, multi-channel compare, and current UI), and new fields are added:

```jsonc
{
  "bands": { /* unchanged 7 scalars */ },
  "curve":  { "freqs": [..Hz..], "db": [..dB..] },   // whole-file frequency response  (#2)
  "frames": [ { "t": 0.0, "db": [..], "class": "music", "rms": -14.2 }, ... ], // (#3, #4)
  "spectral_centroid": .., "spectral_rolloff_85": .., "dynamic_range": ..
}
```

`curve.freqs` is a fixed log-spaced grid (~1/6-octave, ~48 points, 20 Hz–20 kHz) so
curves are directly comparable across files and against an ideal profile (#5). Each
`frames[i].db` is the same grid sampled over a short window centered at `t`.

## Feature flags / config

A small persisted settings file (net-new) lives at
`~/Library/Application Support/SoundBuddy/settings.json`. It holds `aiEnabled` (#1,
default `false`) and the selected `idealProfile` (#5). This is separate from the
existing `llm.json` provider config.
</content>
</invoke>
