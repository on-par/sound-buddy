import Foundation
import Testing
@testable import SoundBuddyKit

/// The shared RTA display spec (#1707, epic #1705, docs/rta-display-spec.md):
/// power-domain exponential ballistics, peak hold, the Relative ±15 dB and
/// Absolute −96…0 dBFS scales, deviation tones, and the canonical fixture.
private let tolerance = 0.01

// MARK: Canonical fixture

private struct DisplayFixture: Decodable {
    struct Frame: Decodable {
        let dt: Double
        let levelsDb: [Double]
    }

    struct Expected: Decodable {
        let levelsDb: [Double]
        let absoluteFractions: [Double]
        let peaksDb: [Double]
        let relativeDb: [Double]
        let relativeClampedDb: [Double]
        let overflow: [String?]
        let tone: [String]
        let relativePeaksDb: [Double]
    }

    struct Case: Decodable {
        let name: String
        let ballistics: String
        let bandsHz: [Double]
        let targetOffsetsDb: [Double]?
        let frames: [Frame]
        let expected: [Expected]
    }

    struct Constants: Decodable {
        struct Ballistics: Decodable {
            let attackTauS: Double
            let releaseTauS: Double
        }

        let ballistics: [String: Ballistics]
        let peakHoldS: Double
        let peakReleaseDbPerS: Double
        let relativeRangeDb: Double
        let relativeTickDb: Double
        let absoluteFloorDb: Double
        let absoluteCeilingDb: Double
        let absoluteTickDb: Double
        let neutralDeviationDb: Double
    }

    let version: Int
    let toleranceDb: Double
    let constants: Constants
    let cases: [Case]
}

private let canonicalFixtureURL = TestPaths.repoRoot.appending(path: "docs/rta-display-spec/fixtures/rta-display-v1.json")

private func loadFixture() throws -> DisplayFixture {
    try JSONDecoder().decode(DisplayFixture.self, from: Data(contentsOf: TestPaths.fixture("rta-display-v1.json")))
}

@Suite struct RTADisplayFixtureTests {
    @Test func theTestCopyIsByteIdenticalToTheCanonicalFixture() throws {
        let copy = try Data(contentsOf: TestPaths.fixture("rta-display-v1.json"))
        let canonical = try Data(contentsOf: canonicalFixtureURL)
        #expect(copy == canonical, "regenerate with python3 apps/ios/scripts/make_rta_display_fixture.py")
    }

    @Test func theFixtureConstantsAreTheSwiftConstants() throws {
        let fixture = try loadFixture()
        let constants = fixture.constants
        #expect(fixture.version == 1)
        #expect(fixture.toleranceDb == tolerance)
        #expect(constants.ballistics["medium"]?.attackTauS == RTABallistics.medium.attackTauSeconds)
        #expect(constants.ballistics["medium"]?.releaseTauS == RTABallistics.medium.releaseTauSeconds)
        #expect(constants.ballistics["slow"]?.attackTauS == RTABallistics.slow.attackTauSeconds)
        #expect(constants.ballistics["slow"]?.releaseTauS == RTABallistics.slow.releaseTauSeconds)
        #expect(constants.peakHoldS == RTAPeakHold.holdSeconds)
        #expect(constants.peakReleaseDbPerS == RTAPeakHold.releaseDbPerSecond)
        #expect(constants.relativeRangeDb == RTAScale.relative.ceilingDb)
        #expect(-constants.relativeRangeDb == RTAScale.relative.floorDb)
        #expect(constants.relativeTickDb == RTAScale.relative.tickStepDb)
        #expect(constants.absoluteFloorDb == RTAScale.absolute.floorDb)
        #expect(constants.absoluteCeilingDb == RTAScale.absolute.ceilingDb)
        #expect(constants.absoluteTickDb == RTAScale.absolute.tickStepDb)
        #expect(constants.neutralDeviationDb == RTADeviationTone.neutralWithinDb)
    }

