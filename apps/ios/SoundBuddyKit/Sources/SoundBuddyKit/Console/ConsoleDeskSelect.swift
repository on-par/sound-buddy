import Foundation

/// Maps the desk's `/-stat/selidx ,i N` push (sent via `/xremote`) to an
/// EQ target. Index table from the X32/M32 unofficial OSC doc: 0...31 =
/// Ch 1...32, 32...69 = aux in / FX returns / buses / matrices, 70 = Main
/// LR, 71 = Mono/Center. Read-only: we only ever listen to it.
public enum ConsoleDeskSelect: Equatable, Sendable {
    case target(ConsoleEQTarget)
    case unsupported

    public static let selidxAddress = "/-stat/selidx"
    static let channelIndexRange = 0...(ConsoleTargetCatalog.channelCount - 1)
    static let mainLRIndex = 70
    static let maxIndex = 71

    /// `nil` for indices outside the desk's 0...71 range.
    public static func target(selidx: Int) -> ConsoleDeskSelect? {
        guard (0...maxIndex).contains(selidx) else { return nil }
        if channelIndexRange.contains(selidx) {
            return .target(.channel(selidx + 1))
        }
        if selidx == mainLRIndex {
            return .target(.mainLR)
        }
        return .unsupported
    }

    /// `nil` unless the normalized reply address is exactly `/-stat/selidx`
    /// with one `.int` argument that `target(selidx:)` accepts.
    public init?(push message: OSCMessage) {
        guard OSCMessage.normalizedReplyAddress(message.address) == ConsoleDeskSelect.selidxAddress else { return nil }
        guard message.arguments.count == 1, case let .int(value) = message.arguments[0] else { return nil }
        guard let mapped = ConsoleDeskSelect.target(selidx: Int(value)) else { return nil }
        self = mapped
    }
}
