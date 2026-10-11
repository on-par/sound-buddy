import Foundation

/// Raised when a shared-contract document is from a version this build can't read.
public enum ContractError: Error, Equatable, LocalizedError {
    case unsupportedSchemaVersion(contract: String, found: Int, supported: Int)

    public var errorDescription: String? {
        switch self {
        case .unsupportedSchemaVersion(let contract, let found, let supported):
            "\(contract) schemaVersion \(found) is not supported (this build reads v\(supported)) — update Sound Buddy on this device."
        }
    }
}

/// Codable model of apps/ios/Contracts/schemas/ideal-curve.v1.schema.json —
/// the Mac's IdealProfile (packages/audio-engine/src/profiles/index.ts) as a
/// versioned JSON contract. A relative, level-invariant target shape.
public struct IdealCurve: Codable, Equatable, Sendable {
    public enum ValidationError: Error, Equatable, LocalizedError {
        case lengthMismatch(freqs: Int, dbOffsets: Int)
        case freqsNotAscending

        public var errorDescription: String? {
            switch self {
            case .lengthMismatch(let freqs, let offsets):
                "Ideal curve has \(freqs) frequencies but \(offsets) offsets — re-export the profile so every frequency has one offset."
            case .freqsNotAscending:
                "Ideal curve frequencies must be strictly ascending — re-export the profile from the Mac."
            }
        }
    }

    public static let schemaVersion = 1
    /// The Mac grid: GRID_POINTS log-spaced centers, 20 Hz-20 kHz.
    public static let gridPoints = 48
    static let gridLowHz = 20.0
    static let gridHighHz = 20_000.0

    public let schemaVersion: Int
    public let id: String
    public let label: String
    public let description: String
    public let freqs: [Double]
    public let dbOffsets: [Double]

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, id, label, description, freqs, dbOffsets
    }

    public init(id: String, label: String, description: String, freqs: [Double], dbOffsets: [Double]) {
        schemaVersion = Self.schemaVersion
        self.id = id
        self.label = label
        self.description = description
        self.freqs = freqs
        self.dbOffsets = dbOffsets
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let version = try c.decode(Int.self, forKey: .schemaVersion)
        guard version == Self.schemaVersion else {
            throw ContractError.unsupportedSchemaVersion(contract: "IdealCurve", found: version, supported: Self.schemaVersion)
        }
        let freqs = try c.decode([Double].self, forKey: .freqs)
        let offsets = try c.decode([Double].self, forKey: .dbOffsets)
        guard freqs.count == offsets.count else {
            throw ValidationError.lengthMismatch(freqs: freqs.count, dbOffsets: offsets.count)
        }
        guard zip(freqs, freqs.dropFirst()).allSatisfy({ $0 < $1 }) else {
            throw ValidationError.freqsNotAscending
        }
        self.init(
            id: try c.decode(String.self, forKey: .id),
            label: try c.decode(String.self, forKey: .label),
            description: try c.decode(String.self, forKey: .description),
            freqs: freqs,
            dbOffsets: offsets
        )
    }

    /// The Mac grid frequencies (GRID_FREQS in profiles/index.ts).
    public static let gridFreqs: [Double] = (0..<gridPoints).map {
        gridLowHz * pow(gridHighHz / gridLowHz, Double($0) / Double(gridPoints - 1))
    }

    /// The Mac "flat" profile — the default target until profiles are loaded
    /// from shared JSON.
    public static let flat = IdealCurve(
        id: "flat",
        label: "Flat",
        description: "Neutral reference — no target tilt.",
        freqs: gridFreqs,
        dbOffsets: Array(repeating: 0, count: gridPoints)
    )

    /// Linear interpolation of the curve's dB shape in log-frequency, clamped
    /// to the grid's end values outside 20 Hz-20 kHz. Mirror of the Mac's
    /// `profileDbAt` (packages/audio-engine/src/profiles/index.ts). An empty
    /// curve is neutral (0 dB) — this can't come from the decoder (freqs and
    /// dbOffsets are always non-empty and equal length) but `init` is public.
    public func offset(atHz hz: Double) -> Double {
        guard let first = freqs.first, let last = freqs.last else { return 0 }
        if hz <= first { return dbOffsets[0] }
        if hz >= last { return dbOffsets[dbOffsets.count - 1] }
        var i = 1
        while i < freqs.count - 1 && freqs[i] < hz { i += 1 }
        let a = dbOffsets[i - 1]
        let b = dbOffsets[i]
        let t = (log2(hz) - log2(freqs[i - 1])) / (log2(freqs[i]) - log2(freqs[i - 1]))
        return a + (b - a) * t
    }

    /// Uniform-Hz samples taken per band when reducing the curve to a band
    /// target (BAND_TARGET_SAMPLES in the Mac's profiles/index.ts). Measured
    /// band levels are mean power over uniformly spaced FFT bins, so the curve
    /// is sampled the same way rather than on its own log grid; otherwise a
    /// wide band would be weighted toward its low edge.
    public static let bandTargetSamples = 256

    /// One target level per band: the power-domain mean of the curve sampled
    /// uniformly in Hz across the band, back in dB. A port of the Mac's
    /// `bandTargetsFromProfile` (packages/audio-engine/src/profiles/index.ts),
    /// pinned to it by the band-targets.v1.json golden fixture (#1724). An
    /// empty or length-mismatched curve is treated as flat (all zeros), and a
    /// band with no finite samples gets a neutral 0 dB, as on the Mac.
    public var bandTargets: [Band: Double] {
        let zero = Dictionary(uniqueKeysWithValues: Band.allCases.map { ($0, 0.0) })
        guard !freqs.isEmpty, freqs.count == dbOffsets.count else { return zero }
        let samples = Self.bandTargetSamples
        return Dictionary(uniqueKeysWithValues: Band.allCases.map { band in
            var powerSum = 0.0
            var n = 0
            for k in 0..<samples {
                let hz = band.lowHz + (band.highHz - band.lowHz) * (Double(k) + 0.5) / Double(samples)
                guard let db = finiteOffset(atHz: hz) else { continue }
                powerSum += pow(10, db / 10)
                n += 1
            }
            return (band, n > 0 ? 10 * log10(powerSum / Double(n)) : 0)
        })
    }

    /// `offset(atHz:)` with the Mac `profileDbAt`'s gap handling: a
    /// non-finite offset is skipped (its finite neighbour stands in, or nil
    /// when neither is finite), and a degenerate grid segment (duplicate or
    /// non-positive frequencies) holds the lower value instead of yielding NaN.
    /// Callers guarantee a non-empty curve with matching lengths.
    func finiteOffset(atHz hz: Double) -> Double? {
        let n = freqs.count
        func finite(_ x: Double) -> Double? { x.isFinite ? x : nil }
        if hz <= freqs[0] { return finite(dbOffsets[0]) }
        if hz >= freqs[n - 1] { return finite(dbOffsets[n - 1]) }
        var i = 1
        while i < n - 1 && freqs[i] < hz { i += 1 }
        let a = dbOffsets[i - 1]
        let b = dbOffsets[i]
        guard a.isFinite, b.isFinite else { return finite(a) ?? finite(b) }
        let t = (log2(hz) - log2(freqs[i - 1])) / (log2(freqs[i]) - log2(freqs[i - 1]))
        return t.isFinite ? a + (b - a) * t : a
    }
}
