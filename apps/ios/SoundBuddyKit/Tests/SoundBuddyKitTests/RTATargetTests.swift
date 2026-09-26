import Foundation
import Testing
@testable import SoundBuddyKit

private let epsilon = 1e-9

/// `offset(atHz:)`'s log-frequency interpolation is the base every overlay
/// resample (RTATarget.resample) depends on — it must never silently
/// index-pair a curve's own grid against an unrelated display grid.
@Suite struct IdealCurveOffsetTests {
    private let curve = IdealCurve(id: "t", label: "T", description: "", freqs: [100, 400, 1600], dbOffsets: [2, 6, -2])

    @Test func exactGridFrequencyReturnsItsOwnOffset() {
        #expect(abs(curve.offset(atHz: 400) - 6) < epsilon)
    }

    @Test func logMidpointBetweenTwoPointsAveragesThem() {
        let mid = sqrt(100 * 400) // the log-frequency midpoint of the first two points
        #expect(abs(curve.offset(atHz: mid) - 4) < epsilon)
    }

    @Test func belowTheFirstFrequencyClampsToTheFirstOffset() {
        #expect(curve.offset(atHz: 20) == 2)
    }

    @Test func aboveTheLastFrequencyClampsToTheLastOffset() {
        #expect(curve.offset(atHz: 20_000) == -2)
    }

    @Test func emptyCurveIsNeutral() {
        let empty = IdealCurve(id: "e", label: "E", description: "", freqs: [], dbOffsets: [])
        #expect(empty.offset(atHz: 1000) == 0)
    }
}

/// RTATarget resamples an IdealCurve onto a display grid (RTALayout) and
/// level-matches it to a measured curve — the Swift mirror of the Mac's
/// resample-then-levelMatchedTarget pipeline. Grids differ in length and
/// spacing, so this must never pair dbOffsets[i] with grid index i.
@Suite struct RTATargetResampleTests {
    private let layout = RTALayout.standard

    @Test func countMatchesTheLayoutBandCount() {
        #expect(RTATarget.resample(.flat, onto: layout).count == layout.bands.count)
    }

    @Test func flatCurveResamplesToAllZeros() {
        #expect(RTATarget.resample(.flat, onto: layout).allSatisfy { $0 == 0 })
    }

    @Test func eachValueIsTheCurvesOffsetAtItsBandCenter() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let offsets = RTATarget.resample(curve, onto: layout)
        #expect(offsets.count == layout.bands.count)
        for (offset, band) in zip(offsets, layout.bands) {
            #expect(abs(offset - curve.offset(atHz: band.centerHz)) < epsilon)
        }
    }

    /// Explicit regression guard for the "first N profile points as bars" bug
    /// the issue and ADR warn about: RTALayout has 59 bands, the curve has 48
    /// points, and their frequencies don't line up index-for-index.
    @Test func resamplingIsNotIndexPairingTheCurvesOwnGrid() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let offsets = RTATarget.resample(curve, onto: layout)
        let firstBand = try #require(layout.bands.first)
        #expect(abs(firstBand.centerHz - 22.1) < 0.5)
        #expect(abs(offsets[0] - 3) < 0.5, "band 0's ~22 Hz center sits in the curve's flat 3 dB plateau")
        #expect(abs(offsets[10] - 18) < 0.5, "band 10's ~70 Hz center sits in the curve's 18 dB plateau")
        #expect(offsets[10] != curve.dbOffsets[10], "index-pairing band 10 against dbOffsets[10] (16) would be wrong")
    }
}

@Suite struct RTATargetLevelMatchedTests {
    @Test func meanOfTheResultEqualsTheMeanOfTheMeasuredLevels() throws {
        let offsets = [0.0, 10.0, -10.0]
        let measured = [-40.0, -30.0, -50.0]
        let result = try #require(RTATarget.levelMatched(offsets: offsets, measured: measured))
        let measuredMean = measured.reduce(0, +) / Double(measured.count)
        let resultMean = result.reduce(0, +) / Double(result.count)
        #expect(abs(resultMean - measuredMean) < epsilon)
    }

    @Test func shiftingEveryMeasuredValueShiftsTheTargetByTheSameAmount() throws {
        let offsets = [0.0, 5.0, -5.0]
        let measured = [-40.0, -30.0, -50.0]
        let base = try #require(RTATarget.levelMatched(offsets: offsets, measured: measured))
        let shifted = try #require(RTATarget.levelMatched(offsets: offsets, measured: measured.map { $0 + 12 }))
        for (b, s) in zip(base, shifted) {
            #expect(abs(s - (b + 12)) < epsilon)
        }
    }

    @Test func flatOffsetsLandOnTheMeasuredMeanEverywhere() throws {
        let measured = [-20.0, -40.0, -30.0]
        let result = try #require(RTATarget.levelMatched(offsets: [0, 0, 0], measured: measured))
        let mean = measured.reduce(0, +) / Double(measured.count)
        for value in result {
            #expect(abs(value - mean) < epsilon)
        }
    }

    @Test func countMismatchIsNil() {
        #expect(RTATarget.levelMatched(offsets: [0, 0], measured: [0, 0, 0]) == nil)
    }

    @Test func emptyIsNil() {
        #expect(RTATarget.levelMatched(offsets: [], measured: []) == nil)
    }

    @Test func nonFiniteMeasuredEntriesAreSkippedFromTheMean() throws {
        let result = try #require(RTATarget.levelMatched(offsets: [0, 0, 0], measured: [-20, .nan, -40]))
        // Only -20 and -40 are finite; their mean is -30.
        for value in result {
            #expect(abs(value - (-30)) < epsilon)
        }
    }

    @Test func allNonFiniteMeasuredIsNil() {
        #expect(RTATarget.levelMatched(offsets: [0, 0], measured: [.nan, .infinity]) == nil)
    }
}
