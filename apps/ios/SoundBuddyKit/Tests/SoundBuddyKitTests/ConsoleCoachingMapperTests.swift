import Foundation
import Testing
@testable import SoundBuddyKit

private let tolerance = 1e-9

/// Bands 2-5 PEQ, all flat (0 dB) — a desk with every PEQ/VEQ band free.
private let flatMainLRLines = [
    "/main/st/eq ON",
    "/main/st/eq/1 LShv 80 +0.00 0.7",
    "/main/st/eq/2 PEQ 250 +0.00 1.4",
    "/main/st/eq/3 PEQ 1000 +0.00 2.0",
    "/main/st/eq/4 PEQ 2500 +0.00 1.0",
    "/main/st/eq/5 PEQ 8000 +0.00 3.0",
    "/main/st/eq/6 HShv 12000 +0.00 0.7",
]

/// Bands 2-5 PEQ, every one already in use (non-zero gain).
private let busyMainLRLines = [
    "/main/st/eq ON",
    "/main/st/eq/1 LShv 80 +0.00 0.7",
    "/main/st/eq/2 PEQ 250 +1.50 1.4",
    "/main/st/eq/3 PEQ 1000 -2.00 2.0",
    "/main/st/eq/4 PEQ 2500 +0.80 1.0",
    "/main/st/eq/5 PEQ 8000 -1.20 3.0",
    "/main/st/eq/6 HShv 12000 +0.00 0.7",
]

/// No PEQ/VEQ band at all — only shelves and cuts.
private let noPeqMainLRLines = [
    "/main/st/eq ON",
    "/main/st/eq/1 LShv 80 +0.00 0.7",
    "/main/st/eq/2 LCut 40 +0.00 0.7",
    "/main/st/eq/3 LShv 120 +0.00 0.7",
    "/main/st/eq/4 HShv 4000 +0.00 0.7",
    "/main/st/eq/5 HShv 8000 +0.00 0.7",
    "/main/st/eq/6 HCut 12000 +0.00 0.7",
]

private let channelEqLines = [
    "/ch/01/eq ON",
    "/ch/01/eq/1 PEQ 100 +0.00 1.0",
    "/ch/01/eq/2 PEQ 500 +0.00 1.5",
    "/ch/01/eq/3 PEQ 2000 +0.00 2.0",
    "/ch/01/eq/4 LCut 60 +0.00 0.7",
]

private func mainLR(_ lines: [String]) -> ConsoleEQ {
    ConsoleEQ.parse(nodeLines: lines, for: .mainLR)
}

private func event(
    band: Band?, deviationDb: CoachingEvent.DataValue?, ruleType: CoachingEvent.RuleType = .bandDeviation
) -> CoachingEvent {
    CoachingEvent(
        id: "test-event", ruleType: ruleType, severity: .suggestion, band: band,
        message: "test", data: deviationDb.map { ["deviationDb": $0] }, source: .phoneMicEstimate, sessionTime: 1
    )
}

/// `sqrt(lowHz*highHz)` quantized to the console's own frequency grid, the
/// same round trip the mapper uses — so tests assert the real quantized
/// value rather than the pre-quantization geometric centre.
private func quantizedCentreHz(_ band: Band) -> Double {
    let centre = (band.lowHz * band.highHz).squareRoot()
    return ConsoleEQScale.freqHz(raw: ConsoleEQScale.rawFreq(hz: centre))
}

private func quantizedQ(_ band: Band) -> Double {
    let centre = (band.lowHz * band.highHz).squareRoot()
    let raw = min(10, max(0.3, centre / (band.highHz - band.lowHz)))
    return ConsoleEQScale.q(raw: ConsoleEQScale.rawQ(raw))
}

