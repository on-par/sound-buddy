import Foundation
import Testing
@testable import SoundBuddyKit

private let sampleRate = 48_000.0

private func sine(hz: Double, amplitude: Double, count: Int) -> [Float] {
    (0..<count).map { Float(amplitude * sin(2 * .pi * hz * Double($0) / sampleRate)) }
}

@Suite struct SpectrumAnalyzerTests {
    @Test func rejectsNonPowerOfTwoFFTSize() {
        #expect(throws: SpectrumAnalyzer.ConfigurationError.fftSizeNotPowerOfTwo(1000)) {
            try SpectrumAnalyzer(fftSize: 1000, sampleRate: sampleRate)
        }
    }

    /// The Simulator can report a 0 Hz input format (AURemoteIO -10851). Every
    /// unusable rate must throw, never trap converting bandHz / binHz to Int.
    @Test(arguments: [0.0, -48_000.0, .nan, .infinity, -.infinity])
    func rejectsAnUnusableSampleRate(_ rate: Double) {
        let error = #expect(throws: SpectrumAnalyzer.ConfigurationError.self) {
            try SpectrumAnalyzer(sampleRate: rate)
        }
        guard case .invalidSampleRate(let reported) = error else {
            Issue.record("expected invalidSampleRate, got \(String(describing: error))")
            return
        }
        #expect(reported.isNaN == rate.isNaN)
        if !rate.isNaN { #expect(reported == rate) }
        #expect(error?.errorDescription?.contains("sample rate") == true)
    }

    /// A positive but absurdly small rate makes bandHz / binHz overflow Int —
    /// it must still build, with every band out of range at the floor.
    @Test func aTinyPositiveSampleRateDoesNotTrap() throws {
        let analyzer = try SpectrumAnalyzer(fftSize: 1024, sampleRate: .leastNonzeroMagnitude)
        let levels = try analyzer.bandLevels(Array(repeating: 0.5, count: 1024))
        for band in Band.allCases {
            #expect(levels[band] == SpectrumAnalyzer.silenceFloorDb)
        }
    }

    @Test func rejectsFrameOfTheWrongLength() throws {
        let analyzer = try SpectrumAnalyzer(fftSize: 1024, sampleRate: sampleRate)
        #expect(throws: SpectrumAnalyzer.ConfigurationError.frameLengthMismatch(expected: 1024, got: 10)) {
            try analyzer.bandLevels(Array(repeating: 0, count: 10))
        }
    }

    @Test func silenceSitsAtTheFloorInEveryBand() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let levels = try analyzer.bandLevels(Array(repeating: 0, count: analyzer.fftSize))
        for band in Band.allCases {
            #expect(levels[band] == SpectrumAnalyzer.silenceFloorDb)
        }
    }

    @Test func aSineLightsUpItsOwnBand() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let levels = try analyzer.bandLevels(sine(hz: 1000, amplitude: 0.5, count: analyzer.fftSize))
        #expect(levels.loudest == .mid)
        let bassLevels = try analyzer.bandLevels(sine(hz: 100, amplitude: 0.5, count: analyzer.fftSize))
        #expect(bassLevels.loudest == .bass)
    }
}