    /// AC1: every relative value, absolute fraction and peak matches to ±0.01 dB.
    @Test func everyFixtureFrameMatchesToATenthOfADecibelHundredth() throws {
        let fixture = try loadFixture()
        #expect(fixture.cases.count >= 5)
        for testCase in fixture.cases {
            let mode = try #require(RTABallisticsMode(rawValue: testCase.ballistics))
            var model = RTADisplayModel(ballistics: mode.ballistics)
            for (index, (frame, expected)) in zip(testCase.frames, testCase.expected).enumerated() {
                model.step(input: frame.levelsDb, targetOffsets: testCase.targetOffsetsDb, dt: frame.dt)
                let at = "\(testCase.name) frame \(index)"
                expectClose(model.levels, expected.levelsDb, at, "levels")
                expectClose(model.levels.map(RTAScale.absolute.fraction(db:)), expected.absoluteFractions, at, "absolute fractions")
                expectClose(model.peaks, expected.peaksDb, at, "peaks")
                expectClose(model.deviations, expected.relativeDb, at, "relative")
                let clamps = model.deviations.map(RTAScale.relative.clamp)
                expectClose(clamps.map(\.db), expected.relativeClampedDb, at, "relative clamped")
                #expect(clamps.map { $0.overflow?.rawValue } == expected.overflow, "\(at) overflow")
                #expect(model.deviations.map { RTADeviationTone(deviationDb: $0).rawValue } == expected.tone, "\(at) tone")
                expectClose(model.deviationPeaks, expected.relativePeaksDb, at, "relative peaks")
            }
        }
    }

    private func expectClose(_ actual: [Double], _ expected: [Double], _ at: String, _ what: String) {
        #expect(actual.count == expected.count, "\(at) \(what) count")
        for (a, e) in zip(actual, expected) {
            #expect(abs(a - e) <= tolerance, "\(at) \(what): \(a) vs \(e)")
        }
    }
}

// MARK: Constants and scales

@Suite struct RTADisplayConstantsTests {
    @Test func ballisticsAreTheSpecTimeConstants() {
        #expect(RTABallistics.medium == RTABallistics(attackTauSeconds: 0.05, releaseTauSeconds: 0.4))
        #expect(RTABallistics.slow == RTABallistics(attackTauSeconds: 0.25, releaseTauSeconds: 1.5))
        #expect(RTABallisticsMode.defaultValue == .medium)
        #expect(RTABallisticsMode.medium.ballistics == .medium)
        #expect(RTABallisticsMode.slow.ballistics == .slow)
        #expect(RTABallisticsMode.allCases == [.medium, .slow])
    }

    @Test func peakHoldIsOneAndAHalfSecondsThenTwentyDbPerSecond() {
        #expect(RTAPeakHold.holdSeconds == 1.5)
        #expect(RTAPeakHold.releaseDbPerSecond == 20)
    }

    @Test func relativeScaleIsPlusMinusFifteenWithFiveDbTicks() {
        let scale = RTAScale.relative
        #expect(scale.floorDb == -15 && scale.ceilingDb == 15 && scale.tickStepDb == 5)
        #expect(scale.dbTicks == [15, 10, 5, 0, -5, -10, -15])
        #expect(scale.fraction(db: 0) == 0.5)
    }

    @Test func absoluteScaleIsMinus96ToFullScaleWithTwelveDbTicks() {
        let scale = RTAScale.absolute
        #expect(scale.floorDb == -96 && scale.ceilingDb == 0 && scale.tickStepDb == 12)
        #expect(scale.dbTicks == [0, -12, -24, -36, -48, -60, -72, -84, -96])
        #expect(RTAScale.standard == .absolute, "the absolute window replaces the old −120…0 standard")
    }

    @Test func clampFlagsOverflowBothWays() {
        let scale = RTAScale.relative
        #expect(scale.clamp(4).db == 4 && scale.clamp(4).overflow == nil)
        #expect(scale.clamp(15).overflow == nil)
        #expect(scale.clamp(22).db == 15 && scale.clamp(22).overflow == .above)
        #expect(scale.clamp(-40).db == -15 && scale.clamp(-40).overflow == .below)
    }

