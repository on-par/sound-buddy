import Foundation

/// One formatted band row for the read-only EQ panel: "N · type · freq ·
/// gain · Q", with gain/Q already dashed out for the cut types the curve
/// ignores their values for.
public struct ConsoleEQBandReadout: Equatable, Sendable {
    public let number: Int
    public let typeLabel: String
    public let freqText: String
    public let gainText: String
    public let qText: String
}

/// Everything the read-only EQ panel (#1669) needs to render, derived from
/// the selected target, its last known `ConsoleEQ` (nil until the first
/// `/node` or `/xremote` value arrives) and the console link's phase. Pure
/// value type: the view only renders what this computes.
public struct ConsoleEQPanelState: Equatable, Sendable {
    public static let curveMinHz = 20.0
    public static let curveMaxHz = 20_000.0
    public static let curvePointCount = 96
    public static let curveRangeDb = 18.0
    public static let readingPlaceholder = "Reading console EQ…"

    /// Log-spaced 20 Hz...20 kHz, inclusive, `curvePointCount` points.
    public static let curveFrequencies: [Double] = logSpaced(
        minHz: curveMinHz, maxHz: curveMaxHz, count: curvePointCount
    )

    /// Values whose magnitude is below this read as "0.0 dB" rather than
    /// "+0.0 dB" or "-0.0 dB".
    private static let gainEpsilon = 0.05

    public let target: ConsoleEQTarget
    public let eq: ConsoleEQ?
    public let phase: ConsoleSessionPhase
    /// Non-nil only while Main LR is selected and its EQ has been read
    /// (#1671) — `ConsoleTargetModel.eqPanel` is the only caller that passes
    /// one.
    public let coaching: ConsoleCoachingSuggestion?

    public init(target: ConsoleEQTarget, eq: ConsoleEQ?, phase: ConsoleSessionPhase, coaching: ConsoleCoachingSuggestion? = nil) {
        self.target = target
        self.eq = eq
        self.phase = phase
        self.coaching = coaching
    }

    /// Empty until a value has been read; otherwise one row per band.
    public var bandRows: [ConsoleEQBandReadout] {
        guard let eq else { return [] }
        return eq.bands.enumerated().map { index, band in
            ConsoleEQBandReadout(
                number: index + 1,
                typeLabel: Self.typeLabel(for: band.type),
                freqText: Self.freqText(band.freqHz),
                gainText: Self.gainText(band.type, band.gainDb),
                qText: Self.qText(band.type, band.q)
            )
        }
    }

    /// Nil until read, otherwise "EQ On" / "EQ Off".
    public var eqOnLabel: String? {
        guard let eq else { return nil }
        return eq.on ? "EQ On" : "EQ Off"
    }

    /// Nil for Main LR (no preamp HPF) or when unread; otherwise "HPF off"
    /// or "HPF <freq> · <slope> dB/oct".
    public var hpfText: String? {
        guard target.preampPath != nil else { return nil }
        guard let hpf = eq?.hpf else { return nil }
        guard hpf.on else { return "HPF off" }
        return "HPF \(Self.freqText(hpf.freqHz)) · \(hpf.slopeDbPerOctave) dB/oct"
    }

    /// Empty when unread; otherwise the magnitude response sampled on
    /// `curveFrequencies`, clamped to ±`curveRangeDb`.
    public var curveDb: [Double] {
        guard let eq else { return [] }
        return eq.magnitudeResponseDb(atHz: Self.curveFrequencies).map(Self.clamp)
    }

    /// Empty without a read EQ or a coaching suggestion; otherwise the desk's
    /// EQ with the suggested band substituted (and forced on), sampled and
    /// clamped the same way as `curveDb` — the dashed ghost curve (#1671).
    public var ghostCurveDb: [Double] {
        guard let eq, let coaching else { return [] }
        return ConsoleCoachingMapper.ghostEQ(eq, applying: coaching)
            .magnitudeResponseDb(atHz: Self.curveFrequencies)
            .map(Self.clamp)
    }

    /// True once a value has been read but the link is not currently up —
    /// the last-known values stay on screen, dimmed, rather than blanking.
    public var isDimmed: Bool { eq != nil && !phase.isLinkUp }

    /// Nil while the link is up; otherwise the same status copy as the
    /// console chip.
    public var statusPill: String? {
        phase.isLinkUp ? nil : ConsoleChipStatus(phase: phase).label
    }

    /// Nil once a value has been read.
    public var placeholder: String? { eq == nil ? Self.readingPlaceholder : nil }

    private static func logSpaced(minHz: Double, maxHz: Double, count: Int) -> [Double] {
        guard count > 1 else { return [minHz] }
        let logMin = log(minHz)
        let logMax = log(maxHz)
        return (0..<count).map { i in
            exp(logMin + (logMax - logMin) * Double(i) / Double(count - 1))
        }
    }

    private static func typeLabel(for type: ConsoleEQBandType) -> String {
        switch type {
        case .lowCut: return "Low cut"
        case .lowShelf: return "Low shelf"
        case .peaking: return "PEQ"
        case .vintagePeaking: return "VEQ"
        case .highShelf: return "High shelf"
        case .highCut: return "High cut"
        }
    }

    /// Internal (not private) so `ConsoleCoachingMapper` (#1671) reuses the
    /// same "80 Hz" / "1.0 kHz" formatting for its ghost-band copy.
    static func freqText(_ hz: Double) -> String {
        hz < 1000 ? String(format: "%.0f Hz", hz) : String(format: "%.1f kHz", hz / 1000)
    }

    /// Shared by `curveDb` and `ghostCurveDb`: clamps a raw dB magnitude to
    /// ±`curveRangeDb`.
    private static func clamp(_ db: Double) -> Double {
        min(curveRangeDb, max(-curveRangeDb, db))
    }

    /// The curve ignores a cut band's own gain/Q (ConsoleEQCurve always
    /// draws it as a fixed-Q Butterworth section), so the readout dashes
    /// them out instead of showing a number the curve doesn't use.
    private static func gainText(_ type: ConsoleEQBandType, _ db: Double) -> String {
        guard type != .lowCut, type != .highCut else { return "—" }
        if abs(db) < gainEpsilon { return "0.0 dB" }
        return String(format: "%+.1f dB", db)
    }

    private static func qText(_ type: ConsoleEQBandType, _ q: Double) -> String {
        guard type != .lowCut, type != .highCut else { return "—" }
        return String(format: "%.1f", q)
    }
}
