import Foundation
import Testing
@testable import SoundBuddyKit

private let frameRate = 30.0
private let t0 = Date(timeIntervalSinceReferenceDate: 0)

/// Feeds `stabilizer` one frame every `1 / frameRate` seconds, starting
/// `duration` seconds after `start`, with each frame's deltas produced by
/// `delta(elapsedSeconds)` (elapsed since `start`). Records every
/// (elapsed-seconds, visible-set) pair in order.
@discardableResult
private func feed(
    _ stabilizer: inout CoachingStabilizer,
    from start: TimeInterval,
    duration: TimeInterval,
    delta: (TimeInterval) -> [Band: Double]
) -> [(t: TimeInterval, visible: Set<Band>)] {
    let step = 1.0 / frameRate
    let frameCount = Int((duration * frameRate).rounded())
    var results: [(t: TimeInterval, visible: Set<Band>)] = []
    var elapsed = start
    for i in 0..<frameCount {
        elapsed = start + Double(i) * step
        let time = t0.addingTimeInterval(elapsed)
        let visible = stabilizer.ingest(delta(elapsed), at: time)
        results.append((t: elapsed, visible: visible))
    }
    return results
}

/// A Speech/Music target switch (#1701) drops every dwell timer and every
/// visible tip, so no tip judged against the previous target survives: every
/// new tip has to sit through the full enter dwell under the new target.
/// Every test uses an injected clock stepped by hand — no wall-clock timing.
@Suite struct CoachingStabilizerModeSwitchTests {
    @Test func switchMidDwellRestartsEnterDwell() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 4.0) { _ in [.mid: 5] }
        #expect(stabilizer.visible.isEmpty, "mid should still be dwelling, not visible yet")

        let switchTime = 4.0
        stabilizer.targetDidSwitch(to: .speech)

        let restartTime = switchTime + 1.0 / frameRate
        let results = feed(&stabilizer, from: restartTime, duration: 5.2) { _ in [.mid: 5] }

        for sample in results where sample.t < switchTime + 4.9 {
            #expect(!sample.visible.contains(.mid), "the switch should have restarted the dwell (t=\(sample.t))")
        }
        let afterRestartDwell = results.first { $0.t >= switchTime + 5.1 }!
        #expect(afterRestartDwell.visible.contains(.mid), "mid should appear 5 s after the switch")
    }

    @Test func switchClearsVisibleTipImmediately() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 5.2) { _ in [.mid: 5, .bass: -6] }
        #expect(stabilizer.visible == [.mid, .bass], "both bands should be visible before the switch")

        stabilizer.targetDidSwitch(to: .speech)
        #expect(stabilizer.visible.isEmpty, "the switch should clear the visible set immediately")
        #expect(stabilizer.isOnTarget == false, "no reading has been taken under the new target yet")

        let result = stabilizer.ingest([.mid: 0, .bass: 0], at: t0.addingTimeInterval(5.3))
        #expect(result.isEmpty, "no tip should linger through minimumVisibleSeconds or the exit dwell")
        #expect(!stabilizer.isOnTarget, "one reading under the new target is not yet enough evidence for calm")

        _ = stabilizer.ingest([.mid: 0, .bass: 0], at: t0.addingTimeInterval(5.3 + CoachingStabilizer.calmDwellSeconds))
        #expect(stabilizer.isOnTarget, "a sustained on-target run under the new target should report calm")
    }

    @Test func tipAfterSwitchNeedsFullEnterDwell() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 5.2) { _ in [.mid: 5] }
        #expect(stabilizer.visible.contains(.mid), "mid should be visible before the switch")

        let switchTime = 5.2
        stabilizer.targetDidSwitch(to: .speech)
        #expect(!stabilizer.visible.contains(.mid), "the switch should clear the visible tip")

        let restartTime = switchTime + 1.0 / frameRate
        let results = feed(&stabilizer, from: restartTime, duration: 5.2) { _ in [.mid: 5] }
        for sample in results where sample.t < switchTime + 4.9 {
            #expect(!sample.visible.contains(.mid), "mid should still be dwelling under the new target (t=\(sample.t))")
        }
        let afterDwell = results.first { $0.t >= switchTime + 5.1 }!
        #expect(afterDwell.visible.contains(.mid), "mid should reappear once the full dwell has elapsed under the new target")

        let secondSwitchTime = afterDwell.t
        stabilizer.targetDidSwitch(to: .music)
        #expect(!stabilizer.visible.contains(.mid), "switching back should clear the tip again")

        let secondRestartTime = secondSwitchTime + 1.0 / frameRate
        let secondResults = feed(&stabilizer, from: secondRestartTime, duration: 5.2) { _ in [.mid: 5] }
        for sample in secondResults where sample.t < secondSwitchTime + 4.9 {
            #expect(!sample.visible.contains(.mid), "mid should dwell again after switching back (t=\(sample.t))")
        }
        let afterSecondDwell = secondResults.first { $0.t >= secondSwitchTime + 5.1 }!
        #expect(afterSecondDwell.visible.contains(.mid), "mid should reappear after the second switch's full dwell")
    }

    @Test func sameModeNotificationIsNoOp() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 4.0) { _ in [.mid: 5] }
        stabilizer.targetDidSwitch(to: .music)
        #expect(stabilizer.activeMode == .music, "activeMode should still be music")

        let results = feed(&stabilizer, from: 4.0, duration: 1.2) { _ in [.mid: 5] }
        let afterDwell = results.first { $0.t >= 5.1 }!
        #expect(afterDwell.visible.contains(.mid), "a same-mode notification should not restart the dwell")

        _ = feed(&stabilizer, from: 5.1, duration: 8.2) { _ in [.mid: 0] }
        #expect(stabilizer.visible.isEmpty, "mid should have cleared via normal recovery")

        var visibleStabilizer = CoachingStabilizer()
        _ = feed(&visibleStabilizer, from: 0, duration: 5.2) { _ in [.mid: 5] }
        let visibleBefore = visibleStabilizer.visible
        visibleStabilizer.targetDidSwitch(to: .music)
        #expect(visibleStabilizer.visible == visibleBefore, "a same-mode notification should leave a visible tip unchanged")
    }

    @Test func staleFrameAfterSwitchIsIgnored() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 4.0) { _ in [.mid: 5] }
        let switchTime = 4.0
        stabilizer.targetDidSwitch(to: .speech)

        let staleResult = stabilizer.ingest([.mid: 5], at: t0.addingTimeInterval(3.0))
        #expect(staleResult.isEmpty, "a frame stamped before the last accepted pre-switch frame should be ignored")

        let restartTime = switchTime + 1.0 / frameRate
        let results = feed(&stabilizer, from: restartTime, duration: 5.2) { _ in [.mid: 5] }
        for sample in results where sample.t < switchTime + 4.9 {
            #expect(!sample.visible.contains(.mid), "the stale frame should not have started the post-switch dwell (t=\(sample.t))")
        }
        let afterDwell = results.first { $0.t >= switchTime + 5.1 }!
        #expect(afterDwell.visible.contains(.mid), "the dwell should complete 5 s after the first in-order post-switch frame")
    }

    @Test func resetRestoresMusicMode() {
        var stabilizer = CoachingStabilizer()
        stabilizer.targetDidSwitch(to: .speech)
        #expect(stabilizer.activeMode == .speech)

        stabilizer.reset()
        #expect(stabilizer.activeMode == .music, "reset should return activeMode to .music")
    }
}
