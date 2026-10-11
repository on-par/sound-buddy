import Foundation
import Testing
@testable import SoundBuddyKit

// MARK: - Shared OSC parity fixture loading
//
// packages/console/src/osc-parity-fixtures.json is the single source of
// truth for byte-exact parity between this codec and
// packages/console/src/index.ts; index.test.ts asserts against the same
// file. These helpers are `internal` (default access) so OSCRepliesTests
// and ReadOnlyOSCGuardTests can reuse them without a second copy.

enum OSCFixtureArgValue: Decodable {
    case number(Double)
    case string(String)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Double.self) {
            self = .number(number)
        } else {
            self = .string(try container.decode(String.self))
        }
    }
}

struct OSCFixtureArg: Decodable {
    let type: String
    let value: OSCFixtureArgValue
}

struct OSCEncodeFixture: Decodable {
    let name: String
    let address: String
    let args: [OSCFixtureArg]
    let hex: String
}

struct OSCDecodeFixture: Decodable {
    let name: String
    let hex: String
    let address: String
    let args: [OSCFixtureArg]
}

struct OSCParityFixtures: Decodable {
    let encode: [OSCEncodeFixture]
    let decode: [OSCDecodeFixture]
}

func loadOSCParityFixtures() throws -> OSCParityFixtures {
    let data = try Data(contentsOf: TestPaths.oscParityFixtures)
    return try JSONDecoder().decode(OSCParityFixtures.self, from: data)
}

func dataFromHex(_ hex: String) -> Data {
    var data = Data()
    var index = hex.startIndex
    while index < hex.endIndex {
        let next = hex.index(index, offsetBy: 2)
        data.append(UInt8(hex[index..<next], radix: 16)!)
        index = next
    }
    return data
}

