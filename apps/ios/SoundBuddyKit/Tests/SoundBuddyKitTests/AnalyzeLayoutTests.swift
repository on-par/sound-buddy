import Foundation
import Testing
@testable import SoundBuddyKit

@Suite("AnalyzeLayout")
struct AnalyzeLayoutTests {
    @Test(
        "portrait vs landscape from container size",
        arguments: [
            (844.0, 390.0, AnalyzeLayout.landscape),
            (390.0, 844.0, AnalyzeLayout.portrait),
            (500.0, 500.0, AnalyzeLayout.portrait),
            (0.0, 0.0, AnalyzeLayout.portrait),
            (Double.infinity, 100.0, AnalyzeLayout.portrait),
            (Double.nan, 100.0, AnalyzeLayout.portrait),
            (100.0, Double.infinity, AnalyzeLayout.portrait),
            // Real Analyze containers (screen minus safe area and the 20 pt padding).
            (1336.0, 948.0, AnalyzeLayout.wide), // iPad Pro 13" landscape
            (1093.0, 660.0, AnalyzeLayout.wide), // iPad mini landscape
            (984.0, 1272.0, AnalyzeLayout.tallPortrait), // iPad Pro 13" portrait
            (704.0, 1069.0, AnalyzeLayout.tallPortrait), // iPad mini portrait
            (280.0, 948.0, AnalyzeLayout.portrait), // iPad 1/3 Split View
            (774.0, 369.0, AnalyzeLayout.landscape), // iPhone Pro Max landscape
            (390.0, 852.0, AnalyzeLayout.portrait), // iPhone Pro Max portrait
        ]
    )
    func layoutFromSize(width: Double, height: Double, expected: AnalyzeLayout) {
        #expect(AnalyzeLayout(width: width, height: height) == expected)
    }

