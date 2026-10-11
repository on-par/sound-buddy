import Foundation

/// Test-noise colors for the DEBUG `-testNoise` source (#1740).
public enum TestNoiseColor: String, CaseIterable, Sendable {
    /// Equal power per bin: reads +3 dB/octave on the band-sum RTA bars.
    case white
    /// -3 dB/octave per bin (equal power per octave): reads flat on the bars.
    case pink
}

/// Seeded Gaussian white or pink noise at about -20 dBFS RMS, deterministic
/// per seed so tests can pin it. Pink uses Paul Kellet's refined filter
/// (within about 0.05 dB of -3 dB/octave above 10 Hz).
public struct TestNoiseGenerator: Sendable {
    public let color: TestNoiseColor
    /// Target RMS (linear, full scale = 1): -20 dBFS.
    public static let rms: Double = 0.1
    /// Kellet filter output RMS for unit-variance white input (measured).
    private static let pinkFilterRMS = 3.05

    private var state: UInt64
    private var spare: Double?
    private var b = [Double](repeating: 0, count: 7)

    public init(color: TestNoiseColor, seed: UInt64) {
        self.color = color
        state = seed &* 0x9E37_79B9_7F4A_7C15 | 1
        // Settle the pink filter's slowest pole (about 900 samples) first.
        if color == .pink { _ = next(count: 8192) }
    }

    public mutating func next(count: Int) -> [Float] {
        (0..<count).map { _ in
            let w = gaussian()
            let x: Double
            switch color {
            case .white:
                x = w * Self.rms
            case .pink:
                x = pink(w) * Self.rms / Self.pinkFilterRMS
            }
            return Float(max(-1, min(1, x)))
        }
    }

    private mutating func pink(_ w: Double) -> Double {
        b[0] = 0.99886 * b[0] + w * 0.0555179
        b[1] = 0.99332 * b[1] + w * 0.0750759
        b[2] = 0.96900 * b[2] + w * 0.1538520
        b[3] = 0.86650 * b[3] + w * 0.3104856
        b[4] = 0.55000 * b[4] + w * 0.5329522
        b[5] = -0.7616 * b[5] - w * 0.0168980
        let out = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362
        b[6] = w * 0.115926
        return out
    }

    /// xorshift64* uniform in (0, 1).
    private mutating func uniform() -> Double {
        state ^= state >> 12
        state ^= state << 25
        state ^= state >> 27
        let r = state &* 0x2545_F491_4F6C_DD1D
        return (Double(r >> 11) + 0.5) / Double(1 << 53)
    }

    /// Box-Muller, unit variance.
    private mutating func gaussian() -> Double {
        if let s = spare { spare = nil; return s }
        let r = sqrt(-2 * log(uniform()))
        let theta = 2 * Double.pi * uniform()
        spare = r * sin(theta)
        return r * cos(theta)
    }
}

/// `-testNoise [pink|white]` (DEBUG only, #1740): which noise to play and the
/// target it should track once #1726's bandwidth correction is applied.
public enum TestNoiseDemo {
    public static let flag = "-testNoise"
    public static let pinkTargetId = "test-minus3-per-octave"
    public static let flatTargetId = "test-flat"

    /// nil when the flag is absent; a missing or unknown value means pink.
    public static func color(from arguments: [String]) -> TestNoiseColor? {
        guard let i = arguments.firstIndex(of: flag) else { return nil }
        let next = arguments.index(after: i)
        if next < arguments.endIndex, let color = TestNoiseColor(rawValue: arguments[next]) {
            return color
        }
        return .pink
    }

    /// Pink pairs with a -3 dB/octave target (0 dB at 1 kHz), white with
    /// flat. Both on the Mac's 48-point 20 Hz-20 kHz grid.
    public static func target(for color: TestNoiseColor) -> IdealCurve {
        let n = IdealCurve.gridPoints
        let ratio = IdealCurve.gridHighHz / IdealCurve.gridLowHz
        let freqs = (0..<n).map { IdealCurve.gridLowHz * pow(ratio, Double($0) / Double(n - 1)) }
        switch color {
        case .pink:
            return IdealCurve(
                id: pinkTargetId, label: "Test: -3 dB/oct", description: "Pink-noise reference (DEBUG).",
                freqs: freqs, dbOffsets: freqs.map { -3 * log2($0 / 1000) }
            )
        case .white:
            return IdealCurve(
                id: flatTargetId, label: "Test: flat", description: "White-noise reference (DEBUG).",
                freqs: freqs, dbOffsets: freqs.map { _ in 0 }
            )
        }
    }
}
