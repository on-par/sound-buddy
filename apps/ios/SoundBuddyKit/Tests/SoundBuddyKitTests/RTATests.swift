import Foundation
import Testing
@testable import SoundBuddyKit

private let sampleRate = 48_000.0
private let epsilon = 1e-9

private func sine(hz: Double, amplitude: Double, count: Int) -> [Float] {
    (0..<count).map { Float(amplitude * sin(2 * .pi * hz * Double($0) / sampleRate)) }
}

@Suite struct RTALayoutTests {
    let layout = RTALayout.standard

    @Test func sixthOctaveBandsSpanTwentyHertzToTwentyKilohertz() throws {
        #expect(layout.bands.count == 59)
        let first = try #require(layout.bands.first)
        let last = try #require(layout.bands.last)
        #expect(first.centerHz >= RTALayout.minHz)
        #expect(last.centerHz <= RTALayout.maxHz)
        // Anchored on 1 kHz like console RTAs.
        #expect(layout.bands.contains { abs($0.centerHz - 1000) < epsilon })
    }

    @Test func bandsAreContiguousAndLogSpaced() {
        for (a, b) in zip(layout.bands, layout.bands.dropFirst()) {
            #expect(abs(a.highHz - b.lowHz) < epsilon)
            #expect(abs(b.centerHz / a.centerHz - pow(2, 1.0 / 6)) < epsilon)
        }
    }

    @Test func xFractionIsLogarithmicAndClamped() {
        #expect(abs(RTALayout.xFraction(hz: 20)) < epsilon)
        #expect(abs(RTALayout.xFraction(hz: 20_000) - 1) < epsilon)
        #expect(abs(RTALayout.xFraction(hz: sqrt(20 * 20_000)) - 0.5) < epsilon)
        #expect(RTALayout.xFraction(hz: 5) == 0)
        #expect(RTALayout.xFraction(hz: 40_000) == 1)
    }

    @Test func frequencyTicksRunLowToHighWithConsoleLabels() {
        let labels = RTALayout.frequencyTicks.map(\.label)
        #expect(labels.first == "20")
        #expect(labels.contains("1k"))
        #expect(labels.last == "20k")
        let hz = RTALayout.frequencyTicks.map(\.hz)
        #expect(hz == hz.sorted())
    }
}

@Suite struct RTAScaleTests {
    let scale = RTAScale.standard

    @Test func fractionMapsTheWindowToZeroThroughOne() {
        #expect(scale.fraction(db: scale.ceilingDb) == 1)
        #expect(scale.fraction(db: scale.floorDb) == 0)
        #expect(abs(scale.fraction(db: (scale.floorDb + scale.ceilingDb) / 2) - 0.5) < epsilon)
    }

    @Test func fractionClampsOutsideTheWindow() {
        #expect(scale.fraction(db: scale.ceilingDb + 20) == 1)
        #expect(scale.fraction(db: SpectrumAnalyzer.silenceFloorDb) == 0)
    }

    @Test func dbTicksCoverTheWindowTopDown() {
        #expect(scale.dbTicks.first == scale.ceilingDb)
        #expect(scale.dbTicks.last == scale.floorDb)
        #expect(scale.dbTicks == scale.dbTicks.sorted(by: >))
    }
}

@Suite struct RTAMeterTests {
    @Test func startsEmptyAndAdoptsTheFirstReading() {
        var meter = RTAMeter()
        #expect(meter.levels.isEmpty)
        meter.ingest([-40, -60], dt: 0.05)
        #expect(meter.levels == [-40, -60])
        #expect(meter.peaks == [-40, -60])
    }

    @Test func barsRiseInstantlyButFallAtTheReleaseRate() {
        var meter = RTAMeter()
        meter.ingest([-60], dt: 0.05)
        meter.ingest([-20], dt: 0.05)
        #expect(meter.levels == [-20])
        meter.ingest([-80], dt: 0.1)
        #expect(abs(meter.levels[0] - (-20 - RTAMeter.releaseDbPerSecond * 0.1)) < epsilon)
    }

