# RTA target convention vs band-sum bars (#1726)

## Two conventions

- **Target curves** (`IdealCurve.dbOffsets`, the Mac 48-point curve, spectrum.py
  `curve_from_power`) use the **mean power per FFT bin** convention. They describe a
  power spectral density (PSD) shape. The coaching bands also use mean power, so
  coaching compares like with like and needs no correction.
- **iOS RTA bars** (`SpectrumAnalyzer.rtaLevels`) are **power sums** over 1/6-octave
  bands. A band's width grows in proportion to its center frequency, so a signal
  that matches the target's PSD reads `10 * log10(fc / 1 kHz)` dB higher on a bar at
  `fc` than on the 1 kHz bar.

Concretely: pink noise (PSD -3 dB/octave) reads **flat** on the bars, and white
noise (flat PSD) rises **+3 dB/octave** on the bars.

## The correction

When a target is drawn over band-sum bars, each band's offset is

```
display(fc) = offset(fc) + 10 * log10(fc / 1000 Hz)
```

which is `10 * log10(bandwidth / bandwidth@1k)` for constant-fraction-of-octave
bands. It is applied **before** level matching (`RTATarget.levelShift`), so the
dB-mean match is done in the display convention.

In code (`apps/ios/SoundBuddyKit/Sources/SoundBuddyKit/RTA.swift`):

- `RTATarget.bandwidthReferenceHz` (1000) and `RTATarget.bandwidthCorrectionDb(atHz:)`.
- `RTATarget.displayOffsetDb(_:atHz:)` / `storedOffsetDb(fromDisplay:atHz:)` convert
  between the stored and displayed conventions.
- `RTATarget.resample(_:onto:)` returns display offsets (corrected).

Without the correction, a pink-PSD target draws as a line falling about 30 dB end to
end over pink-noise bars that are flat. That is the build 12 symptom: bars sat
10 to 15 dB above the dashed line at 5 to 10 kHz while coaching said the brilliance
band was below target.

## Display only

- The dashed target line (`AnalyzeModel.rtaTargetDb`) and problem markers (which
  compare bars against `rtaTargetDb`) use the corrected offsets.
- Target-edit handles draw at the corrected position (`AnalyzeModel.rtaTargetHandles`),
  and `TargetHandleDrag` clamps the corrected displayed value to the plot. The
  correction is constant per handle, so a drag of +N dB writes exactly +N dB into the
  stored, **uncorrected** `dbOffsets`. Saved and shared curves never contain a
  bandwidth term.
- Coaching (`BandDeviationCoach`, mean-power bands) is unchanged.

## Reading the overlay

The `flat` target now draws as a line rising 3 dB per octave through the measured
mean: that is where white noise sits. Pink noise sits on a target that falls 3 dB
per octave in the stored convention, which draws flat over flat pink bars.

## Other surfaces must match

Any view that power-sums onto the 1/6-octave grid and overlays or subtracts a target
must apply the same correction:

- #1707's Relative view (bar minus target) must subtract the corrected target, or it
  will inherit a 3 dB/octave tilt.
- The Mac (#1709) and web (#1710) RTA slices must add `10 * log10(fc / 1000)` to the
  target when their bars are band sums. Views that plot mean power per bin (the
  current Mac/web spectrum) must not.
