import Foundation
import Observation

/// Every user-facing string for the channel-setup flow (#1781), the
/// `ConsoleConnectCopy` idiom.
public enum ChannelSetupCopy {
    public static let rowTitle = "Discover channel setup"
    public static let title = "Channel setup"
    public static let unsupportedTitle = "Not supported yet"
    public static let continueButton = "Continue"

    public static func unsupportedDetail(model: String) -> String {
        "Sound Buddy can read X32 and M32 consoles. \(model) support is coming later."
    }

    /// Step-2 placeholder copy until #1782's UI slice reads real channels.
    public static func channelsPlaceholder(name: String, model: String) -> String {
        "\(name) (\(model)) is connected. Reading its channels is next."
    }
}

/// Where the setup flow is. Derived, never set directly, except for the
/// handoff that `continueToChannels()` stores.
public enum ChannelSetupStep: Equatable, Sendable {
    case consent
    case connect
    case unsupported(ConsoleXInfo)
    case channels(ConsoleXInfo)
}

/// Drives "Discover channel setup" (#1781): consent, then the existing
/// #1666 connect flow, then a model gate shared with step 2's reader, then
/// handoff to the channels step. Every side effect (transport, consent) is
/// injected through `store`/`consent` — this type adds none of its own.
@MainActor
@Observable
public final class ChannelSetupFlow {
    @ObservationIgnored public let store: ConsoleStore
    @ObservationIgnored private let consent: ConsoleConsentStore
    private var handedOff: ConsoleXInfo?

    public init(store: ConsoleStore, consent: ConsoleConsentStore) {
        self.store = store
        self.consent = consent
    }

    public var step: ChannelSetupStep {
        guard consent.isGranted else { return .consent }
        if let handedOff { return .channels(handedOff) }
        if case let .connected(info) = store.phase, !Self.isSupportedModel(info.model) { return .unsupported(info) }
        return .connect
    }

    /// Shares step 2's model table so the gate and the reader never disagree.
    public static func isSupportedModel(_ model: String) -> Bool {
        ConsoleChannelInventory.stripCounts(forModel: model) != nil
    }

    /// Called only from ConsoleConsentView's Allow closure.
    public func grantConsent() {
        consent.grant()
    }

    /// Hands a connected, supported console to step 2. Returns nil, leaving
    /// the step unchanged, in any other state.
    @discardableResult
    public func continueToChannels() -> ConsoleXInfo? {
        guard case let .connected(info) = store.phase, Self.isSupportedModel(info.model) else { return nil }
        handedOff = info
        return info
    }

    /// Called on scenePhase → .active. After a Local Network denial this
    /// cancels the transport (dropping the waiting NWConnection) and goes
    /// back to manual entry, so the next Connect builds a fresh connection
    /// once the user has allowed access in Settings. A no-op in every other
    /// phase.
    public func foregrounded() {
        if store.phase == .permissionDenied { store.disconnect() }
    }

    /// Clears a previous handoff so re-opening the row starts at step 1.
    public func restart() {
        handedOff = nil
    }
}
