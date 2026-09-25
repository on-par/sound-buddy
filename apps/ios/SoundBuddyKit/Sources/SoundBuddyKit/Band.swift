/// The canonical 7-band split. Mirrors BAND_METADATA in
/// packages/audio-engine/src/bands.ts exactly (BandTests parses that file and
/// fails on drift) — change bands there first, then here.
public enum Band: String, CaseIterable, Codable, Sendable {
    case subBass, bass, lowMid, mid, highMid, presence, brilliance

    public var label: String {
        switch self {
        case .subBass: "Sub-bass"
        case .bass: "Bass"
        case .lowMid: "Low-mid"
        case .mid: "Mid"
        case .highMid: "High-mid"
        case .presence: "Presence"
        case .brilliance: "Brilliance"
        }
    }

    public var lowHz: Double {
        switch self {
        case .subBass: 20
        case .bass: 60
        case .lowMid: 250
        case .mid: 500
        case .highMid: 2000
        case .presence: 4000
        case .brilliance: 6000
        }
    }

    public var highHz: Double {
        switch self {
        case .subBass: 60
        case .bass: 250
        case .lowMid: 500
        case .mid: 2000
        case .highMid: 4000
        case .presence: 6000
        case .brilliance: 20000
        }
    }

    /// Compact range label, e.g. "250-500 Hz" (matches bands.ts freqLabel).
    public var rangeLabel: String { "\(Int(lowHz))-\(Int(highHz)) Hz" }

    /// The band whose [lowHz, highHz) range holds `hz`; the top band's upper
    /// edge is inclusive. Nil outside 20 Hz-20 kHz.
    public static func containing(hz: Double) -> Band? {
        allCases.first { hz >= $0.lowHz && hz < $0.highHz }
            ?? (hz == Band.brilliance.highHz ? .brilliance : nil)
    }
}

/// One dB reading per band.
public struct BandLevels: Equatable, Sendable {
    public var db: [Band: Double]

    public init(db: [Band: Double]) {
        self.db = db
    }

    /// Missing bands read as the silence floor.
    public subscript(band: Band) -> Double {
        db[band] ?? SpectrumAnalyzer.silenceFloorDb
    }

    /// The band with the highest level (first in band order on ties).
    public var loudest: Band {
        Band.allCases.reduce(Band.subBass) { self[$1] > self[$0] ? $1 : $0 }
    }

    /// EQ bar heights in 0...1, relative to the loudest band: it fills the
    /// bar, and a band `rangeDb` or more below it is empty. Relative display
    /// is deliberate — phone-mic dB is uncalibrated. Silence is all-empty.
    public func barFractions(rangeDb: Double) -> [Band: Double] {
        let top = self[loudest]
        let silentInput = top <= SpectrumAnalyzer.silenceFloorDb
        return Dictionary(uniqueKeysWithValues: Band.allCases.map { band in
            let fraction = silentInput ? 0 : (self[band] - (top - rangeDb)) / rangeDb
            return (band, min(1, max(0, fraction)))
        })
    }

    public static let silent = BandLevels(
        db: Dictionary(uniqueKeysWithValues: Band.allCases.map { ($0, SpectrumAnalyzer.silenceFloorDb) })
    )
}
