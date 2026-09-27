# iOS Analyze's hero level is an estimated dBSPL from a fixed default phone-mic offset; RTA and coaching stay in dBFS / relative dB

- Status: Accepted
- Date: 2026-09-27

## Context

#1544 shipped the iOS Analyze overall level as uncalibrated dBFS (e.g. -25.4 dBFS) and epic
#1541 parked absolute SPL. In dogfood the engineer compares the hero to a handheld SPL meter
(~90 dB) and a large negative full-scale number is useless to them, so product (2026-09-27,
#1571) locked the hero to room loudness in dBSPL. True absolute SPL needs a reference: phone
mics vary by model, case and orientation, and iOS has no calibration UI yet (Mac has a user
offset, #846 / spl-calibration.ts). MicCapture already runs AVAudioSession in `.measurement`
mode, so AGC is off and a single broadband offset is a stable first-order estimate. The
dogfood datum (-25.4 dBFS on the phone vs ~90 dB on the meter) puts that offset near 115 dB,
consistent with a built-in iPhone mic clipping around 115-120 dB SPL.

## Decision

The iOS Analyze hero shows `overall dBFS + AnalyzeModel.phoneMicSplOffsetDb` (115.0 dB, a
named constant) labelled "dBSPL", unweighted (Z, the same DC-excluded broadband power sum the
analyzer already reports), converted only at AnalyzeModel's display seam
(`estimatedSpl(fromDbfs:)` / `overallSplDb` / `formatOverallLevel`). `overallDb`, the RTA,
the ideal-curve level match and coaching keep their dBFS / relative-dB meaning and never see
the offset. The "Phone mic estimate" honesty cue stays visible whenever this uncalibrated
estimate is shown. A future user calibration must replace the default offset at this same
seam, not add a second conversion.

## Consequences

The hero reads in the same ballpark as a handheld meter on the dogfood phone, and the change
stays a one-constant display mapping with no analyzer or fixture churn. The number is not
meter-grade: other iPhone models, cases or orientations may read several dB off, and it is
unweighted while most handheld meters show A or C weighting, so broadband low-frequency-heavy
material reads higher than an A-weighted meter. iOS and Mac now differ when uncalibrated (Mac
shows dBFS until the user calibrates); a later iOS calibration slice supplies the per-device
correction.

## References

- [Issue #1571 — iOS Analyze hero level as estimated dBSPL](https://github.com/on-par/sound-buddy/issues/1571)
- [Issue #1544 — overall dB on iOS Analyze (dBFS baseline)](https://github.com/on-par/sound-buddy/issues/1544)
- [Issue #846 — Mac SPL calibration offset](https://github.com/on-par/sound-buddy/issues/846)
