import Foundation
import Testing
@testable import SoundBuddyKit

// Real example lines from packages/console/src/capture-2026-08-16.scn.
private let channel01Lines = [
    "/ch/01/preamp +0.0 OFF ON 24 178",
    "/ch/01/eq ON",
    "/ch/01/eq/1 PEQ 328.1 -6.25 2.0",
    "/ch/01/eq/2 PEQ 1k09 -8.25 2.0",
    "/ch/01/eq/3 PEQ 2k43 -9.50 2.0",
    "/ch/01/eq/4 PEQ 10k74 -6.25 2.9",
]

private let mainStLines = [
    "/main/st/eq OFF",
    "/main/st/eq/1 LShv 79.6 +0.00 2.0",
    "/main/st/eq/2 PEQ 158.9 +0.00 2.0",
    "/main/st/eq/3 PEQ 496.6 +0.00 2.0",
    "/main/st/eq/4 PEQ 1k97 +0.00 2.0",
    "/main/st/eq/5 PEQ 5k02 +0.00 2.0",
    "/main/st/eq/6 HShv 10k02 +0.00 2.0",
]

private let tolerance = 1e-9

@Suite struct ConsoleEQNodeTests {
    // MARK: - AC3: /node lines populate 4 channel bands / 6 Main LR bands

    @Test func parsesChannelFourBandsAndMainLRSixBands() {
        let channel = ConsoleEQ.parse(nodeLines: channel01Lines, for: .channel(1))
        #expect(channel.bands.count == 4)
        #expect(channel.on == true)
        #expect(channel.bands[1].type == .peaking)
        #expect(abs(channel.bands[1].freqHz - 1090) < tolerance)
        #expect(abs(channel.bands[1].gainDb - (-8.25)) < tolerance)
        #expect(abs(channel.bands[1].q - 2.0) < tolerance)
        #expect(abs(channel.bands[3].freqHz - 10740) < tolerance)
        #expect(abs(channel.bands[3].q - 2.9) < tolerance)
        #expect(channel.hpf?.on == true)
        #expect(channel.hpf?.slopeDbPerOctave == 24)
        #expect(abs((channel.hpf?.freqHz ?? -1) - 178) < tolerance)

        let main = ConsoleEQ.parse(nodeLines: mainStLines, for: .mainLR)
        #expect(main.bands.count == 6)
        #expect(main.on == false)
        #expect(main.bands[0].type == .lowShelf)
        #expect(abs(main.bands[0].freqHz - 79.6) < tolerance)
        #expect(main.bands[5].type == .highShelf)
        #expect(abs(main.bands[5].freqHz - 10_020) < tolerance)
        #expect(main.hpf == nil)
    }

    @Test func frequencyTokenForms() {
        #expect(ConsoleEQ.frequencyHz(nodeToken: "328.1") == 328.1)
        #expect(abs(ConsoleEQ.frequencyHz(nodeToken: "2k5")! - 2500) < tolerance)
        #expect(abs(ConsoleEQ.frequencyHz(nodeToken: "1k09")! - 1090) < tolerance)
        #expect(abs(ConsoleEQ.frequencyHz(nodeToken: "10k74")! - 10_740) < tolerance)
        #expect(abs(ConsoleEQ.frequencyHz(nodeToken: "20k0")! - 20_000) < tolerance)
        #expect(ConsoleEQ.frequencyHz(nodeToken: "20") == 20)

        #expect(ConsoleEQ.frequencyHz(nodeToken: "") == nil)
        #expect(ConsoleEQ.frequencyHz(nodeToken: "k") == nil)
        #expect(ConsoleEQ.frequencyHz(nodeToken: "2k5k") == nil)
        #expect(ConsoleEQ.frequencyHz(nodeToken: "abc") == nil)
    }

    @Test func issueExampleLineParses() {
        var eq = ConsoleEQ.flat(for: .channel(5))
        #expect(eq.apply(nodeLine: "/ch/05/eq/2 PEQ 2k5 -3.0 2.0") == true)
        #expect(abs(eq.bands[1].freqHz - 2500) < tolerance)
        #expect(abs(eq.bands[1].gainDb - (-3.0)) < tolerance)
        #expect(abs(eq.bands[1].q - 2.0) < tolerance)
    }

    @Test func ignoresMalformedAndForeignLines() {
        let edgeCases: [(target: ConsoleEQTarget, line: String)] = [
            (.channel(5), ""),
            (.channel(5), "/ch/06/eq ON"),
            (.channel(5), "/main/st/eq ON"),
            (.channel(5), "/ch/05/eq/5 PEQ 100 0 1"),
            (.mainLR, "/main/st/eq/7 PEQ 100 0 1"),
            (.channel(5), "/ch/05/eq/0 PEQ 100 0 1"),
            (.channel(5), "/ch/05/eq/1 BPF 100 0 1"),
            (.channel(5), "/ch/05/eq/1 PEQ 100 0"),
            (.channel(5), "/ch/05/eq/1 PEQ 2kx 0 1"),
            (.channel(5), "/ch/05/eq/1 PEQ 100 abc 1"),
            (.channel(5), "/ch/05/eq/1 PEQ 100 0 abc"),
            (.channel(5), "/ch/05/eq MAYBE"),
            (.mainLR, "/main/st/preamp +0.0 OFF ON 24 178"),
            (.channel(5), "/ch/05/preamp +0.0 OFF ON 6 178"),
            (.channel(5), "/ch/05/preamp +0.0 OFF ON 24"),
        ]

        for edgeCase in edgeCases {
            var eq = ConsoleEQ.flat(for: edgeCase.target)
            let before = eq
            let applied = eq.apply(nodeLine: edgeCase.line)
            #expect(applied == false, "expected \"\(edgeCase.line)\" to be rejected")
            #expect(eq == before, "expected \"\(edgeCase.line)\" to leave the model unchanged")
        }
    }
}
