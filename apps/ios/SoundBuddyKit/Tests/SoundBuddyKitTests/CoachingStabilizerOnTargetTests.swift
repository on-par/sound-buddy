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

/// The calm 'Mix is on target' state (#1699, #1773): it needs positive
/// evidence — every band within `exitThresholdDb` for `calmDwellSeconds` —
/// drops the moment a band reaches `enterThresholdDb`, never coexists with a
/// visible tip, and never claims calm before a real frame has arrived.
@Suite struct CoachingStabilizerOnTargetTests {
    @Test func calmStateShowsWhenAllBandsInTolerance() {
        var stabilizer = CoachingStabilizer()
        let results = feed(&stabilizer, from: 0, duration: 10.0) { t in
            Dictionary(uniqueKeysWithValues: Band.allCases.map { band in
                (band, 0.8 * sin(2 * .pi * t / 1.2))
            })
        }

        for sample in results where sample.t >= CoachingStabilizer.calmDwellSeconds {
            #expect(sample.onTarget, "mix should be on target at t=\(sample.t)")
        }
        for sample in results {
            #expect(sample.visible.isEmpty, "no tip should be visible at t=\(sample.t)")
        }
        #expect(CoachingStabilizer.onTargetMessage == "Mix is on target")
    }

    @Test func calmStateYieldsAsSoonAsABandStartsItsEnterDwell() {
        var stabilizer = CoachingStabilizer()
        feed(&stabilizer, from: 0, duration: 3.0) { _ in [.mid: 0, .bass: 0] }
        #expect(stabilizer.isOnTarget, "the mix starts calm")

        let results = feed(&stabilizer, from: 3.0, duration: 5.2) { t in
            var deltas: [Band: Double] = [.mid: 5]
            for band in Band.allCases where band != .mid {
                deltas[band] = 0.8 * sin(2 * .pi * t / 1.2)
            }
            return deltas
        }

        for sample in results {
            #expect(!sample.onTarget, "calm should drop on the first frame mid dwells past the threshold (t=\(sample.t))")
        }
        for sample in results where sample.t < 3.0 + 4.9 {
            #expect(!sample.visible.contains(.mid), "mid should not be visible before its dwell completes (t=\(sample.t))")
        }

        let entered = results.first { $0.visible.contains(.mid) }!
        #expect(entered.t >= 3.0 + 5.0, "mid should not enter before its 5 s dwell completes")

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
        for sample in allSamples {
            #expect(!(sample.onTarget && !sample.visible.isEmpty), "calm state and a visible tip must never coexist (t=\(sample.t))")
        }

        let cleared = recovery.first { $0.visible.isEmpty }!
        #expect(cleared.t >= shownAtTime + CoachingStabilizer.minimumVisibleSeconds, "mid should clear only after its minimum time")
        #expect(cleared.onTarget, "calm should return on the frame mid clears: its exit dwell already proved the recovery")
    }

