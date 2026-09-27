/// In-place edit mode for the Analyze target curve (#1558). Entering
/// snapshots the active curve + auto flag; Cancel hands the snapshot back,
/// Done hands the draft back. Pure, so the transitions are tested here.
public struct TargetCurveEditor: Equatable, Sendable {
    public struct Resolution: Equatable, Sendable {
        public let curve: IdealCurve
        public let isAuto: Bool
    }

    public static let chipTitle = "Editing target"

    /// nil ⇔ not editing.
    public private(set) var original: IdealCurve?
    public private(set) var originalIsAuto = false
    public private(set) var draft: IdealCurve?

    public init() {}

    public var isEditing: Bool { original != nil }

    /// No-op while already editing (keeps the first snapshot).
    public mutating func begin(active: IdealCurve, isAuto: Bool) {
        guard !isEditing else { return }
        original = active
        originalIsAuto = isAuto
        draft = active
    }

    /// Replaces the draft; returns false (no-op) when not editing.
    @discardableResult
    public mutating func updateDraft(_ curve: IdealCurve) -> Bool {
        guard isEditing else { return false }
        draft = curve
        return true
    }

    /// Exit, handing back the pre-edit curve + flag; nil when not editing.
    public mutating func cancel() -> Resolution? {
        guard let original else { return nil }
        let resolution = Resolution(curve: original, isAuto: originalIsAuto)
        reset()
        return resolution
    }

    /// Exit, handing back the draft. isAuto stays the original flag only when
    /// draft == original; otherwise false. nil when not editing.
    public mutating func done() -> Resolution? {
        guard let original, let draft else { return nil }
        let resolution = Resolution(curve: draft, isAuto: draft == original ? originalIsAuto : false)
        reset()
        return resolution
    }

    private mutating func reset() {
        original = nil
        originalIsAuto = false
        draft = nil
    }
}
