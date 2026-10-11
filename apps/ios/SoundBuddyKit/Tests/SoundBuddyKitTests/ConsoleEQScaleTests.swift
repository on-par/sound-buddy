import Foundation
import Testing
@testable import SoundBuddyKit

private let tightTolerance = 1e-6
private let qTolerance = 1e-5
private let hpfTolerance = 1e-8
private let exactStepTolerance = 1e-9

@Suite struct ConsoleEQScaleTests {
    // MARK: - AC1: raw -> units matches the scaling.ts fixtures (#848)

    @Test func rawToUnitsMatchScalingTsFixtures() {
        let freqFixtures: [(raw: Double, expected: Double)] = [
            (0, 20), (0.25, 112.46826503806983), (0.5, 632.4555320336758),
            (0.75, 3556.5588200778457), (1, 20000),
        ]
        for f in freqFixtures {
            #expect(abs(ConsoleEQScale.freqHz(raw: f.raw) - f.expected) < tightTolerance)
        }

        let gainFixtures: [(raw: Double, expected: Double)] = [
            (0, -15), (0.25, -7.5), (0.5, 0), (0.75, 7.5), (1, 15),
        ]
        for f in gainFixtures {
            #expect(abs(ConsoleEQScale.gainDb(raw: f.raw) - f.expected) < tightTolerance)
        }

        let qFixtures: [(raw: Double, expected: Double)] = [
            (0, 10), (0.25, 4.161791), (0.5, 1.732051), (0.75, 0.720843), (1, 0.3),
        ]
        for f in qFixtures {
            #expect(abs(ConsoleEQScale.q(raw: f.raw) - f.expected) < qTolerance)
        }

        let hpfFixtures: [(raw: Double, expected: Double)] = [
            (0, 20), (0.25, 42.294850537622565), (0.5, 89.44271909999159),
            (0.75, 189.14832180063516), (1, 400),
        ]
        for f in hpfFixtures {
            #expect(abs(ConsoleEQScale.hpfHz(raw: f.raw) - f.expected) < hpfTolerance)
        }
    }

    // MARK: - AC2: units -> raw -> units lands on the nearest console step

    @Test func unitsRoundTripLandOnNearestConsoleStep() {
        let freqSteps = Double(ConsoleEQScale.freqStepCount - 1)
        let rawFreq1000 = ConsoleEQScale.rawFreq(hz: 1000)
        #expect(abs(rawFreq1000 * freqSteps - 113) < exactStepTolerance)
        #expect(abs(ConsoleEQScale.freqHz(raw: rawFreq1000) - 20 * pow(1000, 113.0 / 200)) < tightTolerance)

        let rawGain = ConsoleEQScale.rawGain(db: -3.1)
        #expect(abs(rawGain - 0.4) < exactStepTolerance)
        #expect(abs(ConsoleEQScale.gainDb(raw: rawGain) - (-3.0)) < tightTolerance)

        let qSteps = Double(ConsoleEQScale.qStepCount - 1)
        let rawQ2 = ConsoleEQScale.rawQ(2.0)
        #expect(abs(rawQ2 * qSteps - 33) < exactStepTolerance)
        #expect(abs(ConsoleEQScale.q(raw: rawQ2) - 10 * pow(0.03, 33.0 / 71)) < tightTolerance)

        let hpfSteps = Double(ConsoleEQScale.hpfStepCount - 1)
        let rawHpf100 = ConsoleEQScale.rawHpf(hz: 100)
        #expect(abs(rawHpf100 * hpfSteps - (100 * log(5) / log(20)).rounded()) < exactStepTolerance)

        // Nearest-step property: the round-trip error never exceeds the
        // distance to either neighboring grid point.
        assertNearestStep(unit: 1000, raw: rawFreq1000, toUnit: ConsoleEQScale.freqHz, stepCount: ConsoleEQScale.freqStepCount)
        assertNearestStep(unit: -3.1, raw: rawGain, toUnit: ConsoleEQScale.gainDb, stepCount: ConsoleEQScale.gainStepCountForTest)
        assertNearestStep(unit: 2.0, raw: rawQ2, toUnit: ConsoleEQScale.q, stepCount: ConsoleEQScale.qStepCount)
        assertNearestStep(unit: 100, raw: rawHpf100, toUnit: ConsoleEQScale.hpfHz, stepCount: ConsoleEQScale.hpfStepCount)
    }

    private func assertNearestStep(unit: Double, raw: Double, toUnit: (Double) -> Double, stepCount: Int) {
        let steps = Double(stepCount - 1)
        let index = (raw * steps).rounded()
        let error = abs(unit - toUnit(raw))
        let below = index > 0 ? abs(unit - toUnit((index - 1) / steps)) : Double.infinity
        let above = index < steps ? abs(unit - toUnit((index + 1) / steps)) : Double.infinity
        #expect(error <= below + exactStepTolerance)
        #expect(error <= above + exactStepTolerance)
    }

