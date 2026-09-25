import Foundation

/// P0 live coaching rule: compare the measured 7-band levels with an ideal
/// curve's per-band targets, level-matched (mean deviation subtracted, like
/// the Mac's profile comparison) so overall gain never triggers a hint.
///
/// TODO(shared-copy): message text is inline here. Move it to the shared
/// ADR 0028 template registry (exported as JSON) so Mac and iOS speak the same
/// coaching dialect; `data` already carries the {name} placeholder values.
/// TODO(parity): the Mac compares on the 48-point curve (ProfileComparison in
/// packages/audio-engine/src/profiles), not band-mean power. Switch once
/// SpectrumAnalyzer produces that curve.
public struct BandDeviationCoach: Sendable {
    /// Level-matched deviation (dB) a band needs before it gets a hint.
    public static let thresholdDb = 3.0
    /// Short coaching stack: the phone shows at most this many hints.
    public static let maxEvents = 3
    /// Below this loudest-band level there is too little signal to coach.
    public static let minimumSignalDb = -90.0
    /// `deviationDb` in the event data is rounded to this many decimals.
    private static let reportedDecimals = 10.0

    public let ideal: IdealCurve
    private let targets: [Band: Double]

    public init(ideal: IdealCurve) {
        self.ideal = ideal
        targets = ideal.bandTargets
    }

    public func events(for levels: BandLevels, sessionTime: Double) -> [CoachingEvent] {
        guard levels[levels.loudest] >= Self.minimumSignalDb else { return [] }
        let raw = Band.allCases.map { ($0, levels[$0] - (targets[$0] ?? 0)) }
        let mean = raw.reduce(0) { $0 + $1.1 } / Double(raw.count)
        return raw
            .map { (band: $0.0, deviation: $0.1 - mean) }
            .filter { abs($0.deviation) >= Self.thresholdDb }
            .sorted { abs($0.deviation) > abs($1.deviation) }
            .prefix(Self.maxEvents)
            .map { event(band: $0.band, deviation: $0.deviation, sessionTime: sessionTime) }
    }

    private func event(band: Band, deviation: Double, sessionTime: Double) -> CoachingEvent {
        let rounded = (abs(deviation) * Self.reportedDecimals).rounded() / Self.reportedDecimals
        let over = deviation > 0
        let amount = String(format: "%.1f", rounded)
        let message = over
            ? "\(band.label) is \(amount) dB over the target. Try a gentle cut around \(band.rangeLabel)."
            : "\(band.label) is \(amount) dB under the target. Try a gentle boost around \(band.rangeLabel)."
        return CoachingEvent(
            id: "\(CoachingEvent.RuleType.bandDeviation.rawValue)-\(band.rawValue)",
            ruleType: .bandDeviation,
            severity: .suggestion,
            band: band,
            message: message,
            data: [
                "band": .string(band.label),
                "deviationDb": .number(over ? rounded : -rounded),
                "range": .string(band.rangeLabel),
            ],
            source: .phoneMicEstimate,
            sessionTime: sessionTime
        )
    }
}