@Suite struct ConsoleCoachingMapperTests {
    @Test func overTargetEventCutsAtMostThreeDbInsideCoachedBand() throws {
        let eq = mainLR(flatMainLRLines)
        let suggestion = ConsoleCoachingMapper.suggestion(
            for: event(band: .lowMid, deviationDb: .number(6.2)), mainLR: eq
        )

        let suggestion2 = try #require(suggestion)
        #expect(abs(suggestion2.band.gainDb - (-3)) < 0.01)
        #expect(suggestion2.band.freqHz >= Band.lowMid.lowHz)
        #expect(suggestion2.band.freqHz < Band.lowMid.highHz)
        #expect(suggestion2.retunesBandInUse == false)
        #expect(suggestion2.bandNumber == 2)

        let expectedFreq = quantizedCentreHz(.lowMid)
        let expectedCopy = "Band 2: \u{2212}3 dB at \(ConsoleEQPanelState.freqText(expectedFreq))"
        #expect(suggestion2.copy == expectedCopy)
        #expect(suggestion2.retuneNote == nil)

        let ghost = ConsoleCoachingMapper.ghostEQ(eq, applying: suggestion2)
        let minimumNearFreq = ghost.magnitudeResponseDb(atHz: [expectedFreq]).first ?? 0
        #expect(minimumNearFreq <= -2.5)
    }