    @Test func tonesAreNeutralWithinThreeDbAmberOverCyanUnder() {
        #expect(RTADeviationTone.neutralWithinDb == 3)
        #expect(RTADeviationTone(deviationDb: 0) == .neutral)
        #expect(RTADeviationTone(deviationDb: 3) == .neutral)
        #expect(RTADeviationTone(deviationDb: -3) == .neutral)
        #expect(RTADeviationTone(deviationDb: 3.01) == .over)
        #expect(RTADeviationTone(deviationDb: -3.01) == .under)
        #expect(RTADeviationTone(deviationDb: .nan) == .neutral)
    }

    @Test func viewModeDefaultsToRelativeAndEditingForcesAbsolute() {
        #expect(RTAViewMode.defaultValue == .relative)
        #expect(RTAViewMode.allCases == [.relative, .absolute])
        #expect(RTAViewMode(rawValue: "relative") == .relative)
        #expect(RTAViewMode(rawValue: "absolute") == .absolute)
        #expect(RTAViewMode.defaultsKey != RTABallisticsMode.defaultsKey)
        #expect(RTAViewMode.relative.scale == .relative)
        #expect(RTAViewMode.absolute.scale == .absolute)
        #expect(RTAViewMode.effective(requested: .relative, isEditingTarget: false) == .relative)
        #expect(RTAViewMode.effective(requested: .relative, isEditingTarget: true) == .absolute)
        #expect(RTAViewMode.effective(requested: .absolute, isEditingTarget: false) == .absolute)
    }
}

// MARK: Ballistics and peak hold behaviour

@Suite struct RTADisplayModelTests {
    private func power(_ db: Double) -> Double { pow(10, db / 10) }

    @Test func startsEmptyAndAdoptsTheFirstFrameExactly() {
        var model = RTADisplayModel()
        #expect(model.levels.isEmpty && model.peaks.isEmpty && model.deviations.isEmpty)
        model.step(input: [-40, -60], targetOffsets: nil, dt: 0.05)
        #expect(model.levels == [-40, -60])
        #expect(model.peaks == [-40, -60])
        #expect(model.deviations == [10, -10])
    }

    @Test func aHeldInputStaysExactlyPut() {
        var model = RTADisplayModel()
        for _ in 0..<40 { model.step(input: [-40, -50], targetOffsets: nil, dt: 0.05) }
        #expect(model.levels == [-40, -50])
    }

    /// AC2, first half: a band 6 dB over the level-matched target held 1 s
    /// reads +6 (±0.1) in amber in the Relative view.
    @Test func aBandHeldSixDbOverTheTargetForOneSecondReadsPlusSixInAmber() {
        var model = RTADisplayModel()
        let flat = [0.0, 0, 0, 0]
        model.step(input: [-40, -40, -40, -40], targetOffsets: flat, dt: 0)
        #expect(model.deviations[0] == 0, "the bar starts on the 0 line")
        // +8 dB on one of four bands is +6 over the level-matched (mean) line.
        for _ in 0..<20 { model.step(input: [-32, -40, -40, -40], targetOffsets: flat, dt: 0.05) }
        #expect(abs(model.deviations[0] - 6) <= 0.1)
        #expect(RTADeviationTone(deviationDb: model.deviations[0]) == .over)
        #expect(RTAScale.relative.clamp(model.deviations[0]).overflow == nil)
    }

    /// AC2, second half: after a 20 dB drop, one release tau (0.4 s) later
    /// the bar has decayed ~63% of the step in power, not 16 dB linear.
    @Test func afterATwentyDbDropTheBarDecaysSixtyThreePercentOfThePowerStepInOneTau() {
        var model = RTADisplayModel()
        model.step(input: [-32], targetOffsets: nil, dt: 0)
        for _ in 0..<8 { model.step(input: [-52], targetOffsets: nil, dt: 0.05) }
        let remaining = (power(model.levels[0]) - power(-52)) / (power(-32) - power(-52))
        #expect(abs(remaining - exp(-1)) < 0.002)
        #expect(model.levels[0] > -40, "not the old linear 40 dB/s release (-48 dB)")
    }

