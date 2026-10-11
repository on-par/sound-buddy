import Foundation
import Testing
@testable import SoundBuddyKit

@Suite struct ConsoleDeskSelectTests {
    @Test func channelIndicesMapToChannels1Through32() {
        for index in 0...31 {
            #expect(ConsoleDeskSelect.target(selidx: index) == .target(.channel(index + 1)))
        }
    }

    @Test func index70MapsToMainLR() {
        #expect(ConsoleDeskSelect.target(selidx: 70) == .target(.mainLR))
    }

    @Test func auxFxBusMatrixAndMonoAreUnsupported() {
        for index in [32, 39, 40, 47, 48, 63, 64, 69, 71] {
            #expect(ConsoleDeskSelect.target(selidx: index) == .unsupported)
        }
    }

    @Test func outOfRangeIndicesAreNil() {
        for index in [-1, 72, 1000] {
            #expect(ConsoleDeskSelect.target(selidx: index) == nil)
        }
    }

    @Test func parsesSelidxPushWithAndWithoutLeadingSlash() {
        #expect(ConsoleDeskSelect(push: OSCMessage("/-stat/selidx", [.int(6)])) == .target(.channel(7)))
        #expect(ConsoleDeskSelect(push: OSCMessage("-stat/selidx", [.int(6)])) == .target(.channel(7)))
    }

    @Test func rejectsMalformedSelidxPushes() {
        #expect(ConsoleDeskSelect(push: OSCMessage("/-stat/selidx", [])) == nil)
        #expect(ConsoleDeskSelect(push: OSCMessage("/-stat/selidx", [.int(1), .int(2)])) == nil)
        #expect(ConsoleDeskSelect(push: OSCMessage("/-stat/selidx", [.float(6)])) == nil)
        #expect(ConsoleDeskSelect(push: OSCMessage("/-stat/selidx", [.string("6")])) == nil)
        #expect(ConsoleDeskSelect(push: OSCMessage("/-stat/selidx", [.int(72)])) == nil)
    }

    @Test func rejectsForeignAddresses() {
        #expect(ConsoleDeskSelect(push: OSCMessage("/-stat/selidxx", [.int(6)])) == nil)
        #expect(ConsoleDeskSelect(push: OSCMessage("/ch/07/eq/1/g", [.float(0.5)])) == nil)
    }
}
