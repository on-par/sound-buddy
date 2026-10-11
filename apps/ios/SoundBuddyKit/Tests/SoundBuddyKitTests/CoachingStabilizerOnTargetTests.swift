import Foundation
import Testing
@testable import SoundBuddyKit

private let frameRate = 30.0
private let t0 = Date(timeIntervalSinceReferenceDate: 0)

/// Feeds `stabilizer` one frame every `1 / frameRate` seconds, starting
/// `duration` seconds after `start`, with each frame's deltas produced by
/// `delta(elapsedSeconds)` (elapsed since `start`). Records every
/// (elapsed-seconds, visible-set, onTarget) triple in order.
@discardableResult
private func feed(
    _ stabilizer: inout CoachingStabilizer,
    from start: TimeInterval,
    duration: TimeInterval,
    delta: (TimeInterval) -> [Band: Double]
) -> [(t: TimeInterval, visible: Set<Band>, onTarget: Bool)] {
    let step = 1.0 / frameRate
    let frameCount = Int((duration * frameRate).rounded())
    var results: [(t: TimeInterval, visible: Set<Band>, onTarget: Bool)] = []
    var elapsed = start
    for i in 0..<frameCount {
        elapsed = start + Double(i) * step
        let time = t0.addingTimeInterval(elapsed)
        let visible = stabilizer.ingest(delta(elapsed), at: time)
        results.append((t: elapsed, visible: visible, onTarget: stabilizer.isOnTarget))
    }
    return results
}

/// The calm 'Mix is on target' state (#1699): derived from the already
/// dwell/hysteresis-stabilized visible set, plus a real-reading flag, so it
/// never flickers and never claims calm before a real frame has arrived.
@Suite struct CoachingStabilizerOnTargetTests {
    @Test func calmStateShowsWhenAllBandsInTolerance() {
        var stabilizer = CoachingStabilizer()
        let results = feed(&stabilizer, from: 0, duration: 10.0) { t in
            Dictionary(uniqueKeysWithValues: Band.allCases.map { band in
                (band, 0.8 * sin(2 * .pi * t / 1.2))
            })
        }

        for sample in results {
            #expect(sample.onTarget, "mix should be on target at t=\(sample.t)")
            #expect(sample.visible.isEmpty, "no tip should be visible at t=\(sample.t)")
        }
        #expect(CoachingStabilizer.onTargetMessage == "Mix is on target")
    }

    @Test func calmStateYieldsWhenTipEntersPerDwellRule() {
        var stabilizer = CoachingStabilizer()
        let results = feed(&stabilizer, from: 0, duration: 5.2) { t in
            var deltas: [Band: Double] = [.mid: 5]
            for band in Band.allCases where band != .mid {
                deltas[band] = 0.8 * sin(2 * .pi * t / 1.2)
            }
            return deltas
        }

        for sample in results where sample.t < 4.9 {
            #expect(sample.onTarget, "calm state should hold during the dwell (t=\(sample.t))")
            #expect(!sample.visible.contains(.mid), "mid should not be visible before its dwell completes (t=\(sample.t))")
        }

        let entered = results.first { $0.visible.contains(.mid) }!
        #expect(entered.t >= 5.0, "mid should not enter before its 5 s dwell completes")
        #expect(!entered.onTarget, "calm state should clear on the same frame the tip enters")

        for sample in results {
            #expect(!(sample.onTarget && !sample.visible.isEmpty), "calm state and a visible tip must never coexist (t=\(sample.t))")
        }
    }

    @Test func calmStateNeverCoexistsWithAVisibleTip() {
        var stabilizer = CoachingStabilizer()
        let enter = feed(&stabilizer, from: 0, duration: 5.1) { _ in [.mid: 5] }
        let shownAtTime = enter.first { $0.visible.contains(.mid) }!.t

        let recovery = feed(&stabilizer, from: shownAtTime, duration: 8.2) { _ in [.mid: 1] }

        let allSamples = enter + recovery
        for sample in allSamples.dropFirst() {
            #expect(sample.onTarget == sample.visible.isEmpty, "onTarget should exactly mirror an empty visible set (t=\(sample.t))")
        }

        let afterClear = recovery.first { $0.t >= shownAtTime + 8.1 }!
        #expect(!afterClear.visible.contains(.mid), "mid should have cleared after the sustained recovery")
        #expect(afterClear.onTarget, "calm state should return once mid clears")
    }

    @Test func notOnTargetWithoutAReading() {
        var stabilizer = CoachingStabilizer()
        #expect(!stabilizer.isOnTarget, "a fresh stabilizer has no reading yet")

        _ = stabilizer.ingest([:], at: t0.addingTimeInterval(1))
        #expect(!stabilizer.isOnTarget, "an empty frame carries no real reading")

        _ = stabilizer.ingest([.mid: .nan, .bass: .infinity], at: t0.addingTimeInterval(2))
        #expect(!stabilizer.isOnTarget, "NaN and infinite deltas are not a real reading")

        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(3))
        #expect(stabilizer.isOnTarget, "a finite delta is a real reading with nothing visible")
    }

    @Test func resetClearsOnTarget() {
        var stabilizer = CoachingStabilizer()
        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(1))
        #expect(stabilizer.isOnTarget, "a real reading with no tip should be calm")

        stabilizer.reset()
        #expect(!stabilizer.isOnTarget, "reset should clear the calm state along with everything else")
    }

    @Test func outOfOrderFrameKeepsOnTargetState() {
        var stabilizer = CoachingStabilizer()
        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(1))
        #expect(stabilizer.isOnTarget, "a real reading with no tip should be calm")

        _ = stabilizer.ingest([:], at: t0.addingTimeInterval(0.5))
        #expect(stabilizer.isOnTarget, "an out-of-order frame should be ignored, leaving the calm state untouched")
    }
}
