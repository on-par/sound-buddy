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
        ]
    )
    func showsCoachingInline(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.showsCoachingInline == expected)
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
}
