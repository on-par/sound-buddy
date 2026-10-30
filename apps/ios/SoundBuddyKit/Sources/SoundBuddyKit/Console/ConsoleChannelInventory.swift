import Foundation

/// The three `/node` config families a strip can belong to:
/// `/ch/[01..32]/config`, `/auxin/[01..08]/config`, `/bus/[01..16]/config`.
/// Main LR is `ConsoleTargetCatalog`'s territory, not this inventory's.
public enum ConsoleStripKind: String, CaseIterable, Codable, Sendable {
    case ch
    case auxin
    case bus

    /// The `/node` path segment: "ch", "auxin", "bus".
    public var pathPrefix: String {
        rawValue
    }

    /// The display-name fallback prefix: "Ch", "Aux", "Bus".
    public var fallbackLabel: String {
        switch self {
        case .ch: return "Ch"
        case .auxin: return "Aux"
        case .bus: return "Bus"
        }
    }

    /// Bus strips have no `/config/source` field — the desk never asks a
    /// bus "where does your signal come from".
    public var hasSource: Bool {
        self != .bus
    }
}

/// One strip's identity: its kind and its 1-based number within that kind.
public struct ConsoleStripID: Hashable, Codable, Sendable {
    private static let numberWidth = 2

    public let kind: ConsoleStripKind
    public let number: Int

    public init(kind: ConsoleStripKind, number: Int) {
        self.kind = kind
        self.number = number
    }

    /// The two-digit zero-padded `/node` config path, e.g. `/ch/01/config`,
    /// `/auxin/08/config`, `/bus/16/config`.
    public var configPath: String {
        "/\(kind.pathPrefix)/\(String(format: "%0\(ConsoleStripID.numberWidth)d", number))/config"
    }

    /// "Ch 13", "Aux 5", "Bus 3" — shown when the desk name is empty.
    public var fallbackName: String {
        "\(kind.fallbackLabel) \(number)"
    }
}

/// One complete channel strip: the desk's own name, icon, color and
/// (except for buses) routed input source.
public struct ConsoleChannelStrip: Equatable, Sendable {
    public let id: ConsoleStripID
    public let name: String
    public let icon: Int?
    public let color: ConsoleChannelColor
    public let source: ConsoleInputSource?

    public init(id: ConsoleStripID, name: String, icon: Int?, color: ConsoleChannelColor, source: ConsoleInputSource?) {
        self.id = id
        self.name = name
        self.icon = icon
        self.color = color
        self.source = source
    }

    /// `name` trimmed of whitespace, or `id.fallbackName` when that is
    /// empty. `name` itself keeps "" verbatim — only display falls back.
    public var displayName: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? id.fallbackName : trimmed
    }
}

/// A whole console's channel layout — every `/ch`, `/auxin` and `/bus` strip
/// — learned from one bounded `/node` walk (`walkMessages()`), with an
/// ADR-0142 defer-and-sweep for strips that never answer: `sweepMessages()`
/// re-queries silent strips once, and whatever is still missing afterwards
/// is reported in `missing`/`missingSummary`, never silently dropped. Pure
/// value type: no socket, no timers — the caller (#1781) drives the
/// transport and feeds replies in through `apply(nodeLine:)` and
/// `apply(fieldReply:)`.
public struct ConsoleChannelInventory: Equatable, Sendable {
    /// Documented so callers don't assume truncation: names are kept
    /// verbatim, however long the desk reports them. 12 is the console's
    /// own scribble-strip display width, not a limit this type enforces.
    public static let maxNameLength = 12

    /// A strip's fields as they trickle in one `/…/config/<field>` reply at
    /// a time during a sweep, before all of them are present.
    private struct PartialFields: Equatable, Sendable {
        var name: String?
        var color: ConsoleChannelColor?
        var source: ConsoleInputSource?
    }

    private static let x32FamilyCounts: [ConsoleStripKind: Int] = [.ch: 32, .auxin: 8, .bus: 16]

    /// Per-model strip counts. A model matches a row if it has that row's
    /// prefix, e.g. "X32RACK" and "X32P" both match "X32".
    private static let modelTable: [(modelPrefix: String, counts: [ConsoleStripKind: Int])] = [
        ("X32", x32FamilyCounts),
        ("M32", x32FamilyCounts),
    ]

    /// The per-strip-kind counts for `model` (e.g. "X32RACK", "M32R"), or
    /// `nil` when `model` matches no known family. No code outside this
    /// table may assume a specific count.
    public static func stripCounts(forModel model: String) -> [ConsoleStripKind: Int]? {
        modelTable.first { model.hasPrefix($0.modelPrefix) }?.counts
    }

    /// Every strip this inventory tracks, in walk order: all `ch`, then all
    /// `auxin`, then all `bus`.
    public let stripIDs: [ConsoleStripID]

    /// Complete strips only — a strip appears here only once its name,
    /// color and (if applicable) source are all known.
    public private(set) var strips: [ConsoleStripID: ConsoleChannelStrip] = [:]

    private var malformed: Set<ConsoleStripID> = []
    private var partials: [ConsoleStripID: PartialFields] = [:]

    public init(stripCounts: [ConsoleStripKind: Int]) {
        var ids: [ConsoleStripID] = []
        for kind in ConsoleStripKind.allCases {
            guard let count = stripCounts[kind], count > 0 else { continue }
            for number in 1...count {
                ids.append(ConsoleStripID(kind: kind, number: number))
            }
        }
        stripIDs = ids
    }

