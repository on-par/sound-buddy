import Foundation

/// How the Analyze screen arranges itself for the space it has. Portrait is
/// the header + RTA + coaching column; landscape is RTA-first, with coaching
/// hidden behind a peek handle (#1548). On an iPad-sized container (#1659),
/// tall portrait lets the RTA grow to fill the height above the coaching
/// cards, and wide puts the big RTA on the leading side with the coaching
/// cards inline beside it — no peek. iPhones and narrow Split View windows
/// never reach the iPad thresholds, so they keep portrait / landscape
/// unchanged. Pure, so the view's decisions are tested here.
public enum AnalyzeLayout: Equatable, Sendable {
    case portrait
    case landscape
    /// Portrait with a regular (iPad) width: the RTA fills the height (#1659).
    case tallPortrait
    /// Landscape with iPad width and height: RTA + coaching side by side (#1659).
    case wide

    /// Narrowest portrait container (points) that counts as regular width and
    /// gets the tall RTA. Above the widest iPhone portrait container (~390)
    /// and below iPad mini portrait (~704), so a 1/3 or 1/2 Split View window
    /// on a small iPad stays on the iPhone portrait layout.
    public static let regularMinWidth = 600.0
    /// Narrowest landscape container (points) that gets the side-by-side
    /// layout. Below iPad mini full-screen landscape (~1093).
    public static let wideMinWidth = 900.0
    /// Shortest landscape container (points) that gets the side-by-side
    /// layout. Above the tallest iPhone landscape container (~370) and below
    /// iPad mini landscape (~660), so no iPhone ever goes wide.
    public static let wideMinHeight = 500.0
    /// Share of the wide layout's row width the RTA takes when the coaching
    /// column is alone beside it (issue: about 2/3 or more); the coaching
    /// column gets the rest, less the gap.
    public static let wideRTAWidthFraction = 0.7

    /// Where the read-only console EQ panel (#1669) renders: a sheet from
    /// the console chip, or a fixed-fraction column beside the RTA.
    public enum ConsoleEQPlacement: Equatable, Sendable {
        case sheet
        case sideColumn
    }

    /// Minimum vertical drag (points) on the peek handle that opens or closes the peek.
    public static let peekDragThreshold = 24.0
    /// Fraction of the landscape width the console EQ side column takes,
    /// leaving the RTA the majority of the space.
    public static let consoleEQColumnWidthFraction = 0.36
    static let coachingPeekTitle = "Coaching"
    static let coachingPeekSeparator = " · "

    /// Landscape exactly when the container is wider than tall; square,
    /// zero or non-finite sizes stay portrait. Each orientation then upgrades
    /// to its iPad variant once the container clears the thresholds above.
    public init(width: Double, height: Double) {
        guard width.isFinite, height.isFinite else { self = .portrait; return }
        if width > height {
            self = width >= Self.wideMinWidth && height >= Self.wideMinHeight ? .wide : .landscape
        } else {
            self = width >= Self.regularMinWidth ? .tallPortrait : .portrait
        }
    }

    /// Every layout but iPhone-style landscape shows the coaching cards
    /// inline (under the RTA, or beside it when wide); landscape keeps them
    /// behind the peek.
    public var showsCoachingInline: Bool { self != .landscape }

    /// Only iPhone-style landscape has the coaching peek handle and panel.
    public var showsCoachingPeek: Bool { self == .landscape }

    /// The wide layout puts the coaching column beside the RTA.
    public var coachingBesideRTA: Bool { self == .wide }

    /// The RTA grows to fill the height it is given everywhere except iPhone
    /// portrait, which keeps its fixed height.
    public var rtaFillsHeight: Bool { self != .portrait }

    /// Landscape variants use the one-line status strip (Listening, level,
    /// gear) so the RTA gets nearly the full height; portrait variants use the
    /// brand header.
    public var usesCompactStrip: Bool { self == .landscape || self == .wide }

    /// Width of the wide layout's coaching column for a container `containerWidth`
    /// wide with `spacing` between the RTA and the column: whatever the RTA's
    /// `wideRTAWidthFraction` share leaves. Zero for empty or non-finite input.
    public static func wideCoachingColumnWidth(containerWidth: Double, spacing: Double) -> Double {
        guard containerWidth.isFinite, containerWidth > 0 else { return 0 }
        return max(0, containerWidth * (1 - wideRTAWidthFraction) - spacing)
    }

