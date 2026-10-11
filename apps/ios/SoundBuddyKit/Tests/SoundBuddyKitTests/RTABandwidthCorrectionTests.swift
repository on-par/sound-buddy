import Foundation
import Testing
@testable import SoundBuddyKit

/// #1726: IdealCurve.dbOffsets are a mean-power-per-FFT-bin (PSD) shape, but
/// the RTA bars are power sums over 1/6-octave bands whose width grows with
/// frequency. The overlay therefore adds 10*log10(fc / 1 kHz) per band before
/// level-matching, so a target that matches the mix's PSD draws parallel to
/// its bars.
@Suite struct RTABandwidthCorrectionTests {
    private let layout = RTALayout.standard

    /// Exact band power of pink noise (PSD proportional to 1/f) over each
    /// layout band: the integral of 1/f from lowHz to highHz, ln(hi / lo),
    /// which is the same for every fractional-octave band.
    private func pinkBars(level: Double = -40) -> [Double] {
        let reference = log(layout.bands[0].highHz / layout.bands[0].lowHz)
        return layout.bands.map { level + 10 * log10(log($0.highHz / $0.lowHz) / reference) }
    }

    /// A target whose dbOffsets follow pink noise's PSD: -3 dB per octave,
    /// 0 dB at 1 kHz, on the Mac's 48-point grid.
    private let pinkTarget = IdealCurve(
        id: "pink", label: "Pink", description: "",
        freqs: IdealCurve.gridFreqs,
        dbOffsets: IdealCurve.gridFreqs.map { -10 * log10($0 / 1000) }
    )

    @Test func correctionIsZeroAtTheReferenceAndThreeDbPerOctave() {
        #expect(RTATarget.bandwidthReferenceHz == 1000)
        #expect(abs(RTATarget.bandwidthCorrectionDb(atHz: 1000)) < 1e-12)
        #expect(abs(RTATarget.bandwidthCorrectionDb(atHz: 2000) - 10 * log10(2.0)) < 1e-12)
        #expect(abs(RTATarget.bandwidthCorrectionDb(atHz: 500) + 10 * log10(2.0)) < 1e-12)
        #expect(abs(RTATarget.bandwidthCorrectionDb(atHz: 20_000) - 13.0103) < 1e-3)
    }

    @Test func pinkBarsAreFlat() {
        let bars = pinkBars()
        for bar in bars {
            #expect(abs(bar - bars[0]) < 1e-9, "pink noise has equal power in every 1/6-octave band")
        }
    }

    @Test func aPinkPsdTargetDrawsFlatOverPinkBars() throws {
        let bars = pinkBars()
        let drawn = try #require(RTATarget.levelMatched(offsets: RTATarget.resample(pinkTarget, onto: layout), measured: bars))
        for (target, bar) in zip(drawn, bars) {
            #expect(abs(target - bar) <= 0.5, "the level-matched pink target sits on the flat pink bars")
        }
    }

    /// Regression guard for the build 12 symptom: without the correction the
    /// same pink target tilts about 30 dB end to end across the bars.
    @Test func withoutTheCorrectionThePinkTargetWouldTiltAbout30Db() throws {
        let uncorrected = layout.bands.map { pinkTarget.offset(atHz: $0.centerHz) }
        let span = try #require(uncorrected.first) - (try #require(uncorrected.last))
        #expect(span > 25)
    }

    @Test func theFlatCurveDrawsRisingThreeDbPerOctaveFromOneKilohertz() {
        let drawn = RTATarget.resample(.flat, onto: layout)
        #expect(drawn.count == layout.bands.count)
        for (value, band) in zip(drawn, layout.bands) {
            #expect(abs(value - 10 * log10(band.centerHz / 1000)) <= 0.01)
        }
    }

    @Test func displayAndStoredOffsetsRoundTrip() {
        for hz in [20.0, 100, 1000, 4000, 18_000] {
            let stored = -7.25
            let display = RTATarget.displayOffsetDb(stored, atHz: hz)
            #expect(abs(display - (stored + RTATarget.bandwidthCorrectionDb(atHz: hz))) < 1e-12)
            #expect(abs(RTATarget.storedOffsetDb(fromDisplay: display, atHz: hz) - stored) < 1e-12)
        }
    }
}

@Suite struct TargetHandleDragBandwidthCorrectionTests {
    private let scale = RTAScale.standard

    @Test func theDisplayCorrectionDefaultsToZero() {
        let drag = TargetHandleDrag(handle: 0, startOffsetDb: -60, levelShiftDb: 5)
        #expect(drag.displayCorrectionDb == 0)
    }

    @Test func aDragMovesTheStoredOffsetByTheDraggedAmountWithNoBandwidthTerm() {
        let drag = TargetHandleDrag(handle: 7, startOffsetDb: 1, levelShiftDb: -40, displayCorrectionDb: 6.6)
        let result = drag.offsetDb(forTranslationFraction: 2 / scale.spanDb, scale: scale)
        #expect(abs(result - 3) < 1e-9)
    }

    @Test func clampingUsesTheCorrectedDisplayedValue() {
        let drag = TargetHandleDrag(handle: 7, startOffsetDb: -60, levelShiftDb: 5, displayCorrectionDb: 6.6)
        let up = drag.offsetDb(forTranslationFraction: 1000, scale: scale)
        #expect(abs((up + 5 + 6.6) - scale.ceilingDb) < 1e-9, "the drawn handle stops exactly at the ceiling")
        let down = drag.offsetDb(forTranslationFraction: -1000, scale: scale)
        #expect(abs((down + 5 + 6.6) - scale.floorDb) < 1e-9, "the drawn handle stops exactly at the floor")
    }
}
