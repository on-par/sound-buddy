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
        "showsProblemMarkers",
        arguments: [
            (AnalyzeLayout.portrait, true),
            (AnalyzeLayout.landscape, true),
        ]
    )
    func showsProblemMarkers(layout: AnalyzeLayout, expected: Bool) {
        #expect(layout.showsProblemMarkers == expected)
    }

    @Test(
        "target controls sit under the RTA in both layouts (#1565)",
        arguments: [
            (AnalyzeLayout.portrait, true),
            (AnalyzeLayout.landscape, true),
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
}