    @Test(
        "showsCoachingInline",
        arguments: [
            (AnalyzeLayout.portrait, true),
            (AnalyzeLayout.landscape, false),
            (AnalyzeLayout.tallPortrait, true),
            (AnalyzeLayout.wide, true),
        ]
    )
    func showsCoachingInline(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.showsCoachingInline == expected)
    }

    @Test(
        "showsProblemMarkers",
        arguments: [
            (AnalyzeLayout.portrait, true),
            (AnalyzeLayout.landscape, true),
            (AnalyzeLayout.tallPortrait, true),
            (AnalyzeLayout.wide, true),
        ]
    )
    func showsProblemMarkers(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.showsProblemMarkers == expected)
    }

    @Test(
        "target controls sit under the RTA in every layout (#1565)",
        arguments: [
            (AnalyzeLayout.portrait, true),
            (AnalyzeLayout.landscape, true),
            (AnalyzeLayout.tallPortrait, true),
            (AnalyzeLayout.wide, true),
        ]
    )
    func targetControlsUnderRTA(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.targetControlsUnderRTA == expected)
    }

    @Test(
        "coachingPeekLabel",
        arguments: [
            (0, "Coaching"),
            (1, "Coaching · 1"),
            (3, "Coaching · 3"),
            (-1, "Coaching"),
        ]
    )
    func coachingPeekLabel(count: Int, expected: String) {
        #expect(AnalyzeLayout.coachingPeekLabel(count: count) == expected)
    }

    @Test(
        "peekOpen(afterDrag:wasOpen:)",
        arguments: [
            (-AnalyzeLayout.peekDragThreshold, false, true),
            (AnalyzeLayout.peekDragThreshold, true, false),
            (-(AnalyzeLayout.peekDragThreshold - 1), false, false),
            (AnalyzeLayout.peekDragThreshold - 1, true, true),
            (0.0, false, false),
            (0.0, true, true),
            (-500.0, true, true),
            (500.0, false, false),
        ]
    )
    func peekOpen(translationY: Double, wasOpen: Bool, expected: Bool) {
        #expect(AnalyzeLayout.peekOpen(afterDrag: translationY, wasOpen: wasOpen) == expected)
    }

    @Test(
        "showsProblemMarkers(isEditingTarget:) hides markers only while editing (#1562)",
        arguments: [
            (AnalyzeLayout.portrait, false, true),
            (AnalyzeLayout.landscape, false, true),
            (AnalyzeLayout.portrait, true, false),
            (AnalyzeLayout.landscape, true, false),
            (AnalyzeLayout.tallPortrait, false, true),
            (AnalyzeLayout.wide, false, true),
            (AnalyzeLayout.tallPortrait, true, false),
            (AnalyzeLayout.wide, true, false),
        ]
    )
    func showsProblemMarkersWhileEditing(layout: AnalyzeLayout, isEditingTarget: Bool, expected: Bool) {
        #expect(layout.showsProblemMarkers(isEditingTarget: isEditingTarget) == expected)
    }

    @Test(
        "coachingPeekEnabled(isEditingTarget:) (#1562)",
        arguments: [
            (false, true),
            (true, false),
        ]
    )
    func coachingPeekEnabled(isEditingTarget: Bool, expected: Bool) {
        #expect(AnalyzeLayout.coachingPeekEnabled(isEditingTarget: isEditingTarget) == expected)
    }

    @Test(
        "peekOpen(afterEditingChange:wasOpen:) closes the peek on entry and leaves it as-is on exit (#1562)",
        arguments: [
            (true, true, false),
            (true, false, false),
            (false, false, false),
            (false, true, true),
        ]
    )
    func peekOpenAfterEditingChange(isEditingTarget: Bool, wasOpen: Bool, expected: Bool) {
        #expect(AnalyzeLayout.peekOpen(afterEditingChange: isEditingTarget, wasOpen: wasOpen) == expected)
    }

    @Test(
        "consoleEQPlacement(isRegularWidth:)",
        arguments: [
            (AnalyzeLayout.landscape, true, AnalyzeLayout.ConsoleEQPlacement.sideColumn),
            (AnalyzeLayout.landscape, false, AnalyzeLayout.ConsoleEQPlacement.sheet),
            (AnalyzeLayout.portrait, true, AnalyzeLayout.ConsoleEQPlacement.sheet),
            (AnalyzeLayout.portrait, false, AnalyzeLayout.ConsoleEQPlacement.sheet),
            // #1659: iPad landscape is now `.wide`, and keeps #1685's column.
            (AnalyzeLayout.wide, true, AnalyzeLayout.ConsoleEQPlacement.sideColumn),
            (AnalyzeLayout.wide, false, AnalyzeLayout.ConsoleEQPlacement.sheet),
            (AnalyzeLayout.tallPortrait, true, AnalyzeLayout.ConsoleEQPlacement.sheet),
            (AnalyzeLayout.tallPortrait, false, AnalyzeLayout.ConsoleEQPlacement.sheet),
        ]
    )
    func consoleEQPlacement(layout: AnalyzeLayout, isRegularWidth: Bool, expected: AnalyzeLayout.ConsoleEQPlacement) {
        #expect(layout.consoleEQPlacement(isRegularWidth: isRegularWidth) == expected)
    }

    @Test("regularWidthLandscapePlacesConsoleEQBesideRTA")
    func regularWidthLandscapePlacesConsoleEQBesideRTA() {
        #expect(AnalyzeLayout.landscape.consoleEQPlacement(isRegularWidth: true) == .sideColumn)
    }

    @Test("console EQ column leaves the RTA the majority of the width")
    func consoleEQColumnFractionLeavesRTAMajority() {
        #expect(AnalyzeLayout.consoleEQColumnWidthFraction < 0.5)
    }

    @Test("landscape peek locks closed across an edit, then resumes tap/swipe behavior (#1562)")
    func landscapePeekAroundAnEdit() {
        var isOpen = AnalyzeLayout.peekOpen(afterDrag: -AnalyzeLayout.peekDragThreshold, wasOpen: false)
        #expect(isOpen)

        isOpen = AnalyzeLayout.peekOpen(afterEditingChange: true, wasOpen: isOpen)
        #expect(!isOpen)
        #expect(!AnalyzeLayout.coachingPeekEnabled(isEditingTarget: true))

        isOpen = AnalyzeLayout.peekOpen(afterEditingChange: false, wasOpen: isOpen)
        #expect(!isOpen)
        #expect(AnalyzeLayout.coachingPeekEnabled(isEditingTarget: false))

        isOpen = AnalyzeLayout.peekOpen(afterDrag: -AnalyzeLayout.peekDragThreshold, wasOpen: isOpen)
        #expect(isOpen)
        isOpen = AnalyzeLayout.peekOpen(afterDrag: AnalyzeLayout.peekDragThreshold, wasOpen: isOpen)
        #expect(!isOpen)
    }

    // MARK: - iPad: wide and tall-portrait variants (#1659)

    @Test("wide needs both the minimum width and the minimum height, in landscape")
    func wideThresholds() {
        let w = AnalyzeLayout.wideMinWidth
        let h = AnalyzeLayout.wideMinHeight
        #expect(AnalyzeLayout(width: w, height: h) == .wide)
        #expect(AnalyzeLayout(width: w - 1, height: h) == .landscape)
        #expect(AnalyzeLayout(width: w, height: h - 1) == .landscape)
        // A huge but not-wider-than-tall container is never wide.
        #expect(AnalyzeLayout(width: w, height: w) == .tallPortrait)
    }

    @Test("tall portrait starts at the regular width; narrower stays iPhone portrait")
    func tallPortraitThreshold() {
        let w = AnalyzeLayout.regularMinWidth
        #expect(AnalyzeLayout(width: w, height: w + 1) == .tallPortrait)
        #expect(AnalyzeLayout(width: w - 1, height: w + 1) == .portrait)
    }

    @Test("thresholds keep every iPhone on today's layouts and every full-screen iPad on the new ones")
    func thresholdsSeparateDevices() {
        // Widest iPhone portrait container and tallest iPhone landscape container.
        #expect(AnalyzeLayout.regularMinWidth > 430)
        #expect(AnalyzeLayout.wideMinHeight > 430)
        // Smallest full-screen iPad (mini) still qualifies in both orientations.
        #expect(AnalyzeLayout.regularMinWidth <= 704)
        #expect(AnalyzeLayout.wideMinWidth <= 1093)
        #expect(AnalyzeLayout.wideMinHeight <= 660)
    }

    @Test(
        "only wide puts coaching beside the RTA",
        arguments: [
            (AnalyzeLayout.portrait, false),
            (AnalyzeLayout.landscape, false),
            (AnalyzeLayout.tallPortrait, false),
            (AnalyzeLayout.wide, true),
        ]
    )
    func coachingBesideRTA(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.coachingBesideRTA == expected)
    }

    @Test(
        "only iPhone-style landscape has the coaching peek",
        arguments: [
            (AnalyzeLayout.portrait, false),
            (AnalyzeLayout.landscape, true),
            (AnalyzeLayout.tallPortrait, false),
            (AnalyzeLayout.wide, false),
        ]
    )
    func showsCoachingPeek(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.showsCoachingPeek == expected)
    }

    @Test(
        "the RTA fills the height everywhere except iPhone portrait's fixed 300 pt",
        arguments: [
            (AnalyzeLayout.portrait, false),
            (AnalyzeLayout.landscape, true),
            (AnalyzeLayout.tallPortrait, true),
            (AnalyzeLayout.wide, true),
        ]
    )
    func rtaFillsHeight(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.rtaFillsHeight == expected)
    }

    @Test(
        "landscape variants use the compact strip; portrait variants use the brand header",
        arguments: [
            (AnalyzeLayout.portrait, false),
            (AnalyzeLayout.landscape, true),
            (AnalyzeLayout.tallPortrait, false),
            (AnalyzeLayout.wide, true),
        ]
    )
    func usesCompactStrip(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.usesCompactStrip == expected)
    }

    @Test("wide gives the RTA about two thirds of the width or more")
    func wideRTAFraction() {
        #expect(AnalyzeLayout.wideRTAWidthFraction >= 2.0 / 3.0)
        #expect(AnalyzeLayout.wideRTAWidthFraction < 1)
    }

    @Test(
        "wide coaching column width: the rest of the row after the RTA share and the gap, never negative",
        arguments: [
            (1336.0, 16.0),
            (1093.0, 16.0),
            (0.0, 16.0),
            (Double.nan, 16.0),
        ]
    )
    func wideCoachingColumnWidth(width: Double, spacing: Double) {
        let column = AnalyzeLayout.wideCoachingColumnWidth(containerWidth: width, spacing: spacing)
        #expect(column >= 0)
        if width.isFinite, width > 0 {
            let rta = width - spacing - column
            #expect(abs(rta - width * AnalyzeLayout.wideRTAWidthFraction) < 0.001)
        } else {
            #expect(column == 0)
        }
    }

    // MARK: - iPad wide + console EQ column (#1659 x #1669)

    @Test("a full-screen iPad landscape container still gets the console EQ column (#1669)")
    func fullScreenIPadLandscapeKeepsConsoleEQColumn() {
        for (width, height) in [(1336.0, 948.0), (1093.0, 660.0)] {
            let layout = AnalyzeLayout(width: width, height: height)
            #expect(layout == .wide)
            #expect(layout.consoleEQPlacement(isRegularWidth: true) == .sideColumn)
        }
    }

    @Test(
        "the console EQ column shows only when the chip is visible and the placement is the side column",
        arguments: [
            (AnalyzeLayout.wide, true, true, true),
            (AnalyzeLayout.wide, true, false, false),
            (AnalyzeLayout.wide, false, true, false),
            (AnalyzeLayout.landscape, true, true, true),
            (AnalyzeLayout.landscape, false, true, false),
            (AnalyzeLayout.tallPortrait, true, true, false),
            (AnalyzeLayout.portrait, true, true, false),
        ]
    )
    func showsConsoleEQColumn(layout: AnalyzeLayout, isRegularWidth: Bool, consoleVisible: Bool, expected: Bool) {
        #expect(layout.showsConsoleEQColumn(isRegularWidth: isRegularWidth, consoleVisible: consoleVisible) == expected)
    }

    @Test("wide RTA share: 70% alone, the console EQ column's complement with it, dominant either way")
    func wideRTAShare() {
        #expect(AnalyzeLayout.wideRTAShare(showsConsoleEQ: false) == AnalyzeLayout.wideRTAWidthFraction)
        #expect(abs(AnalyzeLayout.wideRTAShare(showsConsoleEQ: true) - (1 - AnalyzeLayout.consoleEQColumnWidthFraction)) < 0.0001)
        #expect(AnalyzeLayout.wideRTAShare(showsConsoleEQ: true) > 0.5)
        #expect(AnalyzeLayout.wideRTAShare(showsConsoleEQ: true) <= AnalyzeLayout.wideRTAShare(showsConsoleEQ: false))
    }

    @Test(
        "wide trailing column width: the rest after the RTA share and the gap, with or without the console EQ",
        arguments: [
            (1336.0, 16.0, false),
            (1336.0, 16.0, true),
            (1093.0, 16.0, false),
            (1093.0, 16.0, true),
            (AnalyzeLayout.wideMinWidth, 16.0, true),
        ]
    )
    func wideTrailingColumnWidth(width: Double, spacing: Double, showsConsoleEQ: Bool) {
        let column = AnalyzeLayout.wideTrailingColumnWidth(containerWidth: width, spacing: spacing, showsConsoleEQ: showsConsoleEQ)
        let rta = width - spacing - column
        #expect(column > 0)
        #expect(abs(rta - width * AnalyzeLayout.wideRTAShare(showsConsoleEQ: showsConsoleEQ)) < 0.001)
        #expect(rta > column)
    }

    @Test("without the console EQ the trailing column is exactly the #1659 coaching column")
    func wideTrailingColumnMatchesCoachingColumnWithoutConsoleEQ() {
        for width in [AnalyzeLayout.wideMinWidth, 1093.0, 1336.0] {
            #expect(
                AnalyzeLayout.wideTrailingColumnWidth(containerWidth: width, spacing: 16, showsConsoleEQ: false)
                    == AnalyzeLayout.wideCoachingColumnWidth(containerWidth: width, spacing: 16)
            )
        }
    }

    @Test("the console EQ column is wider than the plain coaching column, so the panel has room")
    func consoleEQColumnIsWiderThanCoachingColumn() {
        #expect(
            AnalyzeLayout.wideTrailingColumnWidth(containerWidth: 1093, spacing: 16, showsConsoleEQ: true)
                > AnalyzeLayout.wideTrailingColumnWidth(containerWidth: 1093, spacing: 16, showsConsoleEQ: false)
        )
    }

    @Test(
        "wide trailing column width is zero, never negative, for empty or non-finite input",
        arguments: [
            (0.0, true), (0.0, false), (-10.0, true), (Double.nan, true), (Double.infinity, false), (10.0, true),
        ]
    )
    func wideTrailingColumnWidthEdges(width: Double, showsConsoleEQ: Bool) {
        let column = AnalyzeLayout.wideTrailingColumnWidth(containerWidth: width, spacing: 16, showsConsoleEQ: showsConsoleEQ)
        #expect(column >= 0)
        if !(width.isFinite && width > 0) {
            #expect(column == 0)
        }
    }

    @Test("with the console EQ, the panel takes the top share of the trailing column and coaching the rest")
    func wideConsoleEQPanelHeight() {
        let columnHeight = 560.0
        let spacing = 12.0
        let panel = AnalyzeLayout.wideConsoleEQPanelHeight(columnHeight: columnHeight, spacing: spacing)
        let coaching = columnHeight - spacing - panel
        #expect(abs(panel - (columnHeight - spacing) * AnalyzeLayout.wideConsoleEQHeightFraction) < 0.001)
        #expect(panel > coaching)
        #expect(coaching > 0)
        #expect(AnalyzeLayout.wideConsoleEQHeightFraction > 0.5)
        #expect(AnalyzeLayout.wideConsoleEQHeightFraction < 1)
    }

    @Test(
        "console EQ panel height is zero, never negative, for empty, tiny or non-finite columns",
        arguments: [0.0, 5.0, -1.0, Double.nan, Double.infinity]
    )
    func wideConsoleEQPanelHeightEdges(columnHeight: Double) {
        let panel = AnalyzeLayout.wideConsoleEQPanelHeight(columnHeight: columnHeight, spacing: 12)
        #expect(panel >= 0)
        if !(columnHeight.isFinite && columnHeight > 12) {
            #expect(panel == 0)
        }
    }
}
