import Foundation
import Observation

/// Every user-facing string for channel setup (#1781).
public enum ChannelSetupCopy {
    public static let rowTitle = "Discover channel setup"
    public static let title = "Channel setup"
    public static let continueButton = "Continue"
    public static let unsupportedTitle = "Not supported yet"

    public static func unsupportedDetail(model: String) -> String {
        let subject = model.isEmpty ? "This console" : model
        return "\(subject) isn't supported yet. Channel setup works with X32 and M32 consoles."
    }

    public static func channelsPending(name: String) -> String {
        "Connected to \(name). Reading its channels is the next step."
    }
}

/// X32/M32 family gate (#1781). Deny by default: exact match on a
/// normalised model (uppercased, spaces/hyphens/underscores removed).
public enum ConsoleModelFamily {
    public static let supportedModels: Set<String> = [
        "X32", "X32C", "X32COMPACT", "X32P", "X32PRODUCER", "X32R", "X32RACK",
        "M32", "M32C", "M32R",
    ]

    static func normalized(_ model: String) -> String {
        model
            .uppercased()
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "_", with: "")
    }

    public static func isSupported(_ model: String) -> Bool {
        supportedModels.contains(normalized(model))
    }
}

public enum ChannelSetupConnectSource: Equatable, Sendable {
    case discover
    case lastKnown(SavedConsole)
    case manual
}

public enum ChannelSetupStep: Equatable, Sendable {
    case consent
    case connect
    case identified(ConsoleXInfo)
    case unsupported(ConsoleXInfo)
    case channels(ConsoleXInfo)
}

@MainActor
@Observable
public final class ChannelSetupFlow {
    public let store: ConsoleStore
    public private(set) var handedOff: ConsoleXInfo?
    @ObservationIgnored private let isConsentGranted: () -> Bool

    public init(store: ConsoleStore, isConsentGranted: @escaping () -> Bool) {
        self.store = store
        self.isConsentGranted = isConsentGranted
    }

    public var step: ChannelSetupStep {
        Self.step(consentGranted: isConsentGranted(), phase: store.phase, handedOff: handedOff)
    }

    /// Pure step derivation for the channel setup flow (#1781).
    public static func step(
        consentGranted: Bool,
        phase: ConsoleConnectPhase,
        handedOff: ConsoleXInfo?
    ) -> ChannelSetupStep {
        guard consentGranted else { return .consent }
        if let handedOff { return .channels(handedOff) }
        if case let .connected(info) = phase {
            return ConsoleModelFamily.isSupported(info.model) ? .identified(info) : .unsupported(info)
        }
        return .connect
    }

    /// Available connect entry points in priority order (#1781).
    public static func connectSources(
        discoveryAvailable: Bool,
        savedConsole: SavedConsole?
    ) -> [ChannelSetupConnectSource] {
        var sources: [ChannelSetupConnectSource] = []
        if discoveryAvailable { sources.append(.discover) }
        if let savedConsole { sources.append(.lastKnown(savedConsole)) }
        sources.append(.manual)
        return sources
    }

    /// Records the identified console for step 2; all other steps are a no-op.
    public func continueToChannels() {
        guard case let .identified(info) = step else { return }
        handedOff = info
    }

    /// Clears step-2 handoff state when the sheet closes (#1781).
    public func reset() {
        handedOff = nil
    }
}
