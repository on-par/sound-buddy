import Foundation

public enum AttentionSeverity: String, Equatable, Sendable {
    case issue
    case check

    public static let issueThresholdDb = 6.0

    public init(deviationDb: Double) {
        self = abs(deviationDb) >= Self.issueThresholdDb ? .issue : .check
    }

    public var label: String {
        switch self {
        case .issue: "Issue"
        case .check: "Check"
        }
    }
}

public struct AttentionItem: Equatable, Identifiable, Sendable {
    public let id: String
    public let band: Band
    public let deviationDb: Double
    public let direction: ProblemMarkerDescriptor.Direction
    public let severity: AttentionSeverity
    public let message: String

    public init?(event: CoachingEvent) {
        guard event.ruleType == .bandDeviation, let band = event.band,
              let deviation = AgentFormat.deviationDb(of: event)
        else { return nil }
        id = event.id
        self.band = band
        deviationDb = deviation
        direction = deviation > 0 ? .overTarget : .underTarget
        severity = AttentionSeverity(deviationDb: deviation)
        message = event.message
    }

    public var bandLabel: String { band.label }
    public var rangeLabel: String { band.rangeLabel }
    public var deviationText: String { AgentFormat.signedDb(deviationDb) }
}

public enum SermonQuiet {
    public static let defaultsKey = "mix.sermonQuiet"
    public static let defaultValue = false

    public static func shows(_ item: AttentionItem) -> Bool {
        item.direction == .overTarget && item.severity == .issue
    }
}

public struct MixTriage: Equatable, Sendable {
    public static let maxVisible = AnalyzeCoachingViewModel.maxCards

    public let visible: [AttentionItem]
    public let heldCount: Int

    public init(events: [CoachingEvent], sermonQuiet: Bool) {
        let items = events.compactMap(AttentionItem.init(event:))
        let shown = sermonQuiet ? items.filter(SermonQuiet.shows) : items
        visible = Array(shown.prefix(Self.maxVisible))
        heldCount = items.count - shown.count
    }

    public var badgeCount: Int { visible.count }

    public func emptyMessage(isMixOnTarget: Bool, placeholder: String) -> String? {
        guard visible.isEmpty else { return nil }
        if heldCount > 0 { return MixCopy.allHeld }
        return isMixOnTarget ? MixCopy.onTarget : placeholder
    }
}

public struct MixLayout: Equatable, Sendable {
    public static let railWidth = 408.0
    public static let wideCardsAcross = 3
    public static let stackedCardsAcross = 1

    public let showsAgentRail: Bool

    public init(width: Double, height: Double) {
        showsAgentRail = AnalyzeLayout(width: width, height: height) == .wide
    }

    public var cardsAcross: Int { showsAgentRail ? Self.wideCardsAcross : Self.stackedCardsAcross }
}

public enum MixChannelList {
    public static func rows(from catalog: ConsoleTargetCatalog) -> [ConsoleTargetLabel] {
        catalog.labels.filter { label in
            !label.name.trimmingCharacters(in: .whitespaces).isEmpty || label.color != .off
        }
    }
}

public enum MixChannelsState: Equatable, Sendable {
    case unavailable
    case empty
    case rows([ConsoleTargetLabel])

    public init(catalog: ConsoleTargetCatalog?) {
        guard let catalog else { self = .unavailable; return }
        let rows = MixChannelList.rows(from: catalog)
        self = rows.isEmpty ? .empty : .rows(rows)
    }

    public var rows: [ConsoleTargetLabel] {
        guard case .rows(let rows) = self else { return [] }
        return rows
    }

    public var emptyMessage: String? {
        switch self {
        case .unavailable: MixCopy.channelsUnavailable
        case .empty: MixCopy.noChannels
        case .rows: nil
        }
    }
}

public enum MixCopy {
    public static let title = "Needs Attention"
    public static let roomMicSubline = "Room mic · phone estimate"
    public static let sermonQuietTitle = "Sermon Quiet"
    public static let sermonQuietCaption = "This device only. Changes what you see here, not the console."
    public static let sourceLine = "Room mic · Main LR"
    public static let vsTargetLabel = "VS TARGET"
    public static let meterUnavailable = "Fader, level and GR need console meters. Not in this build."
    public static let onTarget = CoachingStabilizer.onTargetMessage
    public static let allHeld = "Sermon Quiet is holding every tip right now."
    public static let noChannels = "No channel list yet. Run Discover channel setup in Settings › Console (beta)."
    public static let channelsUnavailable = "Channel names need a live console link. Not in this build."
    public static let reviewFix = "Review fix"
    static let separator = " · "

    public static func attentionSegment(count: Int) -> String {
        "Attention \(count)"
    }

    public static func channelsSegment(count: Int) -> String {
        count > 0 ? "Channels \(count)" : "Channels"
    }

    public static func heldFooter(count: Int) -> String? {
        count > 0 ? "\(count) held by Sermon Quiet" : nil
    }

    public static func subline(chipTitle: String?, chipStatus: ConsoleChipStatus?) -> String {
        guard let chipTitle, let chipStatus else { return roomMicSubline }
        return chipTitle + separator + chipStatus.label
    }
}