    @Test func peaksHoldThenFall() {
        var meter = RTAMeter()
        meter.ingest([-10], dt: 0)
        meter.ingest([-80], dt: RTAMeter.peakHoldSeconds / 2)
        #expect(meter.peaks == [-10], "still inside the hold window")
        meter.ingest([-80], dt: RTAMeter.peakHoldSeconds)
        #expect(meter.peaks[0] < -10, "hold expired, the tick falls")
        #expect(meter.peaks[0] >= meter.levels[0], "a peak never sits below its bar")
    }

    @Test func aNewPeakRestartsTheHold() {
        var meter = RTAMeter()
        meter.ingest([-30], dt: 0)
        meter.ingest([-80], dt: RTAMeter.peakHoldSeconds * 2)
        meter.ingest([-5], dt: 0.05)
        #expect(meter.peaks == [-5])
        meter.ingest([-80], dt: RTAMeter.peakHoldSeconds / 2)
        #expect(meter.peaks == [-5])
    }

    @Test func aBandCountChangeResetsTheMeter() {
        var meter = RTAMeter()
        meter.ingest([-10, -10], dt: 0)
        meter.ingest([-50, -50, -50], dt: 0.05)
        #expect(meter.levels == [-50, -50, -50])
        #expect(meter.peaks == [-50, -50, -50])
    }

    @Test func resetClearsEverything() {
        var meter = RTAMeter()
        meter.ingest([-10], dt: 0)
        meter.reset()
        #expect(meter.levels.isEmpty)
        #expect(meter.peaks.isEmpty)
    }

    @Test func aNegativeTimeStepIsTreatedAsZero() {
        var meter = RTAMeter()
        meter.ingest([-10], dt: 0)
        meter.ingest([-80], dt: -5)
        #expect(meter.levels == [-10])
    }
}

@Suite struct RTAColorTests {
    @Test func hotLowsAreWarmAndQuietLowsAreGreen() {
        let hot = RTAColor.hsb(hz: 60, fraction: 1)
        let quiet = RTAColor.hsb(hz: 60, fraction: 0)
        #expect(hot.hue < 0.1, "orange/red")
        #expect(abs(quiet.hue - RTAColor.greenHue) < epsilon)
    }

    @Test func midsAndHighsAreCoolAndBluerWithFrequency() {
        let mid = RTAColor.hsb(hz: 1000, fraction: 1)
        let high = RTAColor.hsb(hz: 16_000, fraction: 1)
        #expect(mid.hue >= RTAColor.cyanHue - epsilon)
        #expect(high.hue > mid.hue)
        #expect(high.hue <= RTAColor.blueHue + epsilon)
    }

    @Test func louderIsBrighter() {
        #expect(RTAColor.hsb(hz: 1000, fraction: 1).brightness > RTAColor.hsb(hz: 1000, fraction: 0.1).brightness)
    }
}

