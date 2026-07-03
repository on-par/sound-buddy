# PRD 05 — Ideal profile to measure against

## Problem
Users want to compare a mix against a **target/ideal EQ profile** — "how far am I from
where this should sit?" Start simple (built-in targets), with a path to deriving a
target from a reference WAV later.

## Scope (this release: simple built-in profiles)
- **Profile model**: an ideal profile is a curve on the same log-frequency grid as PRD
  02: `{ id, label, freqs, dbOffsets }` where `dbOffsets` is the *relative* target shape
  (tilt), not absolute level — comparison is done after normalizing the measured curve's
  overall level to the target.
- **Built-in profiles** (shipped as JSON in `packages/audio-engine/src/profiles/`):
  - `flat` — neutral/flat reference.
  - `music-fullrange` — gentle low-shelf + presence lift typical of a balanced mix.
  - `speech-podcast` — high-pass tilt, presence/intelligibility bump (2–5 kHz), reduced
    sub-bass.
  - `broadcast` — loudness-normalized speech target.
- **Selection**: default profile is chosen from `contentType` (PRD 04) but can be
  overridden; persisted as `idealProfile` in `settings.json`. A dropdown in the
  spectrum header selects the active profile.
- **Comparison**:
  - Overlay the ideal curve (dashed) on the main curve (PRD 02).
  - Compute a **deviation** per grid point (measured − target after level-match) and a
    scalar **match score** (e.g. `100 − weighted_RMS_deviation`), shown on the report
    card with a "Deviation" mini-curve highlighting the biggest over/under regions.
- **Later (documented, not built now)**: "Load ideal mix (WAV)…" runs the reference
  through the same `curve` analysis and stores its shape as a custom profile.

## Non-goals
- WAV-derived profiles (stubbed in UI as disabled "coming soon").
- Auto-EQ correction suggestions beyond naming the deviant regions.

## Acceptance criteria
- The spectrum view overlays a dashed target curve and a profile dropdown.
- Report card shows a match score and the top over/under-target frequency regions.
- Changing content type (speech vs music) changes the default target.
- Comparison is level-invariant (raising overall gain doesn't change the deviation
  shape).
</content>