    @Test func attackUsesTheFiftyMillisecondTau() {
        var model = RTADisplayModel()
        model.step(input: [-60], targetOffsets: nil, dt: 0)
        model.step(input: [-20], targetOffsets: nil, dt: 0.05)
        let risen = (power(model.levels[0]) - power(-60)) / (power(-20) - power(-60))
        #expect(abs(risen - (1 - exp(-1))) < 1e-9)
    }

    @Test func slowBallisticsUseTheirOwnTaus() {
        var model = RTADisplayModel(ballistics: .slow)
        model.step(input: [-60], targetOffsets: nil, dt: 0)
        model.step(input: [-20], targetOffsets: nil, dt: 0.25)
        let risen = (power(model.levels[0]) - power(-60)) / (power(-20) - power(-60))
        #expect(abs(risen - (1 - exp(-1))) < 1e-9)
    }

    @Test func ballisticsAreFrameRateIndependentWithAHeldInput() {
        var twenty = RTADisplayModel()
        var sixty = RTADisplayModel()
        twenty.step(input: [-20, -70], targetOffsets: nil, dt: 0)
        sixty.step(input: [-20, -70], targetOffsets: nil, dt: 0)
        for _ in 0..<10 { twenty.step(input: [-60, -30], targetOffsets: nil, dt: 0.05) }
        for _ in 0..<30 { sixty.step(input: [-60, -30], targetOffsets: nil, dt: 1.0 / 60) }
        for (a, b) in zip(twenty.levels, sixty.levels) {
            #expect(abs(a - b) < tolerance)
        }
    }

    /// AC3: a one-frame spike's peak tick holds 1.5 s (±1 frame), then
    /// falls at 20 dB/s.
    @Test func aSpikePeakHoldsOneAndAHalfSecondsThenFallsTwentyDbPerSecond() {
        var model = RTADisplayModel()
        let frame = 1.0 / 60
        model.step(input: [-40], targetOffsets: nil, dt: 0)
        model.step(input: [-10], targetOffsets: nil, dt: 0.05)
        let peak = model.peaks[0]
        #expect(peak > -15)
        var elapsed = 0.0
        while elapsed + frame < RTAPeakHold.holdSeconds - frame {
            model.step(input: [-40], targetOffsets: nil, dt: frame)
            elapsed += frame
            #expect(model.peaks[0] == peak, "held at \(elapsed) s")
        }
        while elapsed < RTAPeakHold.holdSeconds + 0.5 {
            model.step(input: [-40], targetOffsets: nil, dt: frame)
            elapsed += frame
        }
        let expected = peak - RTAPeakHold.releaseDbPerSecond * (elapsed - RTAPeakHold.holdSeconds)
        #expect(abs(model.peaks[0] - expected) <= RTAPeakHold.releaseDbPerSecond * frame, "falls at 20 dB/s after the hold")
        #expect(model.peaks[0] >= model.levels[0], "a peak never sits below its bar")
    }

    @Test func aNewPeakRestartsTheHold() {
        var model = RTADisplayModel()
        model.step(input: [-30], targetOffsets: nil, dt: 0)
        model.step(input: [-80], targetOffsets: nil, dt: 3)
        model.step(input: [-5], targetOffsets: nil, dt: 1)
        let peak = model.peaks[0]
        model.step(input: [-80], targetOffsets: nil, dt: RTAPeakHold.holdSeconds / 2)
        #expect(model.peaks[0] == peak)
    }