    @Test func exactStepValuesRoundTripUnchanged() {
        assertExactStepRoundTrip(stepCount: ConsoleEQScale.freqStepCount, toRaw: { ConsoleEQScale.rawFreq(hz: ConsoleEQScale.freqHz(raw: $0)) })
        assertExactStepRoundTrip(
            stepCount: ConsoleEQScale.gainStepCountForTest,
            toRaw: { ConsoleEQScale.rawGain(db: ConsoleEQScale.gainDb(raw: $0)) }
        )
        assertExactStepRoundTrip(stepCount: ConsoleEQScale.qStepCount, toRaw: { ConsoleEQScale.rawQ(ConsoleEQScale.q(raw: $0)) })
        assertExactStepRoundTrip(stepCount: ConsoleEQScale.hpfStepCount, toRaw: { ConsoleEQScale.rawHpf(hz: ConsoleEQScale.hpfHz(raw: $0)) })
    }

    private func assertExactStepRoundTrip(stepCount: Int, toRaw: (Double) -> Double) {
        let steps = Double(stepCount - 1)
        for i in 0..<stepCount {
            let raw = Double(i) / steps
            #expect(abs(toRaw(raw) - raw) < exactStepTolerance)
        }
    }

    @Test func unitToRawClampsOutOfRange() {
        #expect(ConsoleEQScale.rawFreq(hz: 5) == 0)
        #expect(ConsoleEQScale.rawFreq(hz: 50_000) == 1)
        #expect(ConsoleEQScale.rawGain(db: 20) == 1)
        #expect(ConsoleEQScale.rawGain(db: -20) == 0)
        #expect(ConsoleEQScale.rawQ(100) == 0)
        #expect(ConsoleEQScale.rawQ(0.01) == 1)
        #expect(ConsoleEQScale.rawHpf(hz: 1000) == 1)
    }

    @Test func unitToRawNeutralForNaNAndNonPositive() {
        #expect(ConsoleEQScale.rawFreq(hz: .nan) == 0)
        #expect(ConsoleEQScale.rawFreq(hz: 0) == 0)
        #expect(ConsoleEQScale.rawFreq(hz: -1) == 0)
        #expect(ConsoleEQScale.rawGain(db: .nan) == 0.5)
        #expect(ConsoleEQScale.rawQ(.nan) == 0)
        #expect(ConsoleEQScale.rawQ(0) == 0)
        #expect(ConsoleEQScale.rawHpf(hz: .nan) == 0)
    }

    @Test func bandTypeRawOrderAndTokens() {
        #expect(ConsoleEQBandType(rawValue: 0) == .lowCut)
        #expect(ConsoleEQBandType(rawValue: 1) == .lowShelf)
        #expect(ConsoleEQBandType(rawValue: 2) == .peaking)
        #expect(ConsoleEQBandType(rawValue: 3) == .vintagePeaking)
        #expect(ConsoleEQBandType(rawValue: 4) == .highShelf)
        #expect(ConsoleEQBandType(rawValue: 5) == .highCut)

        for type in ConsoleEQBandType.allCases {
            #expect(ConsoleEQBandType(nodeToken: type.nodeToken) == type)
        }

        #expect(ConsoleEQBandType(nodeToken: "peq") == nil)
        #expect(ConsoleEQBandType(nodeToken: "BPF") == nil)
    }

    @Test func targetPathsAndBandCounts() {
        #expect(ConsoleEQTarget.channel(5).eqPath == "/ch/05/eq")
        #expect(ConsoleEQTarget.channel(12).preampPath == "/ch/12/preamp")
        #expect(ConsoleEQTarget.mainLR.eqPath == "/main/st/eq")
        #expect(ConsoleEQTarget.mainLR.preampPath == nil)
        #expect(ConsoleEQTarget.channel(1).bandCount == 4)
        #expect(ConsoleEQTarget.mainLR.bandCount == 6)

        let channelEq = ConsoleEQ.flat(for: .channel(1))
        #expect(channelEq.bands.count == 4)
        #expect(channelEq.hpf != nil)
        #expect(channelEq.on == false)

        let mainEq = ConsoleEQ.flat(for: .mainLR)
        #expect(mainEq.bands.count == 6)
        #expect(mainEq.hpf == nil)
        #expect(mainEq.on == false)
    }
}

extension ConsoleEQScale {
    /// The gain step count (121: 30 dB span in 0.25 dB steps) is private in
    /// the production type; this mirrors it for the round-trip tests above.
    fileprivate static let gainStepCountForTest = Int((30.0 / 0.25).rounded()) + 1
}