@Suite struct SpectrumAnalyzerRTATests {
    @Test func analyzeReturnsBothTheCoachBandsAndTheRTA() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let frame = sine(hz: 1000, amplitude: 0.5, count: analyzer.fftSize)
        let reading = try analyzer.analyze(frame)
        #expect(reading.bands == (try analyzer.bandLevels(frame)))
        #expect(reading.rtaDb.count == RTALayout.standard.bands.count)
    }

    @Test func aSineLightsItsRTABandAtItsDbfsLevel() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(sine(hz: 1000, amplitude: 0.5, count: analyzer.fftSize))
        let index = try #require(RTALayout.standard.bands.firstIndex { abs($0.centerHz - 1000) < epsilon })
        let loudest = try #require(reading.rtaDb.indices.max { reading.rtaDb[$0] < reading.rtaDb[$1] })
        #expect(loudest == index)
        // Half-scale sine ≈ -6 dBFS (Hann leakage adds a fraction of a dB).
        #expect(abs(reading.rtaDb[index] - (-6)) < 1)
        let far = try #require(RTALayout.standard.bands.firstIndex { $0.centerHz > 8000 })
        #expect(reading.rtaDb[far] < reading.rtaDb[index] - 60)
    }

    @Test func lowBandsNarrowerThanABinStillReadTheirTone() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(sine(hz: 25, amplitude: 0.5, count: analyzer.fftSize))
        let low = try #require(RTALayout.standard.bands.firstIndex { $0.highHz > 25 })
        #expect(reading.rtaDb[low] > -40)
        #expect(reading.rtaDb[low] > SpectrumAnalyzer.silenceFloorDb)
    }

    @Test func silenceSitsAtTheFloorInEveryRTABand() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(Array(repeating: 0, count: analyzer.fftSize))
        #expect(reading.rtaDb.allSatisfy { $0 == SpectrumAnalyzer.silenceFloorDb })
    }

    @Test func bandsAboveNyquistSitAtTheFloor() throws {
        let lowRate = 16_000.0
        let analyzer = try SpectrumAnalyzer(fftSize: 1024, sampleRate: lowRate)
        let frame: [Float] = (0..<1024).map { Float(0.5 * sin(2 * .pi * 1000 * Double($0) / lowRate)) }
        let reading = try analyzer.analyze(frame)
        for (band, db) in zip(RTALayout.standard.bands, reading.rtaDb) where band.lowHz > lowRate / 2 {
            #expect(db == SpectrumAnalyzer.silenceFloorDb)
        }
    }

    // MARK: Overall level
    //
    // overall = 10·log10(Σ_{k=1}^{N/2} P[k] / (N·Σw²/4)), P on numpy rfft
    // scale, w = periodic Hann; tolerance 0.5 dB covers Float32 vDSP and
    // bin-leakage error.

    @Test func aFullScaleSineReadsZeroDbfsOverall() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(sine(hz: 1000, amplitude: 1.0, count: analyzer.fftSize))
        #expect(abs(reading.overallDb) < 0.5)
    }

    @Test func aHalfScaleSineReadsAboutMinusSixOverall() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(sine(hz: 1000, amplitude: 0.5, count: analyzer.fftSize))
        #expect(abs(reading.overallDb - (-6.02)) < 0.5)
    }

    @Test func overallMatchesTheToneRTABand() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(sine(hz: 1000, amplitude: 0.5, count: analyzer.fftSize))
        let index = try #require(RTALayout.standard.bands.firstIndex { abs($0.centerHz - 1000) < epsilon })
        #expect(abs(reading.overallDb - reading.rtaDb[index]) < 1)
    }

    @Test func silenceReadsTheFloorOverall() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(Array(repeating: 0, count: analyzer.fftSize))
        #expect(reading.overallDb == SpectrumAnalyzer.silenceFloorDb)
    }

    @Test func dcOffsetDoesNotReadAsLevel() throws {
        // A periodic Hann window is itself not flat: it has an exact,
        // non-leakage AC component at bin 1 (0.5 - 0.5cos(2*pi*n/N) is a
        // 3-term sum with tones at bins 0 and ±1), so a DC bias half full
        // scale — an unrealistically large sensor offset — still shows up
        // at bins > 0 around -7.8 dBFS. A realistic tiny offset stays well
        // below the silence floor's neighborhood.
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(Array(repeating: Float(0.0001), count: analyzer.fftSize))
        #expect(reading.overallDb < -60)
    }

    @Test func twoTonesSumInPower() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let frame = zip(
            sine(hz: 1000, amplitude: 0.5, count: analyzer.fftSize),
            sine(hz: 5000, amplitude: 0.5, count: analyzer.fftSize)
        ).map(+)
        let reading = try analyzer.analyze(frame)
        #expect(abs(reading.overallDb - (-3.01)) < 0.5)
    }
}