    @Test func gainClampedToThreeDbBothDirections() throws {
        let eq = mainLR(flatMainLRLines)
        let cases: [(Double, Double)] = [(10, -3), (-10, 3), (1.5, -1.5)]
        for (deviation, expectedGain) in cases {
            let suggestion = try #require(
                ConsoleCoachingMapper.suggestion(for: event(band: .bass, deviationDb: .number(deviation)), mainLR: eq)
            )
            #expect(abs(suggestion.band.gainDb - expectedGain) < 0.01, "deviation \(deviation)")
        }
    }

    @Test func centreAndQComeFromCoachedBandWidth() throws {
        let eq = mainLR(flatMainLRLines)
        for band: Band in [.bass, .brilliance] {
            let suggestion = try #require(
                ConsoleCoachingMapper.suggestion(for: event(band: band, deviationDb: .number(4)), mainLR: eq)
            )
            #expect(abs(suggestion.band.freqHz - quantizedCentreHz(band)) < tolerance, "band \(band)")
            #expect(abs(suggestion.band.q - quantizedQ(band)) < tolerance, "band \(band)")
        }
    }

    @Test func picksNearestFlatPeqBand() throws {
        // Bands 2 and 5 are flat PEQ (250 Hz, 8000 Hz); 3 and 4 are already
        // in use. Low-mid (250-500 Hz) must pick the 250 Hz band (index 1),
        // never the shelves/cuts at 0 dB on bands 1 and 6.
        let lines = [
            "/main/st/eq ON",
            "/main/st/eq/1 LShv 80 +0.00 0.7",
            "/main/st/eq/2 PEQ 250 +0.00 1.4",
            "/main/st/eq/3 PEQ 1000 -2.00 2.0",
            "/main/st/eq/4 PEQ 2500 +1.00 1.0",
            "/main/st/eq/5 PEQ 8000 +0.00 3.0",
            "/main/st/eq/6 HShv 12000 +0.00 0.7",
        ]
        let eq = mainLR(lines)
        let suggestion = try #require(
            ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .number(4)), mainLR: eq)
        )
        #expect(suggestion.bandIndex == 1)
        #expect(suggestion.retunesBandInUse == false)
    }

    @Test func allBandsInUsePicksNearestPeqAndFlagsRetune() throws {
        let eq = mainLR(busyMainLRLines)
        let suggestion = try #require(
            ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .number(4)), mainLR: eq)
        )
        #expect(suggestion.bandIndex == 1) // 250 Hz, nearest to low-mid's centre
        #expect(suggestion.retunesBandInUse == true)
        #expect(suggestion.retuneNote?.contains("will be retuned") == true)
    }

    @Test func noSuggestionForUnusableInput() {
        let flat = mainLR(flatMainLRLines)
        let channel = ConsoleEQ.parse(nodeLines: channelEqLines, for: .channel(1))
        let noPeq = mainLR(noPeqMainLRLines)

        #expect(ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .number(4), ruleType: .harshness), mainLR: flat) == nil)
        #expect(ConsoleCoachingMapper.suggestion(for: event(band: nil, deviationDb: .number(4)), mainLR: flat) == nil)
        #expect(ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: nil), mainLR: flat) == nil)
        #expect(ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .string("bad")), mainLR: flat) == nil)
        #expect(ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .number(0)), mainLR: flat) == nil)
        #expect(ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .number(4)), mainLR: channel) == nil)
        #expect(ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .number(4)), mainLR: noPeq) == nil)
    }

    @Test func actionHiddenWithoutVisibleConsoleOrLiveLink() {
        let bandDeviation = event(band: .lowMid, deviationDb: .number(4))
        let other = event(band: .lowMid, deviationDb: .number(4), ruleType: .harshness)

        #expect(ConsoleCoachingMapper.showsAction(for: bandDeviation, consoleVisible: false, phase: .live) == false)

        let nonLivePhases: [ConsoleSessionPhase] = [
            .idle, .connecting, .syncing, .reconnecting, .suspended, .noNetwork, .permissionDenied,
        ]
        for phase in nonLivePhases {
            #expect(ConsoleCoachingMapper.showsAction(for: bandDeviation, consoleVisible: true, phase: phase) == false, "phase \(phase)")
        }

        #expect(ConsoleCoachingMapper.showsAction(for: bandDeviation, consoleVisible: true, phase: .live) == true)
        #expect(ConsoleCoachingMapper.showsAction(for: bandDeviation, consoleVisible: true, phase: .liveDegraded) == true)
        #expect(ConsoleCoachingMapper.showsAction(for: other, consoleVisible: true, phase: .live) == false)
    }

    @Test func applyLabelReadsUnlockToApplyWhenDisarmed() {
        #expect(ConsoleCoachingMapper.applyLabel(isArmed: false) == ConsoleCoachingMapper.applyLabelDisarmed)
        #expect(ConsoleCoachingMapper.applyLabel(isArmed: false) == "Unlock to apply")
    }

    @Test func applyLabelReadsApplyWhenArmed() {
        #expect(ConsoleCoachingMapper.applyLabel(isArmed: true) == ConsoleCoachingMapper.applyLabelArmed)
        #expect(ConsoleCoachingMapper.applyLabel(isArmed: true) == "Apply")
    }

    @Test func undoLabelReadsUnlockToUndoWhenDisarmed() {
        #expect(ConsoleCoachingMapper.undoLabel(isArmed: false) == ConsoleCoachingMapper.undoLabelDisarmed)
        #expect(ConsoleCoachingMapper.undoLabel(isArmed: false) == "Unlock to undo")
    }

    @Test func undoLabelReadsUndoWhenArmed() {
        #expect(ConsoleCoachingMapper.undoLabel(isArmed: true) == ConsoleCoachingMapper.undoLabelArmed)
        #expect(ConsoleCoachingMapper.undoLabel(isArmed: true) == "Undo")
    }

    @Test func appliedBeforeAfterCopy() throws {
        let eq = mainLR(flatMainLRLines)
        let suggestion = try #require(
            ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .number(6.2)), mainLR: eq)
        )
        let applied = ConsoleCoachingMapper.applied(suggestion, to: eq)

        let freqText = ConsoleEQPanelState.freqText(quantizedCentreHz(.lowMid))
        #expect(applied.bandIndex == 1)
        #expect(applied.confirmation == "Applied \u{2212}3 dB at \(freqText) on Main LR")
        #expect(applied.beforeAfter == "Band 2: +0 dB at 250 Hz \u{2192} \u{2212}3 dB at \(freqText)")
    }

    @Test func appliedLimitsGainAgainstPrior() throws {
        var eq = mainLR(flatMainLRLines)
        eq.bands[1] = ConsoleEQBand(type: .peaking, freqHz: 250, gainDb: 2, q: 1.4)

        let ghostBand = ConsoleEQBand(type: .peaking, freqHz: 250, gainDb: -3, q: 1.4)
        let suggestion = ConsoleCoachingSuggestion(bandIndex: 1, band: ghostBand, retunesBandInUse: false, copy: "test", retuneNote: nil)

        let applied = ConsoleCoachingMapper.applied(suggestion, to: eq)
        #expect(abs(applied.written.gainDb - (-1)) < tolerance)
        #expect(abs(applied.prior.gainDb - 2) < tolerance)
    }

    @Test func ghostEQSubstitutesBandAndTurnsEqOn() throws {
        var eq = mainLR(flatMainLRLines)
        eq.on = false
        let suggestion = try #require(
            ConsoleCoachingMapper.suggestion(for: event(band: .lowMid, deviationDb: .number(4)), mainLR: eq)
        )

        let ghost = ConsoleCoachingMapper.ghostEQ(eq, applying: suggestion)
        #expect(ghost.on == true)
        #expect(ghost.bands[suggestion.bandIndex] == suggestion.band)
        for index in ghost.bands.indices where index != suggestion.bandIndex {
            #expect(ghost.bands[index] == eq.bands[index])
        }
    }
}
