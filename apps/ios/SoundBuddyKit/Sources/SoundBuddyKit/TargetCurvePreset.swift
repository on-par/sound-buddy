/// A bundled ideal curve offered as a one-tap starting point while editing
/// the Analyze target (#1560). Selecting one replaces the draft; it never
/// re-snapshots, so Cancel still restores the pre-edit curve.
public struct TargetCurvePreset: Equatable, Sendable, Identifiable {
    /// An IdealCurveLibrary built-in id.
    public let id: String
    /// Short pill title — not the curve's (longer) label.
    public let title: String

    public static let flat = TargetCurvePreset(id: IdealCurveLibrary.flatId, title: "Flat")
    public static let musicFullRange = TargetCurvePreset(id: IdealCurveLibrary.musicFullRangeId, title: "Music fullrange")
    public static let worshipService = TargetCurvePreset(id: IdealCurveLibrary.worshipServiceId, title: "Worship service")
    /// Pill order, left to right.
    public static let all: [TargetCurvePreset] = [flat, musicFullRange, worshipService]

    /// The bundled curve for this preset.
    public func curve(load: (String) throws -> IdealCurve = IdealCurveLibrary.builtIn(id:)) throws -> IdealCurve {
        try load(id)
    }
}
