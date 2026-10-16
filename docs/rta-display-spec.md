# Shared RTA display spec (v1)

One RTA look on every Sound Buddy surface: iOS (reference implementation, #1707), Mac (#1709), web (#1710) and the desk RTA (#1704). Parent epic: #1705.

**Display only.** Coaching keeps its own longer window and hysteresis (#1695, #1702) and never reads display-smoothed values. iOS pins this with a test (`AnalyzeModelTests.coachingIsUnchangedByTheRTABallistics`).

## 1. Views

### Absolute (default)

- Fixed **−96…0 dBFS** on every platform, ticks every **12 dB**, with the dashed level-matched target line. Same window everywhere, no auto-ranging.
- The target is resampled onto the band grid with the band-sum bandwidth correction (section 3), then level-matched by mean dB (ADR-0154) against the **same smoothed bars it is drawn over**, so every bar minus the line equals its Relative deviation exactly (iOS: `RTADisplayModel.targetLine(offsets:)`, #1772).
- −96 sits just under a quiet room's per-band floor (about −90 to −100 dBFS per 1/6 octave off a phone mic), so idle bars don't vanish.
- Labels stay dBFS or "relative dB", never SPL (ADR-0158).
- Listening and target editing draw this same view, so tapping Edit curve or Done never changes the scale (#1772).

### Relative to target (opt-in)

- Each bar = smoothed band level minus the level-matched target at that band.
- Fixed **±15 dB** grid with ticks every **5 dB**. The 0 line is the target, drawn solid (white, 85%).
- A small caption **"vs target, 0 = target"** sits above the plot, only in this view.
- With no target, deviations are relative to a flat line at the measured mean.
- Bars grow up or down from the 0 line. Values beyond ±15 dB clamp to the edge and show a **2 pt cap marker**.

The choice persists (iOS: `@AppStorage("analyze.rtaViewMode")`, Settings > Analyzer). Target editing always draws Absolute: the handles reshape the dashed target over the dBFS bars.

**Default change and migration (#1772).** Relative was the default through iOS build 14. Against a mismatched target (for example full-band music graded against a speech curve) it pinned both ends at ±15 dB and read as broken, so Absolute is now the default on every surface. On iOS, the first launch with this change runs `RTAViewMode.migrateToAbsoluteDefault(in:)` once: a stored `relative` is reset to `absolute`, and `analyze.rtaViewMode.absoluteDefaultMigrated` is set. A Relative chosen in Settings after that sticks. The pegged-bars "switch to Absolute" hint proposed in #1772's first draft is not built; the Absolute default removes the need for it.

## 2. Band grid

**1/6 octave, base 2, anchored at 1 kHz, 20 Hz to 20 kHz (about 60 bands)**: iOS `RTALayout.standard`. Mac and web power-sum (or interpolate) onto it. The desk's 1/10-octave bins power-sum into the 1/6-octave bands. The 48-point spectrum.py grid stays the analysis and coaching grid; only the display changes.

## 3. Target convention vs band-sum bars

Target curves (`IdealCurve.dbOffsets`) are in the mean-power-per-FFT-bin (PSD) convention. Bars that are **power sums** over 1/6-octave bands read `10 * log10(fc / 1 kHz)` dB higher for the same PSD. So when the bars are band sums, the target must be drawn as

```
display(fc) = offset(fc) + 10 * log10(fc / 1000 Hz)
```

before level matching. The Relative view subtracts this corrected target, otherwise it inherits a 3 dB/octave tilt. Edits and saved curves stay uncorrected. Details: [rta-target-convention.md](rta-target-convention.md) (#1726).

## 4. Ballistics

Exponential time-weighted averaging per band in the **power** domain, evaluated with each step's real `dt`:

```
p_in = 10^(L_in / 10)
tau  = attack if p_in > p else release
p   += (1 - exp(-dt / tau)) * (p_in - p)
L    = 10 * log10(p)
```

| Setting | Attack tau | Release tau |
|---|---|---|
| **Medium (default)** | 0.1 s | 1.0 s |
| Slow (optional) | 0.25 s | 1.5 s |

Medium was 0.05 s / 0.4 s until #1772; on live FOH and pink noise that read as jerky bars. Both taus at least doubled, and Medium stays quicker than Slow.

- The first frame (or a band-count change) is adopted as-is.
- A held input stays exactly put.
- After a drop, one release tau later the bar has decayed about 63% of the step **in power** (1.0 s on Medium). This replaces iOS's old instant attack and linear 40 dB/s release, which made the bars look tall and flat.
- Non-finite inputs read as the analyzer's silence floor (−120 dBFS).
- The choice persists (iOS: `@AppStorage("analyze.rtaBallistics")`, Settings > Analyzer).

## 5. Peak hold

Per band: hold **1.5 s**, then fall at **20 dB/s**, never below the bar. A new value at or above the tick restarts the hold. The fall uses only the part of each step past the hold, so it is frame-rate independent. Drawn as a thin 2 pt white tick (90% opacity) in both views; in Relative it is the peak of the deviation.

## 6. Rendering

At least 30 fps (the display refresh). Ballistics run per rendered frame with the latest analysis frame as input, so motion interpolates smoothly between 10 to 20 Hz analysis frames. A step longer than 0.25 s is capped (a view coming back on screen settles in one frame). iOS: `RTAFrameStepper` driven by `TimelineView(.animation)` while live.

## 7. Color

- Bars are semi-transparent (fill opacity 0.55 to 0.7; iOS uses 0.6), so the target and EQ curve stay visible behind them.
- Relative: |deviation| ≤ 3 dB neutral gray; over target amber `#FFA833`; under target cyan `#40D9FF` (the iOS problem-marker palette).
- Absolute: the existing warm-lows / cool-highs ramp (`RTAColor`).
- Target line: white, 85%.

## 8. Parity fixture

Canonical vectors: [`rta-display-spec/fixtures/rta-display-v1.json`](rta-display-spec/fixtures/rta-display-v1.json), generated by `apps/ios/scripts/make_rta_display_fixture.py`. That is an independent stdlib-only Python reference of sections 1 to 5. Its tests are in `apps/ios/scripts/test_make_rta_display_fixture.py`.

Each case gives the ballistics setting, band centers, target display offsets (already bandwidth-corrected, or `null` for no target) and frames of `{dt, levelsDb}`. After each frame the expected entry gives:

- `levelsDb`: smoothed levels
- `absoluteFractions`: position in −96…0
- `peaksDb`: absolute peak ticks
- `relativeDb`: deviations, unclamped
- `relativeClampedDb` and `overflow` (`above`, `below` or `null`)
- `tone` (`neutral`, `over`, `under`)
- `relativePeaksDb`: deviation peak ticks

Every platform's tests run this file to **±0.01 dB**. iOS reads a byte-identical copy (`SoundBuddyKitTests/Fixtures/rta-display-v1.json`) and asserts it matches the canonical file. Regenerate both with:

```
python3 apps/ios/scripts/make_rta_display_fixture.py
```

#1772 changed the Medium taus and regenerated v1 in place (the drop case now runs a full 1.0 s release). The Mac port (`app/renderer/src/rta-display-model.ts`) covers only the band grid so far and the web analyzer has no shared ballistics yet, so neither needed a code change; both pick up the new constants from this file when they port section 4.

## Built-in mic limits (iOS, #1708)

What the phone or iPad RTA can and can't tell you:

- **Raw path, proven at runtime.** Capture runs in `.record` / `.measurement` mode with the input node's voice processing off (Sound Buddy never enables it), so there is no AGC or speech EQ. Settings > Mic path shows "Mic: Raw measurement ✓" with the mode, port, data source, polar pattern and sample rate the running capture actually got, or "Processed ⚠" with the reason. Capture start also logs one `mic` line (subsystem `com.soundbuddy.ios`).
- **Omni where offered.** When the built-in mic offers an omnidirectional pattern and the user hasn't picked a data source (Settings > Microphone), capture selects it rather than the speech-tuned cardioid/subcardioid sources.
- **Uncalibrated.** Built-in mics typically roll off below about 100 Hz and are uneven above about 10 kHz. Top, bottom, front and back sources differ from each other and between models. Treat the RTA's extremes as indicative, and compare like with like (same device, same source).
- **Levels stay estimates** (ADR-0158): dBFS or relative dB, never SPL. Mic calibration and external interfaces are out of scope.

## Desk RTA (#1704)

The desk RTA must render with this spec: the same grid (power-summed from the 100 bins), views, ballistics and peak hold. The desk's own `rta/decay` already smooths `/meters/15`. #1704 must document that, and must not write desk prefs (ADR-0161).
