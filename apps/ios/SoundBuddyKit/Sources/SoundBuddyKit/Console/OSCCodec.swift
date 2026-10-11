import Foundation

/// Hand-rolled OSC 1.0 codec (`,i ,f ,s ,b`, big-endian, 4-byte padding),
/// byte-for-byte identical to packages/console/src/index.ts
/// (encodeOscMessage / decodeOscMessage). `encode` is the only serializer
/// reachable from outside this file, and it always runs
/// `ReadOnlyOSCGuard.check` before producing a single byte — there is no
/// unguarded path to a write (ADR-0060, ADR-0161 item 2). `decode` never
/// traps: every malformed input maps to a typed `OSCError`.
public enum OSCCodec {
    /// Largest datagram decode() will look at. The biggest read-path reply
    /// (a /meters push) is a few hundred bytes; anything past this is
    /// malformed or hostile.
    public static let maxPacketBytes = 16_384

    private static let pad4Modulus = 4

    private static func pad4(_ length: Int) -> Int {
        (pad4Modulus - (length % pad4Modulus)) % pad4Modulus
    }

    private static func int32BEBytes(_ value: Int32) -> [UInt8] {
        let bits = UInt32(bitPattern: value)
        return [
            UInt8((bits >> 24) & 0xff),
            UInt8((bits >> 16) & 0xff),
            UInt8((bits >> 8) & 0xff),
            UInt8(bits & 0xff),
        ]
    }

    private static func float32BEBytes(_ value: Float) -> [UInt8] {
        let bits = value.bitPattern
        return [
            UInt8((bits >> 24) & 0xff),
            UInt8((bits >> 16) & 0xff),
            UInt8((bits >> 8) & 0xff),
            UInt8(bits & 0xff),
        ]
    }

    private static func readInt32BE(_ bytes: [UInt8], at offset: Int) -> Int32 {
        let bits = UInt32(bytes[offset]) << 24
            | UInt32(bytes[offset + 1]) << 16
            | UInt32(bytes[offset + 2]) << 8
            | UInt32(bytes[offset + 3])
        return Int32(bitPattern: bits)
    }

    private static func readFloat32BE(_ bytes: [UInt8], at offset: Int) -> Float {
        let bits = UInt32(bytes[offset]) << 24
            | UInt32(bytes[offset + 1]) << 16
            | UInt32(bytes[offset + 2]) << 8
            | UInt32(bytes[offset + 3])
        return Float(bitPattern: bits)
    }

    private static func appendPaddedString(_ string: String, to out: inout [UInt8]) {
        let bytes = Array(string.utf8)
        out.append(contentsOf: bytes)
        out.append(0)
        out.append(contentsOf: repeatElement(0, count: pad4(bytes.count + 1)))
    }

    private static func appendArgument(_ argument: OSCArgument, to out: inout [UInt8]) {
        switch argument {
        case let .int(value):
            out.append(contentsOf: int32BEBytes(value))
        case let .float(value):
            out.append(contentsOf: float32BEBytes(value))
        case let .string(value):
            appendPaddedString(value, to: &out)
        case let .blob(data):
            out.append(contentsOf: int32BEBytes(Int32(data.count)))
            out.append(contentsOf: data)
            out.append(contentsOf: repeatElement(0, count: pad4(data.count)))
        }
    }

    /// Always guard-checks `message` before producing any byte: a guard
    /// throw propagates and no `Data` is returned.
    public static func encode(_ message: OSCMessage) throws(OSCError) -> Data {
        guard message.address.hasPrefix("/") else {
            throw .addressMustStartWithSlash(message.address)
        }
        try ReadOnlyOSCGuard.check(message)

        var out: [UInt8] = []
        appendPaddedString(message.address, to: &out)
        appendPaddedString(message.typeTags, to: &out)
        for argument in message.arguments {
            appendArgument(argument, to: &out)
        }
        return Data(out)
    }

    /// Scans for a NUL-terminated, 4-byte-padded string starting at
    /// `offset`. `offset` may already be past the end of `bytes` (a prior
    /// segment's padded length can overrun a truncated buffer) — the bounds
    /// check below is safe in that case too, since the scan loop never
    /// indexes past `bytes.count`.
    private static func readPaddedString(
        _ bytes: [UInt8],
        at offset: Int
    ) throws(OSCError) -> (value: String, nextOffset: Int) {
        var end = offset
        while end < bytes.count && bytes[end] != 0 {
            end += 1
        }
        if end >= bytes.count {
            throw .unterminatedString(offset: offset)
        }
        guard let value = String(bytes: bytes[offset..<end], encoding: .utf8) else {
            throw .invalidUTF8(offset: offset)
        }
        let segmentLength = end - offset + 1
        return (value, offset + segmentLength + pad4(segmentLength))
    }

    /// Decodes `packet` defensively: bounded size, strict tag/length checks,
    /// never a crash — every malformed shape returns a specific `OSCError`.
    public static func decode(_ packet: Data) throws(OSCError) -> OSCMessage {
        let bytes = Array(packet)
        if bytes.isEmpty {
            throw .emptyPacket
        }
        if bytes.count > maxPacketBytes {
            throw .packetTooLarge(size: bytes.count, limit: maxPacketBytes)
        }

        let addressResult = try readPaddedString(bytes, at: 0)
        let address = addressResult.value

        let tagResult = try readPaddedString(bytes, at: addressResult.nextOffset)
        guard tagResult.value.hasPrefix(",") else {
            throw .typeTagsMissingComma(tagResult.value)
        }
        let tags = tagResult.value.dropFirst()

        var arguments: [OSCArgument] = []
        var offset = tagResult.nextOffset

        for tag in tags {
            switch tag {
            case "f":
                guard offset + 4 <= bytes.count else {
                    throw .truncated(address: address, offset: offset, needed: 4, available: bytes.count - offset)
                }
                arguments.append(.float(readFloat32BE(bytes, at: offset)))
                offset += 4
            case "i":
                guard offset + 4 <= bytes.count else {
                    throw .truncated(address: address, offset: offset, needed: 4, available: bytes.count - offset)
                }
                arguments.append(.int(readInt32BE(bytes, at: offset)))
                offset += 4
            case "s":
                let result = try readPaddedString(bytes, at: offset)
                arguments.append(.string(result.value))
                offset = result.nextOffset
            case "b":
                guard offset + 4 <= bytes.count else {
                    throw .truncated(address: address, offset: offset, needed: 4, available: bytes.count - offset)
                }
                let size = readInt32BE(bytes, at: offset)
                offset += 4
                guard size >= 0 else {
                    throw .negativeBlobSize(size, address: address)
                }
                let byteCount = Int(size)
                guard offset + byteCount <= bytes.count else {
                    throw .truncated(address: address, offset: offset, needed: byteCount, available: bytes.count - offset)
                }
                arguments.append(.blob(Data(bytes[offset..<(offset + byteCount)])))
                offset += byteCount + pad4(byteCount)
            default:
                throw .unknownTypeTag(tag, address: address)
            }
        }

        return OSCMessage(address, arguments)
    }
}
