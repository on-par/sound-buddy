import Foundation
import Testing
@testable import SoundBuddyKit

/// #1740: the debug test-noise source that proves #1726's bandwidth
/// correction on the simulator. Real noise goes through the real
/// SpectrumAnalyzer (1/6-octave band sums), and the bars must track the
/// corrected target: pink noise against a -3 dB/oct target, white noise
/// against flat.
@Suite struct TestNoiseTests {
    private static let sampleRate = 48_000.0
    private static let frames = 64
    /// Bands with enough FFT bins (4096 at 48 kHz) that bin quantization and
    /// frame-to-frame variance stay under a dB; the low bands hold 1-3 bins.
    private static let lowHz = 500.0
    private static let highHz = 12_000.0

    /// Mean band power (dB) over `frames` analyzed frames of `color` noise.
    private static func averagedRTA(_ color: TestNoiseColor, seed: UInt64 = 1) throws -> [Double] {
        let analyzer = try SpectrumAnalyzer(sampleRate: sampleRate)
        var generator = TestNoiseGenerator(color: color, seed: seed)
        var power = [Double](repeating: 0, count: RTALayout.standard.bands.count)
        for _ in 0..<frames {
            let reading = try analyzer.analyze(generator.next(count: analyzer.fftSize))
            for (i, db) in reading.rtaDb.enumerated() { power[i] += pow(10, db / 10) }
        }
        return power.map { 10 * log10($0 / Double(frames)) }
    }

    /// Measured minus level-matched corrected target, for bands in range,
    /// as (log2(hz/1k), deviation dB).
    private static func deviations(_ measured: [Double], target: IdealCurve) -> [(octaves: Double, db: Double)] {
        let bands = RTALayout.standard.bands
        let indices = bands.indices.filter { bands[$0].centerHz >= lowHz && bands[$0].centerHz <= highHz }
        let offsets = RTATarget.resample(target, onto: .standard)
        let m = indices.map { measured[$0] }
        let t = indices.map { offsets[$0] }
        let matched = RTATarget.levelMatched(offsets: t, measured: m)!
        return indices.indices.map { k in (log2(bands[indices[k]].centerHz / 1000), m[k] - matched[k]) }
    }

    /// Least-squares slope (dB per octave).
    private static func slope(_ points: [(octaves: Double, db: Double)]) -> Double {
        let n = Double(points.count)
        let mx = points.map(\.octaves).reduce(0, +) / n
        let my = points.map(\.db).reduce(0, +) / n
        let sxy = points.reduce(0) { $0 + ($1.octaves - mx) * ($1.db - my) }
        let sxx = points.reduce(0) { $0 + ($1.octaves - mx) * ($1.octaves - mx) }
        return sxy / sxx
    }

    @Test func pinkNoiseBarsTrackTheMinus3dBPerOctaveTarget() throws {
        let dev = Self.deviations(try Self.averagedRTA(.pink), target: TestNoiseDemo.target(for: .pink))
        #expect(abs(Self.slope(dev)) < 0.5, "slope \(Self.slope(dev)) dB/oct")
        #expect(dev.allSatisfy { abs($0.db) < 2 }, "\(dev.map(\.db))")
    }

    @Test func whiteNoiseBarsTrackTheFlatTarget() throws {
        let dev = Self.deviations(try Self.averagedRTA(.white), target: TestNoiseDemo.target(for: .white))
        #expect(abs(Self.slope(dev)) < 0.5, "slope \(Self.slope(dev)) dB/oct")
        #expect(dev.allSatisfy { abs($0.db) < 2 }, "\(dev.map(\.db))")
    }

    /// Negative control: the check can tell a wrong pairing apart.
    @Test func pinkNoiseAgainstFlatLeansMinus3dBPerOctave() throws {
        let dev = Self.deviations(try Self.averagedRTA(.pink), target: TestNoiseDemo.target(for: .white))
        #expect(abs(Self.slope(dev) + 3) < 0.6, "slope \(Self.slope(dev)) dB/oct")
    }

    @Test func pinkNoisePowerSpectrumFallsThreeDBPerOctave() throws {
        let analyzer = try SpectrumAnalyzer(sampleRate: Self.sampleRate)
        var generator = TestNoiseGenerator(color: .pink, seed: 7)
        var bins = [Double](repeating: 0, count: analyzer.fftSize / 2 + 1)
        for _ in 0..<Self.frames {
            for (i, p) in try analyzer.powerSpectrum(generator.next(count: analyzer.fftSize)).enumerated() { bins[i] += Double(p) }
        }
        let binHz = Self.sampleRate / Double(analyzer.fftSize)
        func octaveDb(_ lo: Double) -> Double {
            let range = Int(lo / binHz)...Int(2 * lo / binHz)
            return 10 * log10(range.map { bins[$0] }.reduce(0, +) / Double(range.count))
        }
        // Mean per-bin power drops 3 dB per octave: 500-1k vs 4-8k is 9 dB.
        #expect(abs((octaveDb(500) - octaveDb(4000)) - 9) < 1)
    }

    @Test func generatorIsDeterministicPerSeedAndAtAModestLevel() {
        var a = TestNoiseGenerator(color: .white, seed: 42)
        var b = TestNoiseGenerator(color: .white, seed: 42)
        var c = TestNoiseGenerator(color: .white, seed: 43)
        let x = a.next(count: 4096)
        #expect(x == b.next(count: 4096))
        #expect(x != c.next(count: 4096))
        for color in TestNoiseColor.allCases {
            var g = TestNoiseGenerator(color: color, seed: 3)
            let s = g.next(count: 48_000)
            let rms = sqrt(s.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(s.count))
            let rmsDb = 20 * log10(rms)
            #expect(rmsDb > -30 && rmsDb < -14, "\(color) rms \(rmsDb) dBFS")
            #expect(s.allSatisfy { $0.isFinite && abs($0) <= 1 })
        }
    }

    @Test func launchFlagPicksTheColorAndItsTarget() {
        #expect(TestNoiseDemo.color(from: ["app", "-testNoise", "white"]) == .white)
        #expect(TestNoiseDemo.color(from: ["app", "-testNoise", "pink"]) == .pink)
        #expect(TestNoiseDemo.color(from: ["app", "-testNoise"]) == .pink, "bare flag defaults to pink")
        #expect(TestNoiseDemo.color(from: ["app", "-testNoise", "-openSettings"]) == .pink)
        #expect(TestNoiseDemo.color(from: ["app", "-coachingDemo"]) == nil)
        let pink = TestNoiseDemo.target(for: .pink)
        #expect(abs((pink.offset(atHz: 2000) - pink.offset(atHz: 1000)) + 3) < 0.05, "-3 dB per octave")
        #expect(abs((pink.offset(atHz: 100) - pink.offset(atHz: 10_000)) - 3 * log2(100.0)) < 0.1)
        let flat = TestNoiseDemo.target(for: .white)
        #expect(flat.dbOffsets.allSatisfy { $0 == 0 })
        #expect(pink.freqs.count == IdealCurve.gridPoints && flat.freqs.count == IdealCurve.gridPoints)
    }

    @Test func testNoiseNeverPromptsForTheMic() {
        #expect(DebugLaunchOptions.skipsMicPermissionPrompt(["app", "-testNoise"]))
        #expect(DebugLaunchOptions.skipsMicPermissionPrompt(["app", "-testNoise", "white"]))
    }
}
