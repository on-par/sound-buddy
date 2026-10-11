import Foundation

/// Port of parseXInfoReply (app/electron/ipc/console-discovery.ts): an
/// `/xinfo` reply with exactly four string arguments, in order
/// ip/name/model/firmware.
public struct ConsoleXInfo: Equatable, Sendable {
    public let ip: String
    public let name: String
    public let model: String
    public let firmware: String

    public init?(reply message: OSCMessage) {
        guard message.replyAddressMatches("/xinfo") else { return nil }
        guard message.arguments.count == 4 else { return nil }
        var values: [String] = []
        for argument in message.arguments {
            guard case let .string(value) = argument else { return nil }
            values.append(value)
        }
        ip = values[0]
        name = values[1]
        model = values[2]
        firmware = values[3]
    }
}

extension OSCMessage {
    /// Port of parseNodeReplyLine (packages/console/src/scene-capture.ts):
    /// trims trailing whitespace/newlines and returns the line only when its
    /// first whitespace-delimited token normalizes to `expectedPath`.
    public func nodeReplyLine(expectedPath: String) -> String? {
        guard replyAddressMatches("/node") else { return nil }
        guard arguments.count == 1, case let .string(value) = arguments[0] else { return nil }

        var line = value
        while let last = line.last, last.isWhitespace {
            line.removeLast()
        }
        let firstToken = String(line.prefix { !$0.isWhitespace })
        guard OSCMessage.normalizedReplyAddress(firstToken) == OSCMessage.normalizedReplyAddress(expectedPath) else {
            return nil
        }
        return line
    }
}

/// Port of packages/console/src/meters.ts. One decoded /meters/1 frame.
/// Values are linear and unscaled, exactly as the console reports them:
/// 0.0...1.0 where 1.0 is digital full scale, rising to about 8.0
/// (~ +18 dBFS) with headroom. Conversion to dB is the caller's job.
public struct Meters1Snapshot: Equatable, Sendable {
    public static let meters1Address = "/meters/1"
    public static let bandSize = 32 // channels per band
    public static let bandCount = 3 // input level, gate GR, dynamics GR
    public static let valueCount = bandSize * bandCount // 96
    public static let blobBytes = 4 + valueCount * 4 // 388

    /// 32 input levels, channels 1..32 in order.
    public let inputs: [Float]
    /// 32 gate gain-reduction values, channels 1..32 in order.
    public let gateGainReduction: [Float]
    /// 32 dynamics (compressor) gain-reduction values, channels 1..32 in order.
    public let dynamicsGainReduction: [Float]

    private static func readInt32LE(_ bytes: [UInt8], at offset: Int) -> Int32 {
        let bits = UInt32(bytes[offset])
            | UInt32(bytes[offset + 1]) << 8
            | UInt32(bytes[offset + 2]) << 16
            | UInt32(bytes[offset + 3]) << 24
        return Int32(bitPattern: bits)
    }

    private static func readFloat32LE(_ bytes: [UInt8], at offset: Int) -> Float {
        let bits = UInt32(bytes[offset])
            | UInt32(bytes[offset + 1]) << 8
            | UInt32(bytes[offset + 2]) << 16
            | UInt32(bytes[offset + 3]) << 24
        return Float(bitPattern: bits)
    }

    /// Generic little-endian meter blob reader: a 4-byte little-endian int32
    /// count followed by `count` little-endian float32 values. The M32R's
    /// meter blob interior is little-endian, unlike every other value in
    /// this protocol (which is big-endian throughout — see OSCCodec).
    public static func decodeMeterBlob(_ blob: Data) throws(OSCError) -> [Float] {
        let countFieldBytes = 4
        let floatBytes = 4
        guard blob.count >= countFieldBytes else {
            throw .malformedMeterBlob(
                "blob is \(blob.count) bytes, too short for the 4-byte little-endian count field a meter blob must start with"
            )
        }

        let bytes = Array(blob)
        let count = readInt32LE(bytes, at: 0)
        guard count >= 0 else {
            throw .malformedMeterBlob(
                "blob declares a negative count (\(count)); this usually means the count field was read big-endian instead of the little-endian this console's meter blobs use"
            )
        }

        let expectedBytes = countFieldBytes + Int(count) * floatBytes
        guard bytes.count == expectedBytes else {
            throw .malformedMeterBlob(
                "blob declares count \(count) (expects \(expectedBytes) little-endian bytes) but is \(bytes.count) bytes; check for a truncated frame or a little-endian/big-endian mismatch"
            )
        }

        var values: [Float] = []
        values.reserveCapacity(Int(count))
        for index in 0..<Int(count) {
            values.append(readFloat32LE(bytes, at: countFieldBytes + index * floatBytes))
        }
        return values
    }

    /// Decodes a raw meter blob into its typed 32/32/32 band snapshot.
    public init(blob: Data) throws(OSCError) {
        let values = try Meters1Snapshot.decodeMeterBlob(blob)
        guard values.count == Meters1Snapshot.valueCount else {
            throw .malformedMeterBlob(
                "\(Meters1Snapshot.meters1Address) frame must decode to exactly \(Meters1Snapshot.valueCount) values (\(Meters1Snapshot.blobBytes) bytes); got \(values.count) values (\(blob.count) bytes) — this does not look like a \(Meters1Snapshot.meters1Address) frame"
            )
        }
        inputs = Array(values[0..<Meters1Snapshot.bandSize])
        gateGainReduction = Array(values[Meters1Snapshot.bandSize..<(Meters1Snapshot.bandSize * 2)])
        dynamicsGainReduction = Array(values[(Meters1Snapshot.bandSize * 2)..<(Meters1Snapshot.bandSize * 3)])
    }

    /// Extracts and decodes a /meters/1 snapshot from an already-decoded OSC
    /// push message, after normalizing the reply address (replies may or
    /// may not carry a leading slash) and validating the blob argument.
    public init(message: OSCMessage) throws(OSCError) {
        let normalized = OSCMessage.normalizedReplyAddress(message.address)
        guard normalized == Meters1Snapshot.meters1Address else {
            throw .notMeters1Reply(message.address)
        }
        guard let first = message.arguments.first, case let .blob(data) = first else {
            throw .malformedMeterBlob(
                "a \(Meters1Snapshot.meters1Address) push must carry a single blob ('b') argument; got type tags \"\(message.typeTags)\""
            )
        }
        try self.init(blob: data)
    }
}