func hexString(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

func toOSCArgument(_ arg: OSCFixtureArg) -> OSCArgument {
    switch (arg.type, arg.value) {
    case let ("i", .number(n)):
        return .int(Int32(n))
    case let ("f", .number(n)):
        return .float(Float(n))
    case let ("s", .string(s)):
        return .string(s)
    case let ("b", .string(hex)):
        return .blob(dataFromHex(hex))
    default:
        fatalError("unsupported fixture arg \(arg.type)/\(arg.value)")
    }
}

func decodeFixture(named name: String, in fixtures: [OSCDecodeFixture]) throws -> OSCDecodeFixture {
    guard let fixture = fixtures.first(where: { $0.name == name }) else {
        struct MissingFixture: Error {}
        throw MissingFixture()
    }
    return fixture
}

// MARK: - Malformed packet table

struct MalformedPacketCase: Sendable, CustomStringConvertible {
    let name: String
    let bytes: [UInt8]
    let expectedError: OSCError
    var description: String { name }
}

let malformedPacketCases: [MalformedPacketCase] = [
    .init(name: "empty", bytes: [], expectedError: .emptyPacket),
    .init(
        name: "unknown-tag",
        bytes: [0x2f, 0x78, 0x00, 0x00, 0x2c, 0x71, 0x00, 0x00],
        expectedError: .unknownTypeTag("q", address: "/x")
    ),
    .init(
        name: "missing-comma",
        bytes: [0x2f, 0x78, 0x00, 0x00, 0x73, 0x69, 0x00, 0x00],
        expectedError: .typeTagsMissingComma("si")
    ),
    .init(
        name: "truncated-int",
        bytes: [0x2f, 0x78, 0x00, 0x00, 0x2c, 0x69, 0x00, 0x00, 0x00, 0x01],
        expectedError: .truncated(address: "/x", offset: 8, needed: 4, available: 2)
    ),
    .init(
        name: "truncated-float",
        bytes: [0x2f, 0x78, 0x00, 0x00, 0x2c, 0x66, 0x00, 0x00, 0x3f, 0x80],
        expectedError: .truncated(address: "/x", offset: 8, needed: 4, available: 2)
    ),
    .init(
        name: "truncated-blob-size",
        bytes: [0x2f, 0x78, 0x00, 0x00, 0x2c, 0x62, 0x00, 0x00, 0x00, 0x01],
        expectedError: .truncated(address: "/x", offset: 8, needed: 4, available: 2)
    ),
    .init(
        name: "blob-overrun",
        bytes: [0x2f, 0x78, 0x00, 0x00, 0x2c, 0x62, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10],
        expectedError: .truncated(address: "/x", offset: 12, needed: 16, available: 0)
    ),
    .init(
        name: "negative-blob-size",
        bytes: [0x2f, 0x78, 0x00, 0x00, 0x2c, 0x62, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff],
        expectedError: .negativeBlobSize(-1, address: "/x")
    ),
    .init(
        name: "address-no-terminator",
        bytes: [0x2f, 0x6d, 0x65],
        expectedError: .unterminatedString(offset: 0)
    ),
    .init(
        name: "string-arg-no-terminator",
        bytes: [0x2f, 0x78, 0x00, 0x00, 0x2c, 0x73, 0x00, 0x00, 0x61, 0x62, 0x63],
        expectedError: .unterminatedString(offset: 8)
    ),
    .init(
        name: "invalid-utf8-address",
        bytes: [0xc3, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00],
        expectedError: .invalidUTF8(offset: 0)
    ),
    .init(
        name: "oversized",
        bytes: Array(repeating: 0, count: OSCCodec.maxPacketBytes + 1),
        expectedError: .packetTooLarge(size: OSCCodec.maxPacketBytes + 1, limit: OSCCodec.maxPacketBytes)
    ),
]

@Suite struct OSCCodecTests {
    @Test func encodesSharedParityFixturesByteExact() throws {
        let fixtures = try loadOSCParityFixtures()
        for fixture in fixtures.encode {
            let message = OSCMessage(fixture.address, fixture.args.map(toOSCArgument))
            let bytes = try OSCCodec.encode(message)
            #expect(hexString(bytes) == fixture.hex, "\(fixture.name)")
        }
    }

    @Test func decodesSharedParityFixtures() throws {
        let fixtures = try loadOSCParityFixtures()
        for fixture in fixtures.decode {
            let decoded = try OSCCodec.decode(dataFromHex(fixture.hex))
            #expect(decoded.address == fixture.address, "\(fixture.name)")
            #expect(decoded.arguments == fixture.args.map(toOSCArgument), "\(fixture.name)")
        }
    }

    @Test func encodeDecodeRoundTripsAllTags() throws {
        let message = OSCMessage("/node", [
            .float(1.5), .int(-42), .string("hello"), .blob(Data([1, 2, 3, 4, 5])),
        ])
        let decoded = try OSCCodec.decode(try OSCCodec.encode(message))
        #expect(decoded.address == "/node")
        #expect(decoded.typeTags == ",fisb")
        #expect(decoded.arguments == message.arguments)
    }

    @Test func floatPrecisionWithinEpsilon() throws {
        let decoded = try OSCCodec.decode(try OSCCodec.encode(OSCMessage("/meters", [.float(0.1)])))
        guard case let .float(value) = decoded.arguments[0] else {
            Issue.record("expected a float argument")
            return
        }
        #expect(abs(value - 0.1) < 1e-7)
    }

    @Test func emptyArgsEncodeBareComma() throws {
        let decoded = try OSCCodec.decode(try OSCCodec.encode(OSCMessage("/x", [])))
        #expect(decoded.typeTags == ",")
        #expect(decoded.arguments.isEmpty)
    }

    @Test func noOverPadding() throws {
        let abc = try OSCCodec.encode(OSCMessage("/meters", [.string("abc")]))
        #expect(abc.count == 16)
        #expect(hexString(abc.suffix(4)) == "61626300")

        let abcd = try OSCCodec.encode(OSCMessage("/node", [.string("abcd")]))
        #expect(abcd.count == 20)
        #expect(hexString(abcd.suffix(8)) == "6162636400000000")
    }

    @Test func rejectsAddressWithoutSlash() {
        do {
            _ = try OSCCodec.encode(OSCMessage("meters", []))
            Issue.record("expected addressMustStartWithSlash")
        } catch let error {
            #expect(error == .addressMustStartWithSlash("meters"))
        }
    }

    @Test(arguments: malformedPacketCases)
    func malformedPacketsReturnTypedErrors(_ testCase: MalformedPacketCase) {
        do {
            _ = try OSCCodec.decode(Data(testCase.bytes))
            Issue.record("expected \(testCase.expectedError) for \(testCase.name)")
        } catch let error {
            #expect(error == testCase.expectedError, "\(testCase.name)")
        }
    }

    @Test func everyTruncationOfEveryFixtureIsSafe() throws {
        let fixtures = try loadOSCParityFixtures()
        let allHex = fixtures.encode.map(\.hex) + fixtures.decode.map(\.hex)
        for hex in allHex {
            let bytes = dataFromHex(hex)
            for length in 0...bytes.count {
                // Typed throws statically guarantees only OSCError can
                // propagate; this is really a "never traps" assertion.
                _ = try? OSCCodec.decode(bytes.prefix(length))
            }
        }
    }

    @Test func randomPacketsNeverTrap() {
        var state: UInt64 = 0x2545_F491_4F6C_DD1D
        func nextByte() -> UInt8 {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return UInt8((state >> 56) & 0xff)
        }
        for _ in 0..<500 {
            let length = Int(nextByte()) % 65
            var bytes: [UInt8] = []
            for _ in 0..<length {
                bytes.append(nextByte())
            }
            _ = try? OSCCodec.decode(Data(bytes))
        }
    }
}
