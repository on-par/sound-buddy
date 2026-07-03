# PRD 02 — EQ spectrum curve (vertical levels)

## Problem
The current spectrum is 7 **horizontal** band meters (level = bar width). The user
expects a real EQ/analyzer view: a **curve** with **frequency on the horizontal axis**
(log scale) and **level on the vertical axis**, the way an RTA / EQ plot looks.

## Visual reference
The target look is a **FabFilter Pro-Q–style analyzer** (user-provided reference):
- Log-frequency x-axis, dB vertical, subtle dB gridlines on a dark canvas.
- Two overlaid traces: a **live/instantaneous** spectrum (brighter, jagged, thin) and
  a smoother, **filled "average"** trace behind it. The average is the anchor; the live
  trace shows motion.
- Mapping for Sound Buddy:
  - **Offline file (this PRD):** the "average" trace = whole-file `curve`; the "live"
    trace = the spectrum at the currently-scrubbed time frame (from PRD 03; until 03
    lands, only the average is drawn).
  - **Live capture (PRD 06):** "live" = current window, "average" = running average.
- Filled gold gradient under the average curve; live trace in a lighter/azure hue so the
  two read as distinct.

## Scope
- **Backend**: `spectrum.py` emits a fine-grained frequency-response curve in addition
  to the 7 legacy bands:
  ```jsonc
  "curve": { "freqs": [20 … 20000], "db": [ … ] }   // ~48 log-spaced points, whole-file avg
  ```
  Grid: fixed log-spaced centers, ~1/6-octave, 20 Hz–20 kHz (≈48 points). Level per
  point = mean STFT magnitude in the surrounding log band → dB, normalized so the
  loudest point sits near the top of the display range.
- **Types**: add `SpectrumCurve { freqs: number[]; db: number[] }` and
  `curve: SpectrumCurve` to `SpectrumResult` in `types.ts`; map snake→camel in
  `spectrum.ts`.
- **UI**: a new SVG line-chart in `#spectrum-panel` replacing (or toggled with) the
  horizontal band meters:
  - X axis: log frequency, labeled 20 / 50 / 100 / 200 / 500 / 1k / 2k / 5k / 10k / 20k.
  - Y axis: dB (reuse `DB_MIN=-72 … DB_MAX=-3`), gridlines as today.
  - Smooth gold curve, filled gradient under the line, spectral-centroid marker kept.
  - Band names shown as faint x-axis region tints using the existing `--band-*` ramp.
- Keep the 7-band breakdown available in the **report card** (unchanged there for now;
  the curve is added alongside — see PRD 03 for the report-card curve).

## Non-goals
- Time dimension (PRD 03). This is the whole-file average curve only.
- Ideal-profile overlay (PRD 05).

## Acceptance criteria
- Analyzing a file renders a frequency-response curve with a log x-axis and dB y-axis.
- Curve peaks/dips match the 7-band values qualitatively (bass-heavy file → curve tilts
  up at low frequencies).
- `--no-spectrum` and files that fail Python still degrade gracefully (no curve, no
  crash).
- CLI `--json` includes the `curve` field.
</content>
