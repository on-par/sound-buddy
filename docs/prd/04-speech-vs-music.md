# PRD 04 — Speech vs. music delineation

## Problem
Analysis today treats all audio identically. Content that is **speech** should be read
differently from **music** (target curves, loudness expectations, and observations all
differ). The tool should detect and delineate speaking vs. music-playing segments.

## Scope
- **Per-frame classification** in `spectrum.py`, computed on the same frames as PRD 03.
  Heuristic (no ML model — keep the bundled Python light):
  - Features per frame: spectral flatness, spectral centroid, zero-crossing rate,
    low/mid/high energy ratios, and short-time energy variance (modulation ~4 Hz is
    speech-like).
  - Label each frame `speech`, `music`, or `silence` (RMS below a floor). A light
    median smoothing pass removes single-frame flip-flops.
- **Segments**: collapse consecutive same-class frames into
  `segments: [ { class, start, end } ]` on the analysis result, plus a top-level
  `contentType: 'speech' | 'music' | 'mixed' | 'silence'` summary.
- **Downstream use**:
  - Report card shows a **content-type pill** ("Speech", "Music", "Mixed") and a thin
    **timeline ribbon** colored by segment class.
  - The observation/verdict thresholds (report.ts) and the default ideal profile (PRD
    05) switch on `contentType` (e.g. speech → presence/intelligibility target; music →
    full-range target).
  - The time heatmap (PRD 03) tints its time axis by segment class.

## Non-goals
- Speaker diarization / who-is-talking.
- Word-level or transcript features.
- ML classifier (heuristic only; can be upgraded later behind the same interface).

## Acceptance criteria
- A spoken-word file classifies predominantly `speech`; a music track predominantly
  `music`; a podcast with a music bed reads `mixed` with a sensible timeline.
- Segments are contiguous and cover the whole duration.
- Report card pill + ribbon reflect the detected content.
- CLI `--json` includes `segments` and `contentType`.
</content>
