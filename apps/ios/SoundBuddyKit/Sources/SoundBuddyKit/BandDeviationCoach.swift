import Foundation

/// P0 live coaching rule: compare the measured 7-band levels with an ideal
/// curve's per-band targets, level-matched (mean deviation subtracted, like
/// the Mac's profile comparison) so overall gain never triggers a hint.
/// `events(for:sessionTime:)` and `problemMarkers(for:)` both map over the
/// same private problem-band selection, so coaching cards and problem-marker
/// descriptors can never disagree about which bands are problems.
///
/// TODO(shared-copy): message text comes from BandCoachingCopy, a local table.
/// Swap it for the shared ADR 0028 template registry (exported as JSON) once
/// that registry gains a per-band "band vs ideal curve" template, so Mac and
/// iOS speak the same coaching dialect from one source.
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
        problemBands(for: levels).map { event(band: $0.band, deviation: $0.deviation, sessionTime: sessionTime) }
    }

    /// The same (band, direction, severity) selection as `events(for:sessionTime:)`,
    /// as typed data a view can draw instead of copy text — so a future marker UI can't
    /// drift from the coaching cards' threshold, silence-gate, level-match, and max-3 rules.
    public func problemMarkers(for levels: BandLevels) -> [ProblemMarkerDescriptor] {
        problemBands(for: levels).map(Self.marker)
    }

    /// The signed, level-matched deviation (dB) of every band from the ideal
    /// curve for one reading — the raw input to the stabilized coaching path
    /// (#1715: CoachingDeltaSmoother -> CoachingStabilizer). Empty when the
    /// reading is below `minimumSignalDb`: too little signal to judge.
    public func deviations(for levels: BandLevels) -> [Band: Double] {
        deviations(for: levels, in: Set(Band.allCases))
    }

    /// Like `deviations(for:)`, but level-matched over `bands` only and
    /// returning only those bands (#1702): in Speech + bed the underscore's
    /// hot low end and air must not shift the voice bands' level match.
    public func deviations(for levels: BandLevels, in bands: Set<Band>) -> [Band: Double] {
        guard levels[levels.loudest] >= Self.minimumSignalDb else { return [:] }
        let raw = Band.allCases.filter(bands.contains).map { ($0, levels[$0] - (targets[$0] ?? 0)) }
        guard !raw.isEmpty else { return [:] }
        let mean = raw.reduce(0) { $0 + $1.1 } / Double(raw.count)
        return Dictionary(uniqueKeysWithValues: raw.map { ($0.0, $0.1 - mean) })
    }

    /// Cards for the stabilizer's visible `bands` (#1715), worded from the
    /// (smoothed) `deviations`, most severe first and capped at `maxEvents`.
    /// The stabilizer already decided which bands deserve a tip, so no
    /// threshold applies here; a visible band with no finite deviation is skipped.
    public func events(forDeviations deviations: [Band: Double], bands: Set<Band>, sessionTime: Double) -> [CoachingEvent] {
        selected(deviations, bands: bands).map { event(band: $0.band, deviation: $0.deviation, sessionTime: sessionTime) }
    }

    /// The problem markers matching `events(forDeviations:bands:sessionTime:)`.
    public func problemMarkers(forDeviations deviations: [Band: Double], bands: Set<Band>) -> [ProblemMarkerDescriptor] {
        selected(deviations, bands: bands).map(Self.marker)
    }

    private func selected(_ deviations: [Band: Double], bands: Set<Band>) -> [(band: Band, deviation: Double)] {
        Band.allCases
            .compactMap { band in deviations[band].flatMap { bands.contains(band) && $0.isFinite ? (band: band, deviation: $0) : nil } }
            .sorted { abs($0.deviation) > abs($1.deviation) }
            .prefix(Self.maxEvents)
            .map { $0 }
    }

    private static func marker(_ item: (band: Band, deviation: Double)) -> ProblemMarkerDescriptor {
        ProblemMarkerDescriptor(
            band: item.band,
            direction: item.deviation > 0 ? .overTarget : .underTarget,
            severityDb: roundedMagnitude(item.deviation)
        )
    }

    /// The gated, level-matched, thresholded, sorted, capped (band, signed deviation)
    /// list that both `events(for:sessionTime:)` and `problemMarkers(for:)` map over.
    private func problemBands(for levels: BandLevels) -> [(band: Band, deviation: Double)] {
        let deviations = deviations(for: levels)
        return Band.allCases
            .compactMap { band in deviations[band].map { (band: band, deviation: $0) } }
            .filter { abs($0.deviation) >= Self.thresholdDb }
            .sorted { abs($0.deviation) > abs($1.deviation) }
            .prefix(Self.maxEvents)
            .map { $0 }
    }

    private func event(band: Band, deviation: Double, sessionTime: Double) -> CoachingEvent {
        let rounded = Self.roundedMagnitude(deviation)
        let over = deviation > 0
        let message = BandCoachingCopy.message(band: band, amountDb: rounded, over: over)
        return CoachingEvent(
            id: "\(CoachingEvent.RuleType.bandDeviation.rawValue)-\(band.rawValue)",
            ruleType: .bandDeviation,
            severity: .suggestion,
            band: band,
            message: message,
            data: [
                "band": .string(band.label),
                "deviationDb": .number(over ? rounded : -rounded),
                "range": .string(BandCoachingCopy.rangeLabel(lowHz: band.lowHz, highHz: band.highHz)),
            ],
            source: .phoneMicEstimate,
            sessionTime: sessionTime
        )
    }

    private static func roundedMagnitude(_ deviation: Double) -> Double {
        (abs(deviation) * Self.reportedDecimals).rounded() / Self.reportedDecimals
    }
}
