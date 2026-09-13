# The report card grades band balance and tonal symptoms against the active ideal EQ curve, and the rubric thresholds are user-editable settings

- Status: Accepted
- Date: 2026-09-13

## Context

A live-capture report card on a mix the engineer judged excellent came back
"C, 70/100" with "Band imbalance +22.8 dB · target ≤ +15 dB vs. other
bands", every low band reading Too Hot, every high band Too Quiet, and a
"Mix lacks air and brightness" recommendation. The band-balance rule in
app/renderer/grading.js compared each of the seven band levels to the flat
mean of the other six. Band levels are mean power per FFT bin (a density),
and a real full-range music mix falls roughly 30–40 dB from sub-bass to
brilliance on that scale — the app's own built-in "Worship service" ideal
profile, captured from a real service, encodes a +18 → −18 dB tilt. Running
the grader on pure pink noise already trips the rule (+15.5 dB) and costs a
letter. The rules-engine "Muddy" symptom (packages/audio-engine/src/analyze/
rules.ts) had the same flat-reference assumption: 60–250 Hz vs 500 Hz–2 kHz
raw density, ≥ 6 dB, which pink noise exceeds by ~9 dB. "Lacks air" fired
on an absolute −40 dBFS brilliance cutoff that every normally-levelled
recording sits below.

Meanwhile the app already had a level-invariant, user-selectable,
user-editable ideal-curve system (PRD 05: Auto / built-ins / custom curves
captured from a mix or edited per band) — and the grade ignored it entirely.
The only rubric control was the Casual/Broadcast strictness profile, a fixed
2 dB shift of every threshold.

## Decision

1. **The band rules grade against the active ideal EQ curve.** A
   `GradeBaseline { label, profileId, isAuto, bandTargets }` rides on the
   `ReportCardSource` (the same seam ADR-0098 chose for `symptoms`, for the
   same reason: four call sites derive a grade from a source and must
   agree). `bandTargets` is the profile's relative shape reduced to the
   seven legacy bands by `bandTargetsFromProfile` in
   packages/audio-engine/src/profiles — a power-domain mean of the shape
   sampled uniformly in Hz across each band, the same reduction the measured
   band levels use. grading.js's `bandDiffFromOthers(bands, key, targets)`
   measures each band's deviation from its target against the mean of the
   other bands' deviations, so a mix that follows the ideal tilt reads 0 dB
   in every band at any level. The flat profile yields all-zero targets and
   a source with no baseline grades exactly as before. The deduction names
   the curve ("+6.8 dB vs. Worship service"). Too Hot / Too Quiet verdicts,
   the "too much energy in X" recommendations, and "lacks air" (now a
   relative `quietDiff` test) all read the same diff.

2. **The rules engine evaluates symptoms on the curve minus the baseline.**
   `evaluateRules(curve, instrumentId, { baseline, thresholdOffsetDb })`
   subtracts the profile's `dbOffsets` (grid-matched by length, as
   `compareToProfile` does) before the band-vs-reference test, so Muddy /
   Harsh mean "over what the ideal curve says that band should be". The
   thresholds still live only in RULE_TABLE (ADR-0098 holds); a uniform
   `thresholdOffsetDb` is the one user-facing knob, and a fired rule reports
   the effective `thresholdDb` it cleared, which `gradeSymptoms` renders.

3. **Live capture's Auto baseline is the worship-service profile.** A live
   window has no content classifier, so Auto used to fall through to flat.
   `defaultProfileForLiveCapture()` / `LIVE_CAPTURE_DEFAULT_PROFILE_ID`
   resolve Auto to the same target Auto already picks for music/mixed
   files. `resolveActiveProfile` uses it whenever there is no file spectrum.

