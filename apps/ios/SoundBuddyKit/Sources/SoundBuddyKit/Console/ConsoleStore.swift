import Foundation
import Observation

/// Durable record of the last console connected to (ip/name/model only — no
/// firmware, per the issue). `identity` is name+model, same shape
/// `ConsoleSessionReducer` matches against.
public struct SavedConsole: Codable, Equatable, Sendable {
    public let ip: String
    public let name: String
    public let model: String

    public init(ip: String, name: String, model: String) {
        self.ip = ip
        self.name = name
        self.model = model
    }

    public var identity: ConsoleIdentity { ConsoleIdentity(name: name, model: model) }
}

/// `ConsoleStore`'s observable phase (#1666): the manual-entry/connect flow,
/// not the live session (that's `ConsoleSessionPhase`, the next slice).
public enum ConsoleConnectPhase: Equatable, Sendable {
    /// The entry form. `notice` explains why it's showing again, e.g. a
    /// mismatched or unreachable saved console — nil for a first-run entry.
    case manual(notice: String?)
    case invalidAddress(ConsoleAddressError)
    case connecting(ConsoleIPv4)
    case connected(ConsoleXInfo)
    /// Terminal for this attempt — `ConsoleStore.retry()` tries the same IP
    /// again, it is never automatic.
    case noReply(ConsoleIPv4)
    /// Terminal: "Open Settings", never a retry loop.
    case permissionDenied
    case failed(String)
}

/// Every user-facing string for the connect flow, so `ConsoleConnectView`
/// and its tests share one source (the `ConsoleConsentCopy` idiom).
public enum ConsoleConnectCopy {
    public static let title = "Console"
    public static let manualIP = "Manual IP"
    public static let connect = "Connect"
    public static let rescan = "Rescan"
    public static let disconnect = "Disconnect"
    public static let retry = "Retry"
    public static let manual = "Manual"
    public static let openSettings = "Open Settings"
    public static let noWiFi = "No Wi-Fi"
    public static let noReply = "No console at that address"
    public static let noReplyDetail = "Check the console is on and on this Wi-Fi, and the IP matches Setup > Network."
    public static let permissionDenied =
        "Sound Buddy needs Local Network access to reach the console. Turn on Local Network for Sound Buddy in Settings."

    public static func differentConsole(name: String, model: String, ip: String) -> String {
        "A different console (\(name), \(model)) answered at \(ip). Check the address."
    }

    public static func lastConsoleUnreachable(name: String) -> String {
        "Couldn't reach your last console (\(name)). Enter its IP."
    }
}

/// Drives the manual-IP / last-known-console connect flow (#1666): validates
/// before any packet leaves, probes unicast `/xinfo`, and persists the last
/// console that answered. Every side effect (transport, Wi-Fi, consent,
/// defaults) is injected, so this is unit-tested against fakes.
@MainActor
@Observable
public final class ConsoleStore {
    public static let defaultsKey = "consoleLastKnown"

    public private(set) var phase: ConsoleConnectPhase = .manual(notice: nil)
    public private(set) var savedConsole: SavedConsole?
    public var lastAttemptedAddress: ConsoleIPv4?

    public var currentWiFi: ConsoleWiFiNetwork? { currentWiFiProvider() }

    @ObservationIgnored private let transport: any ConsoleTransport
    @ObservationIgnored private let currentWiFiProvider: () -> ConsoleWiFiNetwork?
    @ObservationIgnored private let isConsentGranted: () -> Bool
    @ObservationIgnored private let defaults: UserDefaults

    public init(
        transport: any ConsoleTransport,
        currentWiFi: @escaping () -> ConsoleWiFiNetwork?,
        isConsentGranted: @escaping () -> Bool,
        defaults: UserDefaults = .standard
    ) {
        self.transport = transport
        self.currentWiFiProvider = currentWiFi
        self.isConsentGranted = isConsentGranted
        self.defaults = defaults
        self.savedConsole = Self.loadSaved(defaults)
    }

    private static func loadSaved(_ defaults: UserDefaults) -> SavedConsole? {
        guard let data = defaults.data(forKey: Self.defaultsKey) else { return nil }
        return try? JSONDecoder().decode(SavedConsole.self, from: data)
    }

    private func persist(_ saved: SavedConsole) {
        savedConsole = saved
        guard let data = try? JSONEncoder().encode(saved) else { return }
        defaults.set(data, forKey: Self.defaultsKey)
    }

    /// Auto-connect on open: re-probes the saved console and connects only
    /// if the same identity answers. Sends nothing without consent, without
    /// a saved console, or when the saved address no longer validates.
    public func open() async {
        guard isConsentGranted() else { return }
        await connectToSavedConsole()
    }

    /// Unicast to the last-known console. Broadcast discovery replaces this
    /// later; for now this is the same path as `open()`.
    public func rescan() async {
        guard isConsentGranted() else { return }
        await connectToSavedConsole()
    }

    private func connectToSavedConsole() async {
        guard let saved = savedConsole else {
            phase = .manual(notice: nil)
            return
        }
        switch ConsoleAddressValidator.validate(saved.ip, wifi: currentWiFi) {
        case .failure:
            phase = .manual(notice: ConsoleConnectCopy.lastConsoleUnreachable(name: saved.name))
        case let .success(ip):
            await probe(ip, savedIdentity: saved.identity)
        }
    }

    /// The manual-entry form's Connect button. A validation failure sets
    /// `.invalidAddress` and never calls the transport.
    public func connect(manualAddress: String) async {
        guard isConsentGranted() else { return }
        switch ConsoleAddressValidator.validate(manualAddress, wifi: currentWiFi) {
        case let .failure(error):
            phase = .invalidAddress(error)
        case let .success(ip):
            await probe(ip)
        }
    }

    /// Re-probes the last attempted address, re-validated against the
    /// current Wi-Fi. Never automatic — only called from the Retry button.
    public func retry() async {
        guard isConsentGranted() else { return }
        guard let ip = lastAttemptedAddress else {
            phase = .manual(notice: nil)
            return
        }
        switch ConsoleAddressValidator.validate(ip.description, wifi: currentWiFi) {
        case let .failure(error):
            phase = .invalidAddress(error)
        case let .success(validIP):
            await probe(validIP)
        }
    }

    public func showManualEntry() {
        phase = .manual(notice: nil)
    }

    public func disconnect() {
        transport.cancel()
        phase = .manual(notice: nil)
    }

    /// A channel reader over this store's own transport — the one socket
    /// (ADR-0060). Never builds a second transport.
    public func channelReader() -> ConsoleChannelReader { ConsoleChannelReader(transport: transport) }

    /// `savedIdentity` non-nil gates persistence on an identity match (the
    /// open/rescan auto-connect path); nil (manual connect/retry) always
    /// persists on a reply.
    private func probe(_ ip: ConsoleIPv4, savedIdentity: ConsoleIdentity? = nil) async {
        lastAttemptedAddress = ip
        phase = .connecting(ip)
        switch await ConsoleLink.probeXInfo(ip, via: transport) {
        case let .found(info):
            if let savedIdentity, ConsoleIdentity(info) != savedIdentity {
                phase = .manual(notice: ConsoleConnectCopy.differentConsole(name: info.name, model: info.model, ip: ip.description))
                return
            }
            persist(SavedConsole(ip: ip.description, name: info.name, model: info.model))
            phase = .connected(info)
        case .noReply:
            phase = .noReply(ip)
        case .localNetworkDenied:
            phase = .permissionDenied
        case .noWiFi:
            phase = .invalidAddress(.noWiFi)
        case let .failed(message):
            phase = .failed(message)
        }
    }
}
