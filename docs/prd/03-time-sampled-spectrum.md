# PRD 03 — Time-sampled spectrum across the file

## Problem
A single whole-file average hides how the mix evolves. The user wants to **sample the
EQ distribution at points in time** across the file, both in the analysis view and on
the report card.

## Scope
- **Backend**: `spectrum.py` emits `frames`: N evenly-spaced snapshots (default N≈24,
  capped by duration so windows don't overlap awkwardly). Each frame samples the same
  log-frequency grid as PRD 02 over a short window (~1–2 s) centered at time `t`:
  ```jsonc
  "frames": [ { "t": 0.0, "db": [..grid..], "rms": -14.2, "class": "music" }, ... ]
  ```
  (`class` is populated by PRD 04; emit `"unknown"` until then.)
- **Types**: `SpectrumFrame { t:number; db:number[]; rms:number; class:string }` and
  `frames: SpectrumFrame[]` on `SpectrumResult`.
- **UI — analysis view**: a compact **spectrogram-style heatmap** strip under the curve
  (time →, frequency ↑, cell color = level using the meter ramp), plus a **scrubber**:
  clicking a time column re-draws the main curve (PRD 02) for that frame. A "▶ average"
  reset returns to the whole-file curve.
- **UI — report card**: a small static heatmap thumbnail + 3 representative frame
  curves (start / middle / loudest) so the printed/exported card shows how the spectrum
  moved over time.

## Non-goals
- Real-time (live) time-sampling — that's the live path (PRD 06); this is offline files.
- Speech/music coloring of frames (PRD 04) — the data field exists but coloring lands
  with 04.

## Acceptance criteria
- Analyzing a ≥10 s file shows a time/frequency heatmap and a working scrubber that
  updates the curve.
- Report card renders the heatmap thumbnail + representative frames and still prints.
- Short files (<2 s) fall back to a single frame == the average curve without error.
- CLI `--json` includes `frames`.
</content>
