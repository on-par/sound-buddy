import Foundation
import Testing
@testable import SoundBuddyKit

/// Every writable EQ address, with a valid argument shape, for every
/// channel (1...32) and Main LR — `on`, each band's `type`/`f`/`g`/`q`
/// leaves, and each band's combined `,ifff` set.
private func validLeafMessages(for target: ConsoleEQTarget) -> [OSCMessage] {
    var messages: [OSCMessage] = []
    for band in 1...target.bandCount {
        messages.append(OSCMessage("\(target.eqPath)/\(band)/type", [.int(2)]))
        messages.append(OSCMessage("\(target.eqPath)/\(band)/f", [.float(0.5)]))
        messages.append(OSCMessage("\(target.eqPath)/\(band)/g", [.float(0.5)]))
        messages.append(OSCMessage("\(target.eqPath)/\(band)/q", [.float(0.5)]))
        messages.append(OSCMessage("\(target.eqPath)/\(band)", [.int(2), .float(0.5), .float(0.5), .float(0.5)]))
    }
    messages.append(OSCMessage("\(target.eqPath)/on", [.int(1)]))
    return messages
}

private let allWritableEQMessages: [OSCMessage] = ConsoleTargetCatalog.targets.flatMap(validLeafMessages)

/// Every address the allowlist must refuse with `.notAllowlisted`: wrong
/// root, out-of-range channel/band, unpadded index, unknown leaf, extra path
/// component, non-EQ write/action addresses, and a query (no arguments) on
/// an otherwise-writable EQ address.
private let nonEQAddressCases: [OSCMessage] = [
    OSCMessage("", [.float(0.5)]),
    OSCMessage("ch/01/eq/1/g", [.float(0.5)]),
    OSCMessage("/ch/00/eq/1/g", [.float(0.5)]),
    OSCMessage("/ch/33/eq/1/g", [.float(0.5)]),
    OSCMessage("/ch/1/eq/1/g", [.float(0.5)]),
    OSCMessage("/ch/01/eq/5/g", [.float(0.5)]),
    OSCMessage("/main/st/eq/7/g", [.float(0.5)]),
    OSCMessage("/main/st/eq/0/g", [.float(0.5)]),
    OSCMessage("/ch/01/eq/1/x", [.float(0.5)]),
    OSCMessage("/ch/01/eq/1/g/extra", [.float(0.5)]),
    OSCMessage("/ch/01/eq", [.int(1)]),
    OSCMessage("/ch/01/mix/fader", [.float(0.5)]),
    OSCMessage("/ch/01/preamp/hpf", [.float(0.5)]),
    OSCMessage("/main/st/mix/fader", [.float(0.5)]),
    OSCMessage("/-action/undopt", [.int(1)]),
    OSCMessage("/-undo", [.int(1)]),
    OSCMessage("/save", [.int(1)]),
    OSCMessage("/node", [.string("ch/01/mix")]),
    OSCMessage("/ch/01/eq/1/g", []),
]

@Suite struct ConsoleEQWriteAllowlistTests {
    @Test(arguments: allWritableEQMessages)
    func acceptsEveryWritableEQAddress(_ message: OSCMessage) throws {
        try ConsoleEQWriteAllowlist.check(message)
        #expect(ConsoleEQWriteAllowlist.isEQSet(message))
    }

    @Test(arguments: nonEQAddressCases)
    func rejectsNonEQAddresses(_ message: OSCMessage) {
        do {
            try ConsoleEQWriteAllowlist.check(message)
            Issue.record("expected .notAllowlisted for \"\(message.address)\"")
        } catch {
            #expect(error == .notAllowlisted(message.address), "\(message.address)")
            #expect(!ConsoleEQWriteAllowlist.isEQSet(message))
        }
    }

    @Test func rejectsBadArgumentShapes() {
        let wrongTag = OSCMessage("/ch/01/eq/1/g", [.int(1)])
        let outOfRangeType = OSCMessage("/ch/01/eq/1/type", [.int(6)])
        let outOfRangeFloat = OSCMessage("/ch/01/eq/1/g", [.float(1.5)])
        let nanFloat = OSCMessage("/ch/01/eq/1/f", [.float(.nan)])
        let onOutOfRange = OSCMessage("/main/st/eq/on", [.int(2)])
        let wrongBandArgCount = OSCMessage("/main/st/eq/1", [.int(2), .float(0.5), .float(0.5)])

        for message in [wrongTag, outOfRangeType, outOfRangeFloat, nanFloat, onOutOfRange, wrongBandArgCount] {
            do {
                try ConsoleEQWriteAllowlist.check(message)
                Issue.record("expected .badArguments for \"\(message.address)\"")
            } catch {
                #expect(error == .badArguments(message.address), "\(message.address)")
                #expect(!ConsoleEQWriteAllowlist.isEQSet(message))
            }
        }
    }

    @Test(arguments: allWritableEQMessages)
    func readEncoderRefusesEveryWritableEQAddress(_ message: OSCMessage) {
        do {
            _ = try OSCCodec.encode(message)
            Issue.record("expected OSCCodec.encode to refuse \"\(message.address)\"")
        } catch {
            // Expected: the read path stays unable to write any EQ set.
        }
    }

    @Test func errorDescriptionsAreActionable() {
        let notAllowlisted = ConsoleEQWriteError.notAllowlisted("/ch/01/mix/fader")
        let badArguments = ConsoleEQWriteError.badArguments("/ch/01/eq/1/g")
        let disarmed = ConsoleEQWriteError.disarmed
        let snapshotMissing = ConsoleEQWriteError.snapshotMissing(.mainLR)
        let bandOutOfRange = ConsoleEQWriteError.bandOutOfRange(.channel(1), 9)

        for error in [notAllowlisted, badArguments, disarmed, snapshotMissing, bandOutOfRange] {
            #expect(!error.description.isEmpty)
        }
        #expect(disarmed.description.contains("Arm"))
        #expect(snapshotMissing.description.contains("Read"))
        #expect(bandOutOfRange.description.contains("Band"))
    }
}
