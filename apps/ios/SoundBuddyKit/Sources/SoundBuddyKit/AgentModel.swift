import Foundation

public enum AgentApplyState: Equatable, Sendable {
    case noConsoleLink
    case locked
    case ready
}

public struct AgentMove: Equatable, Sendable {
    public let bandNumber: Int?
    public let freqHz: Double
    public let q: Double
    public let gainDb: Double
    public let retuneNote: String?
    public let preview: ConsoleEQPanelState?
    public let undoNote: String?

    init(suggestion: ConsoleCoachingSuggestion, mainLR: ConsoleEQ, phase: ConsoleSessionPhase) {
        let applied = ConsoleCoachingMapper.applied(suggestion, to: mainLR)
        bandNumber = suggestion.bandNumber
        freqHz = applied.written.freqHz
        q = applied.written.q
        gainDb = applied.written.gainDb
        retuneNote = suggestion.retuneNote
        let landed = ConsoleCoachingSuggestion(
            bandIndex: suggestion.bandIndex, band: applied.written, retunesBandInUse: suggestion.retunesBandInUse,
            copy: suggestion.copy, retuneNote: suggestion.retuneNote
        )
        preview = ConsoleEQPanelState(target: .mainLR, eq: mainLR, phase: phase, coaching: landed)
        undoNote = AgentCopy.undoSentence(bandNumber: suggestion.bandNumber, prior: applied.prior)
    }

    init(unlinkedSuggestion suggestion: ConsoleCoachingSuggestion) {
        bandNumber = nil
        freqHz = suggestion.band.freqHz
        q = suggestion.band.q
        gainDb = suggestion.band.gainDb
        retuneNote = nil
        preview = nil
        undoNote = nil
    }

    public var bandText: String { bandNumber.map { "Band \($0)" } ?? AgentCopy.unavailableBand }
    public var freqText: String { ConsoleEQPanelState.freqText(freqHz) }
    public var qText: String { String(format: AgentFormat.oneDecimal, q) }
    public var gainText: String { AgentFormat.signedDb(gainDb) }
}

public struct AgentModel: Equatable, Sendable {
    public let selected: CoachingEvent?
    public let move: AgentMove?
    public let applyState: AgentApplyState
    public let next: CoachingEvent?

    public init(
        events: [CoachingEvent],
        selectedID: String?,
        dismissedIDs: Set<String>,
        mainLR: ConsoleEQ?,
        phase: ConsoleSessionPhase,
        writer: ConsoleEQWriter?
    ) {
        let eligible = events.filter { !dismissedIDs.contains($0.id) }
        let chosen = eligible.first { $0.id == selectedID } ?? eligible.first
        selected = chosen
        next = chosen.flatMap { Self.following($0, in: eligible) }

        let linkedEQ = mainLR.flatMap { $0.target == .mainLR ? $0 : nil }
        if let chosen, let linkedEQ, let suggestion = ConsoleCoachingMapper.suggestion(for: chosen, mainLR: linkedEQ) {
            move = AgentMove(suggestion: suggestion, mainLR: linkedEQ, phase: phase)
        } else if let chosen, let suggestion = ConsoleCoachingMapper.suggestion(for: chosen, mainLR: .flat(for: .mainLR)) {
            move = AgentMove(unlinkedSuggestion: suggestion)
        } else {
            move = nil
        }

        if linkedEQ == nil || !phase.isLinkUp {
            applyState = .noConsoleLink
        } else {
            applyState = ConsoleCoachingMapper.isArmed(writer: writer, phase: phase) ? .ready : .locked
        }
    }

    public var diagnosis: String? { selected?.message }

    private static func following(_ event: CoachingEvent, in eligible: [CoachingEvent]) -> CoachingEvent? {
        guard let index = eligible.firstIndex(of: event), eligible.count > 1 else { return nil }
        return eligible[(index + 1) % eligible.count]
    }
}

public struct AgentSelection: Equatable, Sendable {
    public private(set) var selectedID: String?
    public private(set) var dismissedIDs: Set<String> = []

    public init() {}

    public mutating func select(_ id: String) {
        selectedID = id
        dismissedIDs.remove(id)
    }

    public mutating func dismiss(_ id: String) {
        dismissedIDs.insert(id)
        if selectedID == id {
            selectedID = nil
        }
    }

    public mutating func prune(keeping events: [CoachingEvent]) {
        dismissedIDs.formIntersection(events.map(\.id))
    }
}

public enum AgentCopy {
    public static let title = "Sound Buddy Agent"
    public static let subtitle = "Suggest & Approve · nothing changes until you tap Apply"
    public static let badge = "On-device rules"
    public static let badgeDetail = "No AI model · no cloud"
    public static let diagnosisSource = "Phone mic estimate"
    public static let mainLRTag = "MAIN LR"
    public static let proposed = "Proposed"
    public static let safeStep = "Inside the ±3 dB safe step"
    public static let noConsoleLink = "Apply needs a linked, armed console. Make this move on the desk."
    public static let previewUnavailable = "Preview needs the console's current EQ"
    public static let footer = "Chat and Mac Companion are not in this build."
    public static let applyLocked = ConsoleCoachingMapper.applyLabelDisarmed
    public static let dismiss = "Dismiss"
    public static let armed = "Armed"
    public static let next = "Next"
    public static let empty = "No move to review. Sound Buddy suggests one when a band stays off target."
    public static let unavailableBand = "Unavailable"
    static let consoleFallback = "console"

    public static let applyNothingSent = "Nothing was sent. Wait for Main LR's EQ to refresh, then tap Apply again."

    public static func moveTitle(gainDb: Double, band: Band?) -> String {
        let verb = gainDb < 0 ? "Cut" : "Boost"
        guard let band else { return verb }
        return "\(verb) \(band.label.lowercased())"
    }

    public static func applyTitle(consoleModel: String?) -> String {
        let model = consoleModel?.trimmingCharacters(in: .whitespaces) ?? ""
        return "Apply to \(model.isEmpty ? consoleFallback : model)"
    }

    public static func undoSentence(for applied: ConsoleCoachingApplied) -> String {
        undoSentence(bandNumber: applied.bandNumber, prior: applied.prior)
    }

    static func undoSentence(bandNumber: Int, prior: ConsoleEQBand) -> String {
        "Undo puts Main LR Band \(bandNumber) back to \(AgentFormat.signedDb(prior.gainDb)) at \(ConsoleEQPanelState.freqText(prior.freqHz))."
    }
}

public enum AgentFormat {
    static let oneDecimal = "%.1f"
    static let zeroEpsilonDb = 0.05
    static let minusSign = "\u{2212}"
    static let deviationKey = "deviationDb"

    public static func signedDb(_ db: Double) -> String {
        guard abs(db) >= zeroEpsilonDb else { return "0.0 dB" }
        let sign = db < 0 ? minusSign : "+"
        return sign + String(format: oneDecimal, abs(db)) + " dB"
    }

    static func deviationDb(of event: CoachingEvent) -> Double? {
        guard let value = event.data?[deviationKey], case .number(let deviation) = value,
              deviation.isFinite, deviation != 0
        else { return nil }
        return deviation
    }
}