    /// Share of the wide layout's row width the RTA takes. Alone it is
    /// `wideRTAWidthFraction`; with the console EQ column (#1669) the
    /// trailing column widens to `consoleEQColumnWidthFraction` so the panel
    /// keeps the room #1685 gave it, and the RTA keeps the rest (still the
    /// majority).
    public static func wideRTAShare(showsConsoleEQ: Bool) -> Double {
        showsConsoleEQ ? 1 - consoleEQColumnWidthFraction : wideRTAWidthFraction
    }

    /// Width of the wide layout's single trailing column — coaching alone, or
    /// the console EQ panel stacked above coaching — for a container
    /// `containerWidth` wide with `spacing` between the RTA and the column:
    /// whatever the RTA's `wideRTAShare(showsConsoleEQ:)` leaves. Zero for
    /// empty or non-finite input.
    public static func wideTrailingColumnWidth(containerWidth: Double, spacing: Double, showsConsoleEQ: Bool) -> Double {
        guard containerWidth.isFinite, containerWidth > 0 else { return 0 }
        return max(0, containerWidth * (1 - wideRTAShare(showsConsoleEQ: showsConsoleEQ)) - spacing)
    }

    /// Share of the wide trailing column's height (less the gap) the console
    /// EQ panel takes when it is stacked above the coaching cards; the cards
    /// scroll in the rest. Both halves scroll on their own, so neither is
    /// ever clipped.
    public static let wideConsoleEQHeightFraction = 0.58

    /// Height of the console EQ panel in the wide trailing column
    /// `columnHeight` tall with `spacing` between the panel and the coaching
    /// cards. Zero for empty, too-small or non-finite input.
    public static func wideConsoleEQPanelHeight(columnHeight: Double, spacing: Double) -> Double {
        guard columnHeight.isFinite, columnHeight > spacing else { return 0 }
        return (columnHeight - spacing) * wideConsoleEQHeightFraction
    }

    /// Every layout draws the text-free problem pulses on the RTA — in landscape
    /// they are the only in-the-moment cue while coaching sits behind the peek
    /// (#1554). Deliberately independent of peek state.
    public var showsProblemMarkers: Bool { true }

    /// Problem markers are hidden while the target is being edited (#1562): they
    /// are frozen against the pre-edit curve (ADR-0156) yet drawn hugging the
    /// moving draft line, right under the drag handles. They come back unchanged
    /// on Done/Cancel.
    public func showsProblemMarkers(isEditingTarget: Bool) -> Bool {
        showsProblemMarkers && !isEditingTarget
    }

    /// Every layout puts the target legend and the "Editing target" chip in one
    /// fixed-height band directly under the RTA, and the header / landscape
    /// strip always keeps the listening indicator — so entering or leaving
    /// target-edit mode never moves the RTA (#1565).
    public var targetControlsUnderRTA: Bool { true }

    /// `.sideColumn` only in a landscape variant (`.landscape`, or `.wide`
    /// since #1659 — full-screen iPad landscape) on a regular-width size
    /// class; every other combination — including iPhone landscape, which
    /// stays compact-width, and every portrait variant — gets the sheet.
    public func consoleEQPlacement(isRegularWidth: Bool) -> ConsoleEQPlacement {
        usesCompactStrip && isRegularWidth ? .sideColumn : .sheet
    }

    /// Whether the console EQ panel is drawn as a column beside the RTA:
    /// the chip is visible (`consoleVisible`) and the placement is the side
    /// column. In `.wide` it stacks above the coaching cards in the one
    /// trailing column; in `.landscape` it sits beside the RTA on its own.
    public func showsConsoleEQColumn(isRegularWidth: Bool, consoleVisible: Bool) -> Bool {
        consoleVisible && consoleEQPlacement(isRegularWidth: isRegularWidth) == .sideColumn
    }

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

    /// The landscape coaching peek is disabled while editing (#1562): its panel
    /// would cover the Editing chip and preset pills, and its cards are frozen
    /// anyway. The handle keeps its slot so the RTA never moves (#1565).
    public static func coachingPeekEnabled(isEditingTarget: Bool) -> Bool {
        !isEditingTarget
    }

    /// Peek state after edit mode toggles: entering edit mode closes the peek;
    /// leaving it keeps whatever state it had (closed), so tap/swipe resumes
    /// exactly as before.
    public static func peekOpen(afterEditingChange isEditingTarget: Bool, wasOpen: Bool) -> Bool {
        isEditingTarget ? false : wasOpen
    }
}
