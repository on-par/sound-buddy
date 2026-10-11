import Foundation

/// One OSC 1.0 argument. Mirrors `OscArg` in packages/console/src/index.ts —
/// `int`/`float` are 32-bit big-endian, `string` is NUL-terminated and
/// 4-byte padded, `blob` is a big-endian int32 length prefix followed by the
/// bytes and 4-byte padding.
public enum OSCArgument: Equatable, Sendable {
    case int(Int32)
    case float(Float)
    case string(String)
    case blob(Data)

    public var typeTag: Character {
        switch self {
        case .int: "i"
        case .float: "f"
        case .string: "s"
        case .blob: "b"
        }
    }
}

/// One OSC message: an address plus its arguments. Mirrors `OscMessage` in
/// packages/console/src/index.ts.
public struct OSCMessage: Equatable, Sendable {
    public var address: String
    public var arguments: [OSCArgument]

    public init(_ address: String, _ arguments: [OSCArgument] = []) {
        self.address = address
        self.arguments = arguments
    }

    public var typeTags: String {
        "," + String(arguments.map(\.typeTag))
    }

    /// Port of address.ts normalizeReplyAddress: prefix "/" when missing.
    public static func normalizedReplyAddress(_ address: String) -> String {
        address.hasPrefix("/") ? address : "/" + address
    }

    /// Port of address.ts replyAddressMatches.
    public func replyAddressMatches(_ requestAddress: String) -> Bool {
        OSCMessage.normalizedReplyAddress(requestAddress) == OSCMessage.normalizedReplyAddress(address)
    }
}

/// Typed errors for OSC encoding, decoding and reply parsing. `description`
/// mirrors the OscError messages thrown by packages/console/src/index.ts and
/// read-only-guard.ts so the two implementations stay legible side by side.
public enum OSCError: Error, Equatable, Sendable {
    // encode
    case addressMustStartWithSlash(String)
    case refusedWriteAddress(String)
    case notAllowlistedWithArguments(String)
    case refusedNodeArgument(String)
    // decode
    case packetTooLarge(size: Int, limit: Int)
    case emptyPacket
    case unterminatedString(offset: Int)
    case invalidUTF8(offset: Int)
    case typeTagsMissingComma(String)
    case unknownTypeTag(Character, address: String)
    case truncated(address: String, offset: Int, needed: Int, available: Int)
    case negativeBlobSize(Int32, address: String)
    // replies
    case malformedMeterBlob(String)
    case notMeters1Reply(String)
}

extension OSCError: CustomStringConvertible {
    public var description: String {
        switch self {
        case let .addressMustStartWithSlash(address):
            "OSC message address must start with '/': got \"\(address)\""
        case let .refusedWriteAddress(address):
            "OSC address \"\(address)\" is a write/mutation address and is refused by the read-only guardrail"
        case let .notAllowlistedWithArguments(address):
            "OSC address \"\(address)\" is not on the read-only allowlist for messages with arguments"
        case let .refusedNodeArgument(value):
            "OSC /node argument \"\(value)\" references a write/mutation namespace and is refused by the read-only guardrail"
        case let .packetTooLarge(size, limit):
            "OSC packet is \(size) bytes, which exceeds the \(limit)-byte limit; check the sender is not mis-configured"
        case .emptyPacket:
            "OSC packet is empty; nothing to decode"
        case let .unterminatedString(offset):
            "truncated OSC string: no NUL terminator found before end of packet (offset \(offset))"
        case let .invalidUTF8(offset):
            "OSC string at offset \(offset) is not valid UTF-8"
        case let .typeTagsMissingComma(tags):
            "OSC type-tag string must start with ',': got \"\(tags)\""
        case let .unknownTypeTag(tag, address):
            "unknown OSC type tag '\(tag)' in message \(address); supported tags are f, i, s, b"
        case let .truncated(address, offset, needed, available):
            "truncated OSC message: arg for \(address) needs \(needed) bytes at offset \(offset), packet has \(available) bytes available"
        case let .negativeBlobSize(size, address):
            "OSC message \(address) declares a negative blob size (\(size)); the packet is malformed"
        case let .malformedMeterBlob(detail):
            "malformed meter blob: \(detail)"
        case let .notMeters1Reply(address):
            "expected a /meters/1 reply but got \"\(address)\""
        }
    }
}