    @Test func deviationsAreAgainstTheLevelMatchedTarget() {
        var model = RTADisplayModel()
        model.step(input: [-30, -40, -50], targetOffsets: [10, 0, -10], dt: 0)
        for d in model.deviations { #expect(abs(d) < 1e-9, "a mix on the target's shape sits on the 0 line") }
        model.step(input: [-30, -40, -50], targetOffsets: [0, 0, 0], dt: 0.05)
        #expect(abs(model.deviations[0] - 10) < 1e-9 && abs(model.deviations[2] + 10) < 1e-9)
    }

    @Test func aMismatchedTargetFallsBackToTheMeasuredMean() {
        var model = RTADisplayModel()
        model.step(input: [-30, -50], targetOffsets: [1, 2, 3], dt: 0)
        #expect(model.deviations == [10, -10])
    }

    @Test func aBandCountChangeReadoptsAndResetClearsEverything() {
        var model = RTADisplayModel()
        model.step(input: [-10, -10], targetOffsets: nil, dt: 0)
        model.step(input: [-50, -50, -50], targetOffsets: nil, dt: 0.05)
        #expect(model.levels == [-50, -50, -50] && model.peaks == [-50, -50, -50])
        model.reset()
        #expect(model.levels.isEmpty && model.peaks.isEmpty && model.deviations.isEmpty && model.deviationPeaks.isEmpty)
    }

    @Test func aNegativeOrNonFiniteStepIsTreatedAsZero() {
        var model = RTADisplayModel()
        model.step(input: [-10], targetOffsets: nil, dt: 0)
        model.step(input: [-80], targetOffsets: nil, dt: -5)
        #expect(model.levels == [-10])
        model.step(input: [-80], targetOffsets: nil, dt: .nan)
        #expect(model.levels == [-10])
    }

    @Test func nonFiniteInputReadsAsTheSilenceFloor() {
        var model = RTADisplayModel()
        model.step(input: [-.infinity, .nan], targetOffsets: nil, dt: 0)
        #expect(model.levels == [SpectrumAnalyzer.silenceFloorDb, SpectrumAnalyzer.silenceFloorDb])
    }
}

// MARK: Render-rate stepping

@Suite struct RTAFrameStepperTests {
    @Test func theFirstFrameAdoptsWithZeroDtThenStepsByRealTime() {
        var stepper = RTAFrameStepper()
        stepper.advance(to: 100, input: [-60], targetOffsets: nil, ballistics: .medium)
        #expect(stepper.display.levels == [-60])
        stepper.advance(to: 100.05, input: [-20], targetOffsets: nil, ballistics: .medium)
        var reference = RTADisplayModel()
        reference.step(input: [-60], targetOffsets: nil, dt: 0)
        reference.step(input: [-20], targetOffsets: nil, dt: 0.05)
        #expect(abs(stepper.display.levels[0] - reference.levels[0]) < 1e-6)
    }

    @Test func aLongGapIsCappedSoABackgroundedViewDoesNotJump() {
        var stepper = RTAFrameStepper()
        stepper.advance(to: 0, input: [-60], targetOffsets: nil, ballistics: .medium)
        stepper.advance(to: 60, input: [-20], targetOffsets: nil, ballistics: .medium)
        var reference = RTADisplayModel()
        reference.step(input: [-60], targetOffsets: nil, dt: 0)
        reference.step(input: [-20], targetOffsets: nil, dt: RTAFrameStepper.maxStepSeconds)
        #expect(stepper.display.levels == reference.levels)
    }

    @Test func clockGoingBackwardsIsAZeroStep() {
        var stepper = RTAFrameStepper()
        stepper.advance(to: 10, input: [-60], targetOffsets: nil, ballistics: .medium)
        stepper.advance(to: 9, input: [-20], targetOffsets: nil, ballistics: .medium)
        #expect(stepper.display.levels == [-60])
    }

    @Test func switchingBallisticsAppliesFromTheNextFrame() {
        var stepper = RTAFrameStepper()
        stepper.advance(to: 0, input: [-60], targetOffsets: nil, ballistics: .slow)
        stepper.advance(to: 0.25, input: [-20], targetOffsets: nil, ballistics: .slow)
        #expect(stepper.display.ballistics == .slow)
        stepper.advance(to: 0.3, input: [-20], targetOffsets: nil, ballistics: .medium)
        #expect(stepper.display.ballistics == .medium)
    }

    @Test func resetForgetsTheClockAndTheBars() {
        var stepper = RTAFrameStepper()
        stepper.advance(to: 0, input: [-60], targetOffsets: nil, ballistics: .medium)
        stepper.reset()
        #expect(stepper.display.levels.isEmpty)
        stepper.advance(to: 50, input: [-20], targetOffsets: nil, ballistics: .medium)
        #expect(stepper.display.levels == [-20], "re-adopts after a reset")
    }
}
