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

/// Dwell and hysteresis gate tip visibility (#1698): turns timestamped
/// smoothed per-band deltas into a stable set of visible tip bands so normal
/// music dynamics (which push a band's delta back and forth across a single
/// threshold every 1-1.5 s) don't flicker a tip on and off. Every test uses an
/// injected clock stepped by hand — no wall-clock timing.
@Suite struct CoachingStabilizerTests {
    @Test func tipEntersOnlyAfterSustainedOffTarget() {
        var stabilizer = CoachingStabilizer()
        let results = feed(&stabilizer, from: 0, duration: 5.2) { t in
            [.mid: 5 + 0.8 * sin(2 * .pi * t / 1.2), .bass: -5]
        }

        for sample in results where sample.t < 4.9 {
            #expect(sample.visible.isEmpty, "nothing should be visible before 5 s (t=\(sample.t))")
        }

        let afterDwell = results.first { $0.t >= 5.1 }!
        #expect(afterDwell.visible == [.mid, .bass], "mid and bass (sign ignored) should both be visible by 5.1 s")
    }

    @Test func enterDwellRestartsWhenConditionBreaks() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 4.0) { _ in [.mid: 5] }
        _ = stabilizer.ingest([.mid: 3], at: t0.addingTimeInterval(4.0))
        let restartTime = 4.0 + 1.0 / frameRate
        let results = feed(&stabilizer, from: restartTime, duration: 5.2) { _ in [.mid: 5] }

        for sample in results where sample.t < restartTime + 4.9 {
            #expect(!sample.visible.contains(.mid), "dwell should have restarted (t=\(sample.t))")
        }
        let afterRestartDwell = results.first { $0.t >= restartTime + 5.1 }!
        #expect(afterRestartDwell.visible.contains(.mid), "tip should appear 5 s after the restart")
    }

    @Test func enterDwellRestartsOnMissingOrNaN() {
        var missingStabilizer = CoachingStabilizer()
        _ = feed(&missingStabilizer, from: 0, duration: 4.0) { _ in [.mid: 5] }
        _ = missingStabilizer.ingest([:], at: t0.addingTimeInterval(4.0))
        let missingResults = feed(&missingStabilizer, from: 4.0 + 1.0 / frameRate, duration: 2.0) { _ in [.mid: 5] }
        #expect(missingResults.allSatisfy { !$0.visible.contains(.mid) }, "a missing key should restart the dwell")

        var nanStabilizer = CoachingStabilizer()
        _ = feed(&nanStabilizer, from: 0, duration: 4.0) { _ in [.mid: 5] }
        _ = nanStabilizer.ingest([.mid: .nan], at: t0.addingTimeInterval(4.0))
        let nanResults = feed(&nanStabilizer, from: 4.0 + 1.0 / frameRate, duration: 2.0) { _ in [.mid: 5] }
        #expect(nanResults.allSatisfy { !$0.visible.contains(.mid) }, "a NaN value should restart the dwell")
    }

    @Test func tipHoldsForMinimumOnScreenTime() {
        var stabilizer = CoachingStabilizer()
        let enter = feed(&stabilizer, from: 0, duration: 5.1) { _ in [.bass: 5] }
        let shownAtTime = enter.first { $0.visible.contains(.bass) }!.t

        let results = feed(&stabilizer, from: shownAtTime, duration: 8.2) { _ in [.bass: 0] }

        for sample in results where sample.t < shownAtTime + 7.9 {
            #expect(sample.visible.contains(.bass), "bass should stay visible until 8 s after it appeared (t=\(sample.t))")
        }
        let afterMinimumHold = results.first { $0.t >= shownAtTime + 8.1 }!
        #expect(!afterMinimumHold.visible.contains(.bass), "bass should clear once the 8 s minimum hold has passed")
    }

    @Test func tipClearsOnlyAfterSustainedRecovery() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 10.0) { _ in [.highMid: 5] }
        #expect(stabilizer.visible.contains(.highMid), "highMid should be visible after a long hold")

        let recoveryStart = 10.0
        let results = feed(&stabilizer, from: recoveryStart, duration: 5.2) { t in
            [.highMid: 1.5 + 0.8 * sin(2 * .pi * (t - recoveryStart) / 1.2)]
        }

        let at4_9 = results.first { $0.t >= recoveryStart + 4.9 }!
        #expect(at4_9.visible.contains(.highMid), "highMid should still be visible at 4.9 s into recovery")
        let at5_1 = results.first { $0.t >= recoveryStart + 5.1 }!
        #expect(!at5_1.visible.contains(.highMid), "highMid should clear at 5.1 s into recovery")
    }

    @Test func exitDwellRestartsMidRecovery() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 10.0) { _ in [.presence: 5] }

        let recoveryStart = 10.0
        _ = feed(&stabilizer, from: recoveryStart, duration: 3.0) { _ in [.presence: 1.0] }
        _ = stabilizer.ingest([.presence: 3.0], at: t0.addingTimeInterval(recoveryStart + 3.0))
        let restartTime = recoveryStart + 3.0 + 1.0 / frameRate
        let results = feed(&stabilizer, from: restartTime, duration: 5.3) { _ in [.presence: 1.0] }

        for sample in results where sample.t < restartTime + 4.9 {
            #expect(sample.visible.contains(.presence), "the 3.0 dB frame should have restarted the exit dwell (t=\(sample.t))")
        }
        let afterRestartDwell = results.first { $0.t >= restartTime + 5.1 }!
        #expect(!afterRestartDwell.visible.contains(.presence), "presence should clear 5 s after the restarted recovery")
    }

    @Test func hysteresisBandNeverTogglesATip() {
        var hiddenStabilizer = CoachingStabilizer()
        let hiddenResults = feed(&hiddenStabilizer, from: 0, duration: 120.0) { t in
            [.subBass: 3.25 + 0.65 * sin(2 * .pi * t / 1.3)]
        }
        #expect(hiddenResults.allSatisfy { !$0.visible.contains(.subBass) }, "deltas inside [2.5, 4) should never show a tip")

        var visibleStabilizer = CoachingStabilizer()
        _ = feed(&visibleStabilizer, from: 0, duration: 9.0) { _ in [.subBass: 5] }
        #expect(visibleStabilizer.visible.contains(.subBass), "subBass should be visible and past its minimum hold")
        let visibleResults = feed(&visibleStabilizer, from: 9.0, duration: 120.0) { t in
            [.subBass: 3.25 + 0.65 * sin(2 * .pi * (t - 9.0) / 1.3)]
        }
        #expect(visibleResults.allSatisfy { $0.visible.contains(.subBass) }, "deltas inside [2.5, 4) should never clear a tip")
    }

    @Test func bandsAreIndependent() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 5.1) { _ in [.mid: 5] }
        #expect(stabilizer.visible == [.mid], "only mid should be visible")

        _ = feed(&stabilizer, from: 5.1, duration: 5.1) { _ in [.mid: 5, .presence: 5] }
        #expect(stabilizer.visible == [.mid, .presence], "presence should enter independently once its own dwell passes")

        _ = feed(&stabilizer, from: 10.2, duration: 5.2) { _ in [.mid: 0, .presence: 5] }
        #expect(stabilizer.visible == [.presence], "clearing mid should leave presence visible")
    }

    @Test func outOfOrderFrameIsIgnored() {
        var stabilizer = CoachingStabilizer()
        _ = stabilizer.ingest([.mid: 5], at: t0.addingTimeInterval(10))
        let before = stabilizer.visible

        let result = stabilizer.ingest([.mid: 5], at: t0.addingTimeInterval(5))
        #expect(result == before, "an earlier timestamp should return the unchanged visible set")

        let resultAfterDwellWouldHaveRestarted = feed(&stabilizer, from: 10, duration: 5.2) { _ in [.mid: 5] }
        let at5_1 = resultAfterDwellWouldHaveRestarted.first { $0.t >= 10 + 5.1 }!
        #expect(at5_1.visible.contains(.mid), "the out-of-order frame should not have perturbed the real dwell timer")
    }

    @Test func resetClearsState() {
        var stabilizer = CoachingStabilizer()
        _ = feed(&stabilizer, from: 0, duration: 5.1) { _ in [.mid: 5] }
        #expect(stabilizer.visible.contains(.mid))

        stabilizer.reset()
        #expect(stabilizer.visible.isEmpty, "reset should clear the visible set")

        let results = feed(&stabilizer, from: 100, duration: 5.2) { _ in [.mid: 5] }
        for sample in results where sample.t < 104.9 {
            #expect(sample.visible.isEmpty, "a full enter dwell should be required again after reset")
        }
        #expect(results.first { $0.t >= 105.1 }!.visible.contains(.mid))
    }

    @Test func smoothedJitterDoesNotFlicker() {
        var smoother = CoachingDeltaSmoother()
        var stabilizer = CoachingStabilizer()
        let step = 1.0 / frameRate
        let frameCount = Int(60.0 * frameRate)

        var visibilities: [Set<Band>] = []
        for i in 0..<frameCount {
            let sign = i.isMultiple(of: 2) ? 1.0 : -1.0
            let raw: [Band: Double] = [.lowMid: 3.2 + sign * 3.0]
            let time = t0.addingTimeInterval(Double(i) * step)
            let smoothed = smoother.ingest(raw, at: time)
            let visible = stabilizer.ingest(smoothed, at: time)
            visibilities.append(visible)
        }

        let settled = visibilities.suffix(Int(30.0 * frameRate))
        let first = settled.first!
        #expect(settled.allSatisfy { $0 == first }, "once settled, the smoothed+stabilized pipeline should never flicker")
    }
}
