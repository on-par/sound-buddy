import Foundation

/// Errors `ConsoleEQWriteAllowlist` and `ConsoleEQWriter` throw. Every case
/// has an actionable `description` (ADR-0161): what went wrong and what to
/// do about it, not just the raw address.
public enum ConsoleEQWriteError: Error, Equatable, Sendable {
    /// `message.address` is not one of the writable EQ addresses at all.
    case notAllowlisted(String)
    /// `message.address` is a writable EQ address, but its argument count,
    /// type, or value is out of the allowed shape/range.
    case badArguments(String)
    /// The session is not armed (or was disarmed after the writer was
    /// obtained).
    case disarmed
    /// `target`'s EQ has never been read from the console, so there is
    /// nothing to revert to and no safe gesture-start baseline.
    case snapshotMissing(ConsoleEQTarget)
    /// `band` is outside `1...target.bandCount`.
    case bandOutOfRange(ConsoleEQTarget, Int)
}

extension ConsoleEQWriteError: CustomStringConvertible {
    public var description: String {
        switch self {
        case let .notAllowlisted(address):
            "\"\(address)\" is not an EQ address; the console writer only writes channel/Main LR EQ"
        case let .badArguments(address):
            "\"\(address)\" was sent an argument of the wrong type or an out-of-range value; check the value before sending"
        case .disarmed:
            "Arm the console session before editing EQ"
        case let .snapshotMissing(target):
            "Read \(target.eqPath)'s EQ from the console (/node) before the first write"
        case let .bandOutOfRange(target, band):
            "Band \(band) is out of range for \(target.eqPath); pick a band between 1 and \(target.bandCount)"
        }
    }
}

/// The exhaustive EQ-only write allowlist (ADR-0161 §1). `check` parses
/// `message.address` by splitting on `/` — never a loose prefix match — so
/// `/ch/010/eq/1/g` or `/ch/01/eq/1/gX` can never slip past a `hasPrefix`
/// check. Only `ConsoleEQWriter` calls `encode`; nothing else in
/// SoundBuddyKit has a path from an arbitrary `OSCMessage` to a byte that
/// bypasses this check.
public enum ConsoleEQWriteAllowlist {
    private enum Leaf: Equatable {
        case on
        case band
        case type
        case float
    }

    private static let channelPathWidth = 2

    /// Splits `address` into its console target and the path components
    /// after `<target>/eq`, or `nil` if `address` doesn't start with `/` or
    /// isn't rooted at a channel's or Main LR's EQ.
    private static func target(for address: String) -> (ConsoleEQTarget, [String])? {
        guard address.hasPrefix("/") else { return nil }
        let components = address.dropFirst().split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard components.allSatisfy({ !$0.isEmpty }) else { return nil }

        if components.count >= 3, components[0] == "ch", components[2] == "eq" {
            guard components[1].count == channelPathWidth,
                  let index = Int(components[1]),
                  (1...ConsoleTargetCatalog.channelCount).contains(index)
            else { return nil }
            return (.channel(index), Array(components.dropFirst(3)))
        }

        if components.count >= 3, components[0] == "main", components[1] == "st", components[2] == "eq" {
            return (.mainLR, Array(components.dropFirst(3)))
        }

        return nil
    }

    /// The expected argument shape for `tail` (the address path after
    /// `<target>/eq`), or `nil` if `tail` names no writable EQ leaf —
    /// including a band number out of `1...bandCount`.
    private static func leaf(_ tail: [String], bandCount: Int) -> Leaf? {
        switch tail.count {
        case 1:
            if tail[0] == "on" { return .on }
            if let band = Int(tail[0]), (1...bandCount).contains(band) { return .band }
            return nil
        case 2:
            guard let band = Int(tail[0]), (1...bandCount).contains(band) else { return nil }
            switch tail[1] {
            case "type": return .type
            case "f", "g", "q": return .float
            default: return nil
            }
        default:
            return nil
        }
    }

    private static func isUnitFloat(_ value: Float) -> Bool {
        value.isFinite && value >= 0 && value <= 1
    }

    private static func validate(_ shape: Leaf, arguments: [OSCArgument]) -> Bool {
        switch shape {
        case .on:
            guard arguments.count == 1, case let .int(value) = arguments[0] else { return false }
            return value == 0 || value == 1
        case .type:
            guard arguments.count == 1, case let .int(value) = arguments[0] else { return false }
            return ConsoleEQBandType(rawValue: Int(value)) != nil
        case .float:
            guard arguments.count == 1, case let .float(value) = arguments[0] else { return false }
            return isUnitFloat(value)
        case .band:
            guard arguments.count == 4,
                  case let .int(typeRaw) = arguments[0],
                  case let .float(freq) = arguments[1],
                  case let .float(gain) = arguments[2],
                  case let .float(q) = arguments[3]
            else { return false }
            return ConsoleEQBandType(rawValue: Int(typeRaw)) != nil
                && isUnitFloat(freq) && isUnitFloat(gain) && isUnitFloat(q)
        }
    }

    /// Throws unless `message` is one of the exhaustive, exact writable EQ
    /// addresses with the exact argument shape and in-range values a write
    /// must have (ADR-0161 §1). A query (no arguments) on an otherwise
    /// writable address is not a set, and is refused the same as any other
    /// non-allowlisted message.
    public static func check(_ message: OSCMessage) throws(ConsoleEQWriteError) {
        guard let (eqTarget, tail) = target(for: message.address) else {
            throw .notAllowlisted(message.address)
        }
        guard let shape = leaf(tail, bandCount: eqTarget.bandCount) else {
            throw .notAllowlisted(message.address)
        }
        guard !message.arguments.isEmpty else {
            throw .notAllowlisted(message.address)
        }
        guard validate(shape, arguments: message.arguments) else {
            throw .badArguments(message.address)
        }
    }

    /// `true` iff `check` would not throw — the "matches an EQ set address"
    /// predicate the read-path tests use.
    public static func isEQSet(_ message: OSCMessage) -> Bool {
        (try? check(message)) != nil
    }

    /// `check`, then the unguarded `OSCCodec.serialize` — reachable only
    /// after this allowlist has already accepted `message`.
    static func encode(_ message: OSCMessage) throws(ConsoleEQWriteError) -> Data {
        try check(message)
        return OSCCodec.serialize(message)
    }
}
