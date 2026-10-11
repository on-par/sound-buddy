import Foundation
import Testing
@testable import SoundBuddyKit

// Float (not Double) precision: a Float literal like 0.6 round-trips through
// Double with a larger error than Double arithmetic alone, so this is looser
// than ConsoleEQScaleTests' Double-only tolerances.
private let tolerance = 1e-5

@Suite struct ConsoleEQPushTests {
    @Test func eqOnLeafTogglesOnOffAndNonzeroMeansOn() {
        var eq = ConsoleEQ.flat(for: .mainLR)
        #expect(eq.apply(push: OSCMessage("/main/st/eq", [.int(1)])) == true)
        #expect(eq.on == true)
        #expect(eq.apply(push: OSCMessage("/main/st/eq", [.int(0)])) == true)
        #expect(eq.on == false)
        #expect(eq.apply(push: OSCMessage("/main/st/eq", [.int(5)])) == true)
        #expect(eq.on == true)
    }

    @Test func bandTypeLeafUpdatesType() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/2/type", [.int(4)])) == true)
        #expect(eq.bands[1].type == .highShelf)
    }

    @Test func bandFreqLeafUpdatesFreqHz() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/1/f", [.float(0.5)])) == true)
        #expect(abs(eq.bands[0].freqHz - ConsoleEQScale.freqHz(raw: 0.5)) < tolerance)
    }

    @Test func bandGainLeafUpdatesGainDb() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/2/g", [.float(0.6)])) == true)
        #expect(abs(eq.bands[1].gainDb - 3.0) < tolerance)
        #expect(abs(eq.bands[1].gainDb - ConsoleEQScale.gainDb(raw: 0.6)) < tolerance)
    }

    @Test func bandQLeafUpdatesQ() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/3/q", [.float(0.25)])) == true)
        #expect(abs(eq.bands[2].q - ConsoleEQScale.q(raw: 0.25)) < tolerance)
    }

    @Test func combinedBandLeafUpdatesAllFourFields() {
        var eq = ConsoleEQ.flat(for: .mainLR)
        #expect(eq.apply(push: OSCMessage("/main/st/eq/4", [.int(2), .float(0.5), .float(0.6), .float(0.25)])) == true)
        #expect(eq.bands[3].type == .peaking)
        #expect(abs(eq.bands[3].freqHz - ConsoleEQScale.freqHz(raw: 0.5)) < tolerance)
        #expect(abs(eq.bands[3].gainDb - ConsoleEQScale.gainDb(raw: 0.6)) < tolerance)
        #expect(abs(eq.bands[3].q - ConsoleEQScale.q(raw: 0.25)) < tolerance)
    }

    @Test func preampHpOnLeafTogglesHpf() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        #expect(eq.apply(push: OSCMessage("/ch/01/preamp/hpon", [.int(1)])) == true)
        #expect(eq.hpf?.on == true)
    }

    @Test func preampHpSlopeLeafUpdatesSlope() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        #expect(eq.apply(push: OSCMessage("/ch/01/preamp/hpslope", [.int(1)])) == true)
        #expect(eq.hpf?.slopeDbPerOctave == 18)
    }

    @Test func preampHpfLeafUpdatesFreqHz() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        #expect(eq.apply(push: OSCMessage("/ch/01/preamp/hpf", [.float(0.5)])) == true)
        #expect(abs((eq.hpf?.freqHz ?? -1) - ConsoleEQScale.hpfHz(raw: 0.5)) < tolerance)
    }

    @Test func noLeadingSlashAddressIsAccepted() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        #expect(eq.apply(push: OSCMessage("ch/01/eq/2/g", [.float(0.6)])) == true)
        #expect(abs(eq.bands[1].gainDb - 3.0) < tolerance)
    }

    @Test func anotherTargetAddressIsRejectedAndLeavesValueUnchanged() {
        var eq = ConsoleEQ.flat(for: .mainLR)
        let before = eq
        #expect(eq.apply(push: OSCMessage("/ch/02/eq/1/g", [.float(0.6)])) == false)
        #expect(eq == before)
    }

    @Test func bandIndexOutOfRangeOrNonNumericIsRejected() {
        let cases: [(target: ConsoleEQTarget, address: String)] = [
            (.channel(1), "/ch/01/eq/0/g"),
            (.channel(1), "/ch/01/eq/5/g"),
            (.channel(1), "/ch/01/eq/abc/g"),
            (.mainLR, "/main/st/eq/7/g"),
            (.mainLR, "/main/st/eq/0/g"),
        ]
        for testCase in cases {
            var eq = ConsoleEQ.flat(for: testCase.target)
            let before = eq
            #expect(eq.apply(push: OSCMessage(testCase.address, [.float(0.6)])) == false, "expected \(testCase.address) to be rejected")
            #expect(eq == before)
        }
    }

    @Test func outOfRangeTypeIsRejected() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        let before = eq
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/1/type", [.int(6)])) == false)
        #expect(eq == before)
    }

    @Test func outOfRangeSlopeIndexIsRejected() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        let before = eq
        #expect(eq.apply(push: OSCMessage("/ch/01/preamp/hpslope", [.int(3)])) == false)
        #expect(eq == before)
    }

    @Test func wrongArgTypeOrCountIsRejected() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        let before = eq
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/1/g", [.int(1)])) == false)
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/1/g", [])) == false)
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/1/g", [.float(0.1), .float(0.2)])) == false)
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/4", [.int(2), .float(0.5), .float(0.6)])) == false)
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/4", [.float(0.2), .float(0.5), .float(0.6), .float(0.1)])) == false)
        #expect(eq == before)
    }

    @Test func nanIsRejectedAndOutOfRangeFloatIsClamped() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        let before = eq
        #expect(eq.apply(push: OSCMessage("/ch/01/eq/1/g", [.float(.nan)])) == false)
        #expect(eq == before)

        #expect(eq.apply(push: OSCMessage("/ch/01/eq/1/g", [.float(1.5)])) == true)
        #expect(abs(eq.bands[0].gainDb - ConsoleEQScale.gainDb(raw: 1)) < tolerance)
    }

    @Test func preampPushOnMainLRIsRejected() {
        var eq = ConsoleEQ.flat(for: .mainLR)
        let before = eq
        #expect(eq.apply(push: OSCMessage("/main/st/preamp/hpon", [.int(1)])) == false)
        #expect(eq == before)
    }

    @Test func unknownLeafIsRejected() {
        var mainEq = ConsoleEQ.flat(for: .mainLR)
        let mainBefore = mainEq
        #expect(mainEq.apply(push: OSCMessage("/main/st/eq/2/x", [.float(0.5)])) == false)
        #expect(mainEq == mainBefore)

        var channelEq = ConsoleEQ.flat(for: .channel(1))
        let channelBefore = channelEq
        #expect(channelEq.apply(push: OSCMessage("/ch/01/preamp/trim", [.float(0.5)])) == false)
        #expect(channelEq == channelBefore)
    }

    @Test func nodeQueryPathsForMainLR() {
        #expect(ConsoleEQTarget.mainLR.nodeQueryPaths == [
            "main/st/eq", "main/st/eq/1", "main/st/eq/2", "main/st/eq/3",
            "main/st/eq/4", "main/st/eq/5", "main/st/eq/6",
        ])
    }

    @Test func nodeQueryPathsForChannel() {
        #expect(ConsoleEQTarget.channel(1).nodeQueryPaths == [
            "ch/01/eq", "ch/01/eq/1", "ch/01/eq/2", "ch/01/eq/3", "ch/01/eq/4", "ch/01/preamp",
        ])
    }
}
