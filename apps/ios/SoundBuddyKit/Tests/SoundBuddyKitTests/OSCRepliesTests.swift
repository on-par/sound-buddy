import Foundation
import Testing
@testable import SoundBuddyKit

private func littleEndianInt32Bytes(_ value: Int32) -> [UInt8] {
    let bits = UInt32(bitPattern: value)
    return [UInt8(bits & 0xff), UInt8((bits >> 8) & 0xff), UInt8((bits >> 16) & 0xff), UInt8((bits >> 24) & 0xff)]
}

private func littleEndianFloatBytes(_ value: Float) -> [UInt8] {
    let bits = value.bitPattern
    return [UInt8(bits & 0xff), UInt8((bits >> 8) & 0xff), UInt8((bits >> 16) & 0xff), UInt8((bits >> 24) & 0xff)]
}

@Suite struct OSCRepliesTests {
    @Test func decodesXInfoReplyFixture() throws {
        let fixtures = try loadOSCParityFixtures()
        let fixture = try decodeFixture(named: "xinfo-reply", in: fixtures.decode)
        let message = try OSCCodec.decode(dataFromHex(fixture.hex))

        let info = ConsoleXInfo(reply: message)
        #expect(info?.ip == "192.168.1.77")
        #expect(info?.name == "FOH")
        #expect(info?.model == "M32R")
        #expect(info?.firmware == "4.02")
    }

    @Test func xinfoAcceptsReplyWithoutLeadingSlash() {
        let message = OSCMessage("xinfo", [.string("1.2.3.4"), .string("FOH"), .string("M32R"), .string("4.02")])
        #expect(ConsoleXInfo(reply: message) != nil)
    }

    @Test func xinfoRejectsWrongShapeOrAddress() {
        #expect(ConsoleXInfo(reply: OSCMessage("/xinfo", [.string("a"), .string("b"), .string("c")])) == nil)
        #expect(
            ConsoleXInfo(reply: OSCMessage("/xinfo", [.string("a"), .string("b"), .string("c"), .int(1)])) == nil
        )
        #expect(
            ConsoleXInfo(reply: OSCMessage("/info", [.string("a"), .string("b"), .string("c"), .string("d")])) == nil
        )
    }

    @Test func nodeReplyLineMatchesExpectedPath() throws {
        let fixtures = try loadOSCParityFixtures()
        let fixture = try decodeFixture(named: "node-reply-no-leading-slash", in: fixtures.decode)
        let message = try OSCCodec.decode(dataFromHex(fixture.hex))
        let expectedLine = "/ch/01/eq/1 PEQ 1k000 +0.0 2.0"

        #expect(message.nodeReplyLine(expectedPath: "/ch/01/eq/1") == expectedLine)
        #expect(message.nodeReplyLine(expectedPath: "ch/01/eq/1") == expectedLine)
        #expect(message.nodeReplyLine(expectedPath: "/ch/01/eq/2") == nil)
    }

    @Test func nodeReplyLineRejectsWrongShapeOrAddress() {
        #expect(OSCMessage("/status", [.string("/ch/01/eq/1 text")]).nodeReplyLine(expectedPath: "/ch/01/eq/1") == nil)
        #expect(OSCMessage("/node", []).nodeReplyLine(expectedPath: "/ch/01/eq/1") == nil)
        #expect(
            OSCMessage("/node", [.string("a"), .string("b")]).nodeReplyLine(expectedPath: "/ch/01/eq/1") == nil
        )
        #expect(OSCMessage("/node", [.int(1)]).nodeReplyLine(expectedPath: "/ch/01/eq/1") == nil)
    }

    @Test func meters1DecodesFixtureBlob() throws {
        let fixtures = try loadOSCParityFixtures()
        let fixture = try decodeFixture(named: "meters-1-push", in: fixtures.decode)
        let message = try OSCCodec.decode(dataFromHex(fixture.hex))

        let snapshot = try Meters1Snapshot(message: message)
        #expect(snapshot.inputs.count == 32)
        #expect(snapshot.gateGainReduction.count == 32)
        #expect(snapshot.dynamicsGainReduction.count == 32)
        #expect(abs(snapshot.inputs[0] - 0.0) < 1e-5)
        #expect(abs(snapshot.gateGainReduction[0] - 0.32) < 1e-5)
        #expect(abs(snapshot.dynamicsGainReduction[31] - 0.95) < 1e-5)
    }

    @Test func meters1DecodesLittleEndianVectorDirectly() throws {
        var bytes = littleEndianInt32Bytes(2)
        bytes.append(contentsOf: littleEndianFloatBytes(1.0))
        bytes.append(contentsOf: littleEndianFloatBytes(0.5))
        let values = try Meters1Snapshot.decodeMeterBlob(Data(bytes))
        #expect(values == [1.0, 0.5])
    }

    @Test func meters1HeadroomIsUnclamped() throws {
        var bytes = littleEndianInt32Bytes(1)
        bytes.append(contentsOf: littleEndianFloatBytes(8.0))
        let values = try Meters1Snapshot.decodeMeterBlob(Data(bytes))
        #expect(values == [8.0])
    }

    @Test func meters1ErrorsForTooShortBlob() {
        #expect(throws: OSCError.self) {
            try Meters1Snapshot.decodeMeterBlob(Data([0, 0, 0]))
        }
    }

    @Test func meters1ErrorsForNegativeCount() {
        #expect(throws: OSCError.self) {
            try Meters1Snapshot.decodeMeterBlob(Data(littleEndianInt32Bytes(-1)))
        }
    }

    @Test func meters1ErrorsForCountLengthMismatch() {
        var bytes = littleEndianInt32Bytes(2)
        bytes.append(contentsOf: littleEndianFloatBytes(1.0))
        #expect(throws: OSCError.self) {
            try Meters1Snapshot.decodeMeterBlob(Data(bytes))
        }
    }

    @Test func meters1ErrorsWhenValueCountIsNot96() {
        var bytes = littleEndianInt32Bytes(1)
        bytes.append(contentsOf: littleEndianFloatBytes(1.0))
        #expect(throws: OSCError.self) {
            try Meters1Snapshot(blob: Data(bytes))
        }
    }

    @Test func meters1ErrorsForWrongAddress() {
        #expect(throws: OSCError.self) {
            try Meters1Snapshot(message: OSCMessage("/meters/2", [.blob(Data())]))
        }
    }

    @Test func meters1ErrorsForMissingOrNonBlobArgument() {
        #expect(throws: OSCError.self) {
            try Meters1Snapshot(message: OSCMessage("/meters/1", []))
        }
        #expect(throws: OSCError.self) {
            try Meters1Snapshot(message: OSCMessage("/meters/1", [.int(1)]))
        }
    }
}
