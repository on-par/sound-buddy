import Foundation

/// The X32/M32 scribble-strip color enum, `/ch/[01..32]/config/color` int
/// [0..15] (Behringer X32/M32 unofficial OSC protocol doc, Patrick-Gilles
/// Maillot): OFF RD GN YE BL MG CY WH, then the same eight inverted. Token
/// order mirrors the desk's own enum order.
public enum ConsoleChannelColor: String, CaseIterable, Equatable, Sendable {
    case off = "OFF"
    case red = "RD"
    case green = "GN"
    case yellow = "YE"
    case blue = "BL"
    case magenta = "MG"
    case cyan = "CY"
    case white = "WH"
    case offInverted = "OFFi"
    case redInverted = "RDi"
    case greenInverted = "GNi"
    case yellowInverted = "YEi"
    case blueInverted = "BLi"
    case magentaInverted = "MGi"
    case cyanInverted = "CYi"
    case whiteInverted = "WHi"

    /// Exact, case-sensitive match on the `/node` token; `nil` for anything
    /// else.
    public init?(nodeToken: String) {
        self.init(rawValue: nodeToken)
    }

    public var isInverted: Bool {
        switch self {
        case .offInverted, .redInverted, .greenInverted, .yellowInverted,
             .blueInverted, .magentaInverted, .cyanInverted, .whiteInverted:
            return true
        case .off, .red, .green, .yellow, .blue, .magenta, .cyan, .white:
            return false
        }
    }

    /// The non-inverted hue — the view draws inverted colors as a filled bar
    /// with dark text and normal ones as a colored bar, both keyed off this.
    public var base: ConsoleChannelColor {
        switch self {
        case .offInverted: return .off
        case .redInverted: return .red
        case .greenInverted: return .green
        case .yellowInverted: return .yellow
        case .blueInverted: return .blue
        case .magentaInverted: return .magenta
        case .cyanInverted: return .cyan
        case .whiteInverted: return .white
        case .off, .red, .green, .yellow, .blue, .magenta, .cyan, .white:
            return self
        }
    }
}

/// One console target's scribble-strip label: the desk's own name and color
/// for Main LR or one input channel.
public struct ConsoleTargetLabel: Equatable, Sendable {
    public var target: ConsoleEQTarget
    public var name: String
    public var color: ConsoleChannelColor

    public init(target: ConsoleEQTarget, name: String, color: ConsoleChannelColor) {
        self.target = target
        self.name = name
        self.color = color
    }

    /// "Main LR", or "Ch N" for a channel — shown when the desk name is
    /// empty.
    public var fallbackName: String {
        switch target {
        case .mainLR: return "Main LR"
        case .channel(let index): return "Ch \(index)"
        }
    }

    /// `name` trimmed of whitespace, or `fallbackName` when that is empty.
    public var displayName: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? fallbackName : trimmed
    }
}

/// The 33-target catalog (Main LR + channels 1...32) of scribble-strip
/// labels, built from the bounded `/node` config walk. Parsing is pure and
/// read-only: every line that doesn't exactly match the expected shape for
/// a target already in this catalog is rejected without changing anything.
public struct ConsoleTargetCatalog: Equatable, Sendable {
    public static let channelCount = 32

    public static let targets: [ConsoleEQTarget] = [.mainLR] + (1...channelCount).map { .channel($0) }

    public private(set) var labels: [ConsoleTargetLabel]

    public init() {
        labels = ConsoleTargetCatalog.targets.map { ConsoleTargetLabel(target: $0, name: "", color: .off) }
    }

    /// The label for `target`, or a blank `.off` label built from it when it
    /// is not one of the 33 catalog targets (never crashes).
    public func label(for target: ConsoleEQTarget) -> ConsoleTargetLabel {
        if let index = labels.firstIndex(where: { $0.target == target }) {
            return labels[index]
        }
        return ConsoleTargetLabel(target: target, name: "", color: .off)
    }

    /// Folds one `/node` config reply line into `self`:
    /// `<configPath> "<name>" <icon> <color> [<source>]`. Returns `true` if
    /// applied; any failure (unknown path, no quotes, an unterminated
    /// quote, too few trailing tokens, a non-integer icon, or an unknown
    /// color token) leaves `self` unchanged and returns `false`.
    @discardableResult
    public mutating func apply(nodeLine: String) -> Bool {
        var line = Substring(nodeLine)
        while let last = line.last, last.isWhitespace {
            line.removeLast()
        }

        guard let firstSpaceIndex = line.firstIndex(where: { $0.isWhitespace }) else { return false }
        let firstToken = String(line[line.startIndex..<firstSpaceIndex])
        guard let targetIndex = ConsoleTargetCatalog.targets.firstIndex(where: { $0.configPath == firstToken }) else {
            return false
        }

        var rest = line[firstSpaceIndex...]
        while let first = rest.first, first.isWhitespace {
            rest.removeFirst()
        }
        guard rest.first == "\"" else { return false }
        rest.removeFirst()
        guard let closingQuoteIndex = rest.firstIndex(of: "\"") else { return false }
        let name = String(rest[rest.startIndex..<closingQuoteIndex])

        let afterQuote = rest[rest.index(after: closingQuoteIndex)...]
        let tokens = afterQuote.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard tokens.count >= 2 else { return false }
        guard Int(tokens[0]) != nil else { return false } // icon, unmodeled
        guard let color = ConsoleChannelColor(nodeToken: tokens[1]) else { return false }

        labels[targetIndex] = ConsoleTargetLabel(target: ConsoleTargetCatalog.targets[targetIndex], name: name, color: color)
        return true
    }

    /// The 33 bounded `/node` config reads, Main LR first then channels
    /// 1...32 in order.
    public static func walkMessages() -> [OSCMessage] {
        targets.map { OSCMessage("/node", [.string(String($0.configPath.dropFirst()))]) }
    }

    /// Only `.requestFullResync` (the effect the reducer emits on entering
    /// Syncing, on every connect and reconnect) walks; every other effect
    /// carries no extra traffic.
    public static func walkMessages(for effect: ConsoleSessionEffect) -> [OSCMessage] {
        switch effect {
        case .requestFullResync:
            return walkMessages()
        default:
            return []
        }
    }
}