    @Test func notOnTargetWithoutAReading() {
        var stabilizer = CoachingStabilizer()
        #expect(!stabilizer.isOnTarget, "a fresh stabilizer has no reading yet")

        _ = stabilizer.ingest([:], at: t0.addingTimeInterval(1))
        #expect(!stabilizer.isOnTarget, "an empty frame carries no real reading")

        _ = stabilizer.ingest([.mid: .nan, .bass: .infinity], at: t0.addingTimeInterval(2))
        #expect(!stabilizer.isOnTarget, "NaN and infinite deltas are not a real reading")

        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(3))
        #expect(!stabilizer.isOnTarget, "one finite reading is not yet enough evidence for calm")

        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(3 + CoachingStabilizer.calmDwellSeconds))
        #expect(stabilizer.isOnTarget, "in tolerance for the calm dwell with nothing visible is calm")

        _ = stabilizer.ingest([:], at: t0.addingTimeInterval(4 + CoachingStabilizer.calmDwellSeconds))
        #expect(!stabilizer.isOnTarget, "losing the reading should drop calm")
    }

    @Test func resetClearsOnTarget() {
        var stabilizer = CoachingStabilizer()
        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(1))
        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(1 + CoachingStabilizer.calmDwellSeconds))
        #expect(stabilizer.isOnTarget, "a real reading with no tip should be calm")

        stabilizer.reset()
        #expect(!stabilizer.isOnTarget, "reset should clear the calm state along with everything else")
    }

    @Test func outOfOrderFrameKeepsOnTargetState() {
        var stabilizer = CoachingStabilizer()
        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(1))
        _ = stabilizer.ingest([.mid: 1], at: t0.addingTimeInterval(1 + CoachingStabilizer.calmDwellSeconds))
        #expect(stabilizer.isOnTarget, "a real reading with no tip should be calm")

        _ = stabilizer.ingest([:], at: t0.addingTimeInterval(1))
        #expect(stabilizer.isOnTarget, "an out-of-order frame should be ignored, leaving the calm state untouched")
    }

    // MARK: Calm requires positive evidence (#1773)

    @Test func firstReadingWithABandFarOffIsNotCalmDuringTheEnterDwell() {
        var stabilizer = CoachingStabilizer()
        let results = feed(&stabilizer, from: 0, duration: 5.2) { _ in
            var deltas: [Band: Double] = Dictionary(uniqueKeysWithValues: Band.allCases.map { ($0, 0.0) })
            deltas[.lowMid] = 13
            return deltas
        }

        for sample in results {
            #expect(!sample.onTarget, "a band 13 dB off must never read as calm (t=\(sample.t))")
        }
        let entered = results.first { $0.visible.contains(.lowMid) }
        #expect(entered != nil, "low-mid should still enter after its dwell")
    }

    @Test func afterATargetSwitchCalmDoesNotAppearWhileBandsAreOff() {
        var stabilizer = CoachingStabilizer()
        feed(&stabilizer, from: 0, duration: 3.0) { _ in [.mid: 0.5, .lowMid: -0.5] }
        #expect(stabilizer.isOnTarget, "an on-target mix should be calm before the switch")

        stabilizer.targetDidSwitch(to: .speech)
        #expect(!stabilizer.isOnTarget, "the switch should drop the calm state with everything else")

        let results = feed(&stabilizer, from: 3.0 + 1.0 / frameRate, duration: 4.9) { _ in
            [.highMid: -16.7, .lowMid: 13.4, .mid: 0]
        }
        for sample in results {
            #expect(!sample.onTarget, "calm must not appear while bands are far off after a switch (t=\(sample.t))")
            #expect(sample.visible.isEmpty, "tips are still dwelling under the new target (t=\(sample.t))")
        }
    }

    @Test func genuinelyOnTargetReadingsReachCalmAfterTheCalmDwell() {
        var stabilizer = CoachingStabilizer()
        let results = feed(&stabilizer, from: 0, duration: 4.0) { t in
            Dictionary(uniqueKeysWithValues: Band.allCases.map { band in
                (band, 1.5 * sin(2 * .pi * t / 1.2))
            })
        }

        let step = 1.0 / frameRate
        for sample in results where sample.t < CoachingStabilizer.calmDwellSeconds - step {
            #expect(!sample.onTarget, "calm needs a sustained in-tolerance run first (t=\(sample.t))")
        }
        for sample in results where sample.t >= CoachingStabilizer.calmDwellSeconds + step {
            #expect(sample.onTarget, "an in-tolerance mix should be calm after the calm dwell (t=\(sample.t))")
        }
    }

    @Test func aBandHoveringAroundTheEnterThresholdDoesNotFlickerCalm() {
        var stabilizer = CoachingStabilizer()
        feed(&stabilizer, from: 0, duration: 3.0) { _ in [.mid: 0, .bass: 0] }
        #expect(stabilizer.isOnTarget, "the mix starts calm")

        let hover: (TimeInterval) -> Double = { t in CoachingStabilizer.enterThresholdDb + 0.6 * sin(2 * .pi * t / 1.2) }
        let results = feed(&stabilizer, from: 3.0, duration: 20.0) { t in [.mid: 0, .bass: hover(t)] }

        var transitions = 0
        var previous = true
        for sample in results {
            if sample.onTarget != previous { transitions += 1 }
            previous = sample.onTarget
            if hover(sample.t) >= CoachingStabilizer.enterThresholdDb {
                #expect(!sample.onTarget, "calm must never show with a band at or past the enter threshold (t=\(sample.t))")
            }
        }
        #expect(transitions <= 1, "calm should drop once and stay down, not flicker (\(transitions) transitions)")
        #expect(results.allSatisfy { $0.visible.isEmpty }, "the hovering band never holds long enough to raise a tip")
    }

    @Test func aBandHoveringAroundTheExitThresholdKeepsCalm() {
        var stabilizer = CoachingStabilizer()
        feed(&stabilizer, from: 0, duration: 3.0) { _ in [.mid: 0, .bass: 0] }
        #expect(stabilizer.isOnTarget, "the mix starts calm")

        let results = feed(&stabilizer, from: 3.0, duration: 20.0) { t in
            [.mid: 0, .bass: CoachingStabilizer.exitThresholdDb + 0.6 * sin(2 * .pi * t / 1.2)]
        }
        for sample in results {
            #expect(sample.onTarget, "calm should hold through the hysteresis band (t=\(sample.t))")
        }
    }

    @Test func aBandInTheHysteresisBandDelaysCalmUntilItSettles() {
        var stabilizer = CoachingStabilizer()
        let between = (CoachingStabilizer.exitThresholdDb + CoachingStabilizer.enterThresholdDb) / 2
        let results = feed(&stabilizer, from: 0, duration: 4.0) { _ in [.mid: 0, .bass: between] }
        #expect(results.allSatisfy { !$0.onTarget }, "calm needs every band within the exit threshold to start")

        let settled = feed(&stabilizer, from: 4.0, duration: 3.0) { _ in [.mid: 0, .bass: 0] }
        #expect(settled.last!.onTarget, "calm should arrive once the band settles for the calm dwell")
    }
}