/// Deterministic, seedable PRNG so the white-noise fixture is reproducible
/// across runs — no `SystemRandomNumberGenerator` anywhere in this file.
private struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// ProgramFeatures (#1690): the Swift inputs to ProgramContentClassifier,
/// computed from the same per-bin power spectrum as the 7 coaching bands.
@Suite struct ProgramFeaturesTests {
    @Test func aVoiceBandSineIsMostlyInTheSpeechBandWithACentroidNearIt() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let power = try analyzer.powerSpectrum(sine(hz: 1000, amplitude: 1.0, count: analyzer.fftSize))
        let features = analyzer.programFeatures(power: power, overallDb: -10)
        #expect(features.speechBandFraction > 0.95)
        #expect(features.subFraction < 0.01)
        #expect(features.airFraction < 0.01)
        #expect(abs(features.centroidHz - 1000) < 50)
        #expect(features.levelDb == -10)
    }

    @Test func aSubBassSineIsMostlyInTheSubBand() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let power = try analyzer.powerSpectrum(sine(hz: 60, amplitude: 1.0, count: analyzer.fftSize))
        let features = analyzer.programFeatures(power: power, overallDb: -10)
        #expect(features.subFraction > 0.9)
    }

    @Test func whiteNoiseIsFlatterThanASine() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        var rng = SplitMix64(seed: 42)
        let noise = (0..<analyzer.fftSize).map { _ in Float.random(in: -1...1, using: &rng) }
        let noisePower = try analyzer.powerSpectrum(noise)
        let noiseFeatures = analyzer.programFeatures(power: noisePower, overallDb: -10)

        let sinePower = try analyzer.powerSpectrum(sine(hz: 1000, amplitude: 1.0, count: analyzer.fftSize))
        let sineFeatures = analyzer.programFeatures(power: sinePower, overallDb: -10)

        #expect(noiseFeatures.flatness > 0.3)
        #expect(noiseFeatures.flatness > sineFeatures.flatness)
    }

    @Test func anAllZeroFrameGivesFiniteValues() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let power = [Float](repeating: 0, count: analyzer.fftSize / 2 + 1)
        let features = analyzer.programFeatures(power: power, overallDb: SpectrumAnalyzer.silenceFloorDb)
        #expect(features.speechBandFraction == 0)
        #expect(features.subFraction == 0)
        #expect(features.airFraction == 0)
        #expect(features.centroidHz == 0)
        #expect(features.flatness.isFinite)
    }

    @Test func analyzeAttachesNonNilProgramFeatures() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        let reading = try analyzer.analyze(sine(hz: 1000, amplitude: 0.5, count: analyzer.fftSize))
        #expect(reading.programFeatures != nil)
        #expect(reading.programFeatures?.levelDb == reading.overallDb)
    }
}

/// Golden-fixture parity with the Mac engine (packages/audio-engine/scripts/
/// spectrum.py). The fixture is generated by apps/ios/scripts/
/// make_spectrum_parity_fixture.py, which calls spectrum.py's own band
/// reduction — regenerate it there, never hand-edit it.
@Suite struct SpectrumParityTests {
    struct Fixture: Decodable {
        struct Tone: Decodable { let hz: Double; let amplitude: Double }
        struct Signal: Decodable { let sampleRate: Double; let fftSize: Int; let tones: [Tone] }
        let signal: Signal
        let expectedBandDb: [String: Double]
    }

    /// Max allowed |Swift − Python| per band. Swift runs Float32 vDSP,
    /// Python float64 numpy.
    static let toleranceDb = 0.05
    /// Only bands within this range of the loudest are compared: further down,
    /// Float32 rounding noise (~-140 dB relative) dominates the leakage floor.
    static let comparedRangeDb = 80.0

    @Test func singleFrameBandEnergyMatchesSpectrumPy() throws {
        let fixture = try JSONDecoder().decode(
            Fixture.self,
            from: Data(contentsOf: TestPaths.fixture("spectrum-parity.single-frame.json"))
        )
        let signal = fixture.signal
        let samples: [Float] = (0..<signal.fftSize).map { i in
            let t = Double(i) / signal.sampleRate
            return Float(signal.tones.reduce(0) { $0 + $1.amplitude * sin(2 * .pi * $1.hz * t) })
        }
        let analyzer = try SpectrumAnalyzer(fftSize: signal.fftSize, sampleRate: signal.sampleRate)
        let levels = try analyzer.bandLevels(samples)

        let loudest = try #require(fixture.expectedBandDb.values.max())
        var compared = 0
        for band in Band.allCases {
            let expected = try #require(fixture.expectedBandDb[band.rawValue], "fixture is missing \(band)")
            guard expected >= loudest - Self.comparedRangeDb else { continue }
            compared += 1
            #expect(abs(levels[band] - expected) <= Self.toleranceDb, "\(band): swift \(levels[band]) vs python \(expected)")
        }
        #expect(compared >= 3, "fixture should exercise several bands")
    }
}
