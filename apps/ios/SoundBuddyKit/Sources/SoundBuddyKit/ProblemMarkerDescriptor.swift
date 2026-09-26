import Foundation

/// One non-text "problem band" marker: the band BandDeviationCoach would put on a
/// coaching card, as data a view can draw (Hz range, over/under, how far off).
/// Produced only by BandDeviationCoach.problemMarkers(for:), so markers and
/// coaching cards always agree on which bands are problems.
public struct ProblemMarkerDescriptor: Equatable, Identifiable, Sendable {
    /// Which side of the level-matched target the band sits on.
    public enum Direction: String, Equatable, Sendable {
        /// Louder than target — the coaching card suggests a cut (warm marker).
        case overTarget
        /// Quieter than target — the coaching card suggests a boost (cool marker).
        case underTarget
    }

    public let band: Band
    public let direction: Direction
    /// Level-matched deviation magnitude in dB (>= BandDeviationCoach.thresholdDb),
    /// rounded like the coaching event's `deviationDb`.
    public let severityDb: Double

    public init(band: Band, direction: Direction, severityDb: Double) {
        self.band = band
        self.direction = direction
        self.severityDb = severityDb
    }

    /// Stable per band — matches the band-deviation CoachingEvent id suffix.
    public var id: String { band.rawValue }
    public var lowHz: Double { band.lowHz }
    public var highHz: Double { band.highHz }
}
