import Foundation

/// How the Analyze screen arranges itself for the space it has. Portrait is
/// the header + RTA + coaching column; landscape is RTA-first, with coaching
/// hidden behind a peek handle (#1548). Pure, so the view's decisions are tested here.
public enum AnalyzeLayout: Equatable, Sendable {
    case portrait
    case landscape

    /// Minimum vertical drag (points) on the peek handle that opens or closes the peek.
    public static let peekDragThreshold = 24.0
    static let coachingPeekTitle = "Coaching"
    static let coachingPeekSeparator = " · "

    /// Landscape exactly when the container is wider than tall; square,
    /// zero or non-finite sizes stay portrait.
    public init(width: Double, height: Double) {
        guard width.isFinite, height.isFinite, width > height else { self = .portrait; return }
        self = .landscape
    }

    /// Portrait stacks the coaching cards under the RTA; landscape keeps them behind the peek.
    public var showsCoachingInline: Bool { self == .portrait }

    /// Both layouts draw the text-free problem pulses on the RTA — in landscape
    /// they are the only in-the-moment cue while coaching sits behind the peek
    /// (#1554). Deliberately independent of peek state.
    public var showsProblemMarkers: Bool { true }

    /// Both layouts put the target legend and the "Editing target" chip in one
    /// fixed-height band directly under the RTA, and the header / landscape
    /// strip always keeps the listening indicator — so entering or leaving
    /// target-edit mode never moves the RTA (#1565).
    public var targetControlsUnderRTA: Bool { true }

    /// Label on the landscape peek handle: "Coaching · 2", or just "Coaching" when there are none.
    public static func coachingPeekLabel(count: Int) -> String {
        count > 0 ? coachingPeekTitle + coachingPeekSeparator + String(count) : coachingPeekTitle
    }

    /// Peek state after a vertical drag on the handle. SwiftUI's translation is
    /// negative going up, so an upward drag past the threshold opens, a downward
    /// drag past it closes, and anything smaller keeps the current state.
    public static func peekOpen(afterDrag translationY: Double, wasOpen: Bool) -> Bool {
        if translationY <= -peekDragThreshold { return true }
        if translationY >= peekDragThreshold { return false }
        return wasOpen
    }
}
