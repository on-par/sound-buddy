import Foundation
import Testing
@testable import SoundBuddyKit

private let tolerance = 1e-9

private let mainLRLines = [
    "/main/st/eq ON",
    "/main/st/eq/1 LShv 80 +2.00 0.7",
    "/main/st/eq/2 PEQ 250 -3.50 1.4",
    "/main/st/eq/3 PEQ 1000 +0.00 2.0",
    "/main/st/eq/4 PEQ 2500 +4.20 1.0",
    "/main/st/eq/5 PEQ 8000 -1.00 3.0",
    "/main/st/eq/6 HCut 12000 +0.00 0.7",
]

private let channelLines = [
    "/ch/01/preamp +0.0 OFF ON 18 80",
    "/ch/01/eq ON",
    "/ch/01/eq/1 PEQ 100 +1.00 1.0",
    "/ch/01/eq/2 PEQ 500 -2.00 1.5",
    "/ch/01/eq/3 PEQ 2000 +0.00 2.0",
    "/ch/01/eq/4 LCut 60 +0.00 0.7",
]

@Suite struct ConsoleEQPanelStateTests {
    @Test func mainLRNodeLinesYieldSixRowsAndCurveMatchingDesk() {
        let eq = ConsoleEQ.parse(nodeLines: mainLRLines, for: .mainLR)
        let state = ConsoleEQPanelState(target: .mainLR, eq: eq, phase: .live)

        #expect(state.bandRows.count == 6)
        #expect(state.bandRows[0] == ConsoleEQBandReadout(
            number: 1, typeLabel: "Low shelf", freqText: "80 Hz", gainText: "+2.0 dB", qText: "0.7"
        ))
        #expect(state.bandRows[1] == ConsoleEQBandReadout(
            number: 2, typeLabel: "PEQ", freqText: "250 Hz", gainText: "-3.5 dB", qText: "1.4"
        ))
        #expect(state.bandRows[2] == ConsoleEQBandReadout(
            number: 3, typeLabel: "PEQ", freqText: "1.0 kHz", gainText: "0.0 dB", qText: "2.0"
        ))
        #expect(state.bandRows[3] == ConsoleEQBandReadout(
            number: 4, typeLabel: "PEQ", freqText: "2.5 kHz", gainText: "+4.2 dB", qText: "1.0"
        ))
        #expect(state.bandRows[4] == ConsoleEQBandReadout(
            number: 5, typeLabel: "PEQ", freqText: "8.0 kHz", gainText: "-1.0 dB", qText: "3.0"
        ))
        #expect(state.bandRows[5] == ConsoleEQBandReadout(
            number: 6, typeLabel: "High cut", freqText: "12.0 kHz", gainText: "—", qText: "—"
        ))
        #expect(state.eqOnLabel == "EQ On")
        #expect(state.hpfText == nil)

        let expectedCurve = eq.magnitudeResponseDb(atHz: ConsoleEQPanelState.curveFrequencies).map {
            min(ConsoleEQPanelState.curveRangeDb, max(-ConsoleEQPanelState.curveRangeDb, $0))
        }
        #expect(state.curveDb.count == expectedCurve.count)
        for (actual, expected) in zip(state.curveDb, expectedCurve) {
            #expect(abs(actual - expected) < tolerance)
        }
    }

    @Test func channelGivesFourRowsPlusHPFText() {
        let eq = ConsoleEQ.parse(nodeLines: channelLines, for: .channel(1))
        let state = ConsoleEQPanelState(target: .channel(1), eq: eq, phase: .live)

        #expect(state.bandRows.count == 4)
        #expect(state.bandRows[3] == ConsoleEQBandReadout(
            number: 4, typeLabel: "Low cut", freqText: "60 Hz", gainText: "—", qText: "—"
        ))
        #expect(state.eqOnLabel == "EQ On")
        #expect(state.hpfText == "HPF 80 Hz · 18 dB/oct")
    }

    @Test func hpfOffReadsHPFOff() {
        let eq = ConsoleEQ.parse(nodeLines: [
            "/ch/02/preamp +0.0 OFF OFF 12 100",
        ], for: .channel(2))
        let state = ConsoleEQPanelState(target: .channel(2), eq: eq, phase: .live)
        #expect(state.hpfText == "HPF off")
    }

    @Test func hpfTextIsNilForMainLREvenWhenRead() {
        let eq = ConsoleEQ.parse(nodeLines: mainLRLines, for: .mainLR)
        let state = ConsoleEQPanelState(target: .mainLR, eq: eq, phase: .live)
        #expect(state.hpfText == nil)
    }

    @Test func curveFrequenciesEndpointsAndCount() {
        let freqs = ConsoleEQPanelState.curveFrequencies
        #expect(freqs.count == ConsoleEQPanelState.curvePointCount)
        #expect(abs(freqs.first! - ConsoleEQPanelState.curveMinHz) < tolerance)
        #expect(abs(freqs.last! - ConsoleEQPanelState.curveMaxHz) < tolerance)
    }

    @Test func deepHPFCurveIsClampedToCurveRange() {
        let eq = ConsoleEQ(
            target: .channel(1),
            on: false,
            bands: Array(repeating: .flat, count: ConsoleEQTarget.channelBandCount),
            hpf: ConsoleHPF(on: true, slopeDbPerOctave: 24, freqHz: 2000)
        )
        let state = ConsoleEQPanelState(target: .channel(1), eq: eq, phase: .live)
        let curve = state.curveDb
        #expect(!curve.isEmpty)
        for value in curve {
            #expect(value >= -ConsoleEQPanelState.curveRangeDb - tolerance)
            #expect(value <= ConsoleEQPanelState.curveRangeDb + tolerance)
        }
        // Low frequencies sit far below the floor before clamping, so the
        // clamp must actually bind at the bottom of the curve.
        #expect(abs(curve.first! - (-ConsoleEQPanelState.curveRangeDb)) < tolerance)
    }

    @Test func nilEqGivesPlaceholderNoRowsEmptyCurve() {
        let state = ConsoleEQPanelState(target: .mainLR, eq: nil, phase: .idle)
        #expect(state.placeholder == ConsoleEQPanelState.readingPlaceholder)
        #expect(state.bandRows.isEmpty)
        #expect(state.curveDb.isEmpty)
        #expect(state.eqOnLabel == nil)
        #expect(state.hpfText == nil)
    }

    @Test func placeholderIsNilOnceRead() {
        let eq = ConsoleEQ.flat(for: .mainLR)
        let state = ConsoleEQPanelState(target: .mainLR, eq: eq, phase: .idle)
        #expect(state.placeholder == nil)
    }

    @Test func isDimmedAndStatusPillAcrossEveryPhase() {
        let eq = ConsoleEQ.flat(for: .mainLR)
        let allPhases: [ConsoleSessionPhase] = [
            .idle, .connecting, .syncing, .live, .liveDegraded, .reconnecting, .suspended, .noNetwork, .permissionDenied,
        ]
        for phase in allPhases {
            let state = ConsoleEQPanelState(target: .mainLR, eq: eq, phase: phase)
            #expect(state.isDimmed == !phase.isLinkUp, "phase \(phase)")
            if phase.isLinkUp {
                #expect(state.statusPill == nil, "phase \(phase)")
            } else {
                #expect(state.statusPill == ConsoleChipStatus(phase: phase).label, "phase \(phase)")
            }
        }
    }

    @Test func isDimmedIsFalseWithoutAnEqRegardlessOfPhase() {
        let state = ConsoleEQPanelState(target: .mainLR, eq: nil, phase: .reconnecting)
        #expect(state.isDimmed == false)
    }
}