4. **The baseline is resolved once, in stores/gradeContext.ts.**
   `gradeContext.forSpectrum(spectrum)` (file: Auto by content type; null:
   the live default) and `gradeContext.liveBaseline()` feed every source
   builder: ReportCardIsland, report-card-chrome, the Directory batch, and
   the live bridge (`liveReportCardSource` / `liveSessionReportCardSource`
   take the baseline as a parameter). A change of ideal curve re-baselines
   the showing live source in place rather than rebuilding it from
   `liveWindows`, so a frozen session card (#776) is never clobbered.

5. **A live mix can be captured as the ideal curve.** The curve editor's
   "Use current mix" and the report card's "save this mix as your target"
   CTA accept the live card's seven band levels
   (`bandOffsetsFromMeasuredBands` → `profileFromBands`), not only a file's
   fine curve. The seven control values are fitted (`captureBandOffsets`)
   so that `bandTargetsFromProfile` of the saved curve reproduces the mix's
   band shape — the editor's centre-point interpolation and the grade's
   uniform-in-Hz power average are not inverses, and without the fit a
   mix read up to ~3 dB off against itself. `clampDb` widens from ±18 to
   ±24 dB so a captured room-mic tilt is not flattened; the editor sliders
   match.

6. **The rubric is a Settings section.** `settings.gradingRubric` is a flat
   map of `GRADING_RUBRIC_KEYS` ("rms.acceptableMin", …,
   "symptoms.thresholdOffsetDb") to absolute values, sanitized in the main
   process against that one key list. grading.js layers
   `setRubricOverrides` on top of the strictness profile
   (`configForProfile(profileId, overrides)`), re-deriving CONFIG from the
   immutable base so nothing compounds; an overridden key ignores the
   profile shift. The main process drops values outside each key's
   `GRADING_RUBRIC_BOUNDS` span (sign included), and `configForProfile`
   repairs paired-threshold ordering (min ≤ max, check ≤ good, hot ≤
   severe; score-only edges follow the acceptable band) so no override can
   make a rule contradict itself. Settings ▸ Grading shows the ideal-curve picker (with
   edit/capture) and one number input per threshold, seeded with the active
   profile's defaults, plus Reset to defaults. The bridge syncs the setting
   to grading.js exactly as it does the profile.

## Consequences

Positive: a full-range music mix no longer loses a letter for being music.
The screenshot's crowd-mic window grades A against the worship curve with
no band deduction (golden fixture `baseline_worship_live`). The card says
which curve it graded against ("Target: Worship service (auto)"), and the
engineer can capture their own best mix — from a file or live — as the
target, or type the thresholds they want. Symptoms and the grade share one
baseline, so ADR-0098's no-contradiction guarantee survives.

Negative and accepted: grades of past recordings will move (mostly up) when
re-rendered, because the baseline is resolved at render time from the
current selector, exactly as the strictness profile already is; persisted
history scores keep the grade they were saved with. "Auto" now means
different things for a file (by content type) and a live capture (worship
service) — the pill's "(auto)" suffix and the Settings help copy say so.
The ±24 dB clamp is a data-format widening; older curves are untouched.
The rules-engine offset is uniform across rules by design — per-rule
tuning stays a RULE_TABLE edit.

## References

- [ADR-0098 — The rules engine owns every band-excess threshold](docs/adr/0098-the-rules-engine-owns-every-band-excess-threshold-grading-js-consumes-fired-symptoms-as-injected-source-data.md)
- [ADR-0027 — Offline harshness rules are a pure data-driven audio-engine module](docs/adr/0027-offline-harshness-rules-are-a-pure-data-driven-audio-engine-module-over-the-fine-spectrum-curve-separate-from-the-live-7-band-eq-coaching.md)
- [packages/audio-engine/src/profiles/index.ts](packages/audio-engine/src/profiles/index.ts) — `bandTargetsFromProfile`, `defaultProfileForLiveCapture`
- [packages/audio-engine/src/analyze/rules.ts](packages/audio-engine/src/analyze/rules.ts) — `EvaluateRulesOptions`
- [app/renderer/grading.js](app/renderer/grading.js) — `bandDiffFromOthers`, `setRubricOverrides`
- [app/renderer/src/stores/gradeContext.ts](app/renderer/src/stores/gradeContext.ts)
- [app/renderer/src/GradingRubricEditor.tsx](app/renderer/src/GradingRubricEditor.tsx)