    public init?(model: String) {
        guard let counts = ConsoleChannelInventory.stripCounts(forModel: model) else { return nil }
        self.init(stripCounts: counts)
    }

    /// One bounded `/node` config read per strip, ch then auxin then bus.
    public func walkMessages() -> [OSCMessage] {
        stripIDs.map { ConsoleTargetCatalog.nodeQuery(forConfigPath: $0.configPath) }
    }

    /// Folds one `/node` config reply line into `self`. An unknown path
    /// leaves `self` unchanged and returns `false`. A known path whose line
    /// fails any check (bad color token, a `hasSource` kind missing or
    /// non-integer source) is recorded in `malformed` for a per-field
    /// sweep, and also returns `false` — an existing complete strip is
    /// never overwritten by a malformed line. On success the strip is
    /// stored complete, any malformed/partial state for it is cleared, and
    /// this returns `true`.
    @discardableResult
    public mutating func apply(nodeLine: String) -> Bool {
        guard let line = ConsoleConfigLine(nodeLine: nodeLine) else { return false }
        guard let id = stripIDs.first(where: { $0.configPath == line.path }) else { return false }

        guard let color = ConsoleChannelColor(nodeToken: line.colorToken) else {
            malformed.insert(id)
            partials.removeValue(forKey: id)
            return false
        }

        var source: ConsoleInputSource?
        if id.kind.hasSource {
            guard let sourceToken = line.sourceToken, let rawSource = Int(sourceToken) else {
                malformed.insert(id)
                partials.removeValue(forKey: id)
                return false
            }
            source = ConsoleInputSource(raw: rawSource)
        }

        strips[id] = ConsoleChannelStrip(id: id, name: line.name, icon: line.icon, color: color, source: source)
        malformed.remove(id)
        partials.removeValue(forKey: id)
        return true
    }

    /// Folds one per-field sweep reply (`<configPath>/name`, `/color` or
    /// `/source`) into a strip that is not yet complete. Any other shape —
    /// an address outside the inventory, a `/source` reply on a bus strip,
    /// a wrong argument type, or a reply for an already-complete strip —
    /// returns `false` with no change. Once a strip's name, color and (if
    /// `hasSource`) source have all arrived, it is promoted into `strips`
    /// with `icon: nil` (per-field replies never carry an icon).
    @discardableResult
    public mutating func apply(fieldReply message: OSCMessage) -> Bool {
        let normalizedAddress = OSCMessage.normalizedReplyAddress(message.address)

        for id in stripIDs where strips[id] == nil {
            let base = id.configPath
            switch normalizedAddress {
            case "\(base)/name":
                guard message.arguments.count == 1, case let .string(value) = message.arguments[0] else { return false }
                var fields = partials[id] ?? PartialFields()
                fields.name = value
                partials[id] = fields
                promoteIfComplete(id)
                return true
            case "\(base)/color":
                guard message.arguments.count == 1, case let .int(rawValue) = message.arguments[0] else { return false }
                guard let color = ConsoleChannelColor(rawInt: Int(rawValue)) else { return false }
                var fields = partials[id] ?? PartialFields()
                fields.color = color
                partials[id] = fields
                promoteIfComplete(id)
                return true
            case "\(base)/source":
                guard id.kind.hasSource else { return false }
                guard message.arguments.count == 1, case let .int(rawValue) = message.arguments[0] else { return false }
                var fields = partials[id] ?? PartialFields()
                fields.source = ConsoleInputSource(raw: Int(rawValue))
                partials[id] = fields
                promoteIfComplete(id)
                return true
            default:
                continue
            }
        }
        return false
    }

    private mutating func promoteIfComplete(_ id: ConsoleStripID) {
        guard let fields = partials[id], let name = fields.name, let color = fields.color else { return }
        if id.kind.hasSource {
            guard let source = fields.source else { return }
            strips[id] = ConsoleChannelStrip(id: id, name: name, icon: nil, color: color, source: source)
        } else {
            strips[id] = ConsoleChannelStrip(id: id, name: name, icon: nil, color: color, source: nil)
        }
        partials.removeValue(forKey: id)
        malformed.remove(id)
    }

    /// Every strip not yet complete, in walk order.
    public var missing: [ConsoleStripID] {
        stripIDs.filter { strips[$0] == nil }
    }

    /// One re-query per still-missing strip after the walk table is
    /// exhausted (ADR-0142: defer, then a single sweep). A strip already
    /// known to be malformed gets zero-argument per-field queries instead
    /// of another full `/node` read — `/source` only when `hasSource`.
    public func sweepMessages() -> [OSCMessage] {
        missing.flatMap { id -> [OSCMessage] in
            guard malformed.contains(id) else {
                return [ConsoleTargetCatalog.nodeQuery(forConfigPath: id.configPath)]
            }
            var messages = [
                OSCMessage("\(id.configPath)/name"),
                OSCMessage("\(id.configPath)/color"),
            ]
            if id.kind.hasSource {
                messages.append(OSCMessage("\(id.configPath)/source"))
            }
            return messages
        }
    }

    /// `nil` once every strip has answered; otherwise a user-facing
    /// summary that always tells the user what to do next.
    public var missingSummary: String? {
        switch missing.count {
        case 0:
            return nil
        case 1:
            return "1 channel didn't answer — Retry"
        default:
            return "\(missing.count) channels didn't answer — Retry"
        }
    }
}
