import Foundation

/// A saved setup plus the IP the console last answered at — a hint only
/// (DHCP can move it); lookups never use it.
public struct SavedChannelSetup: Equatable, Sendable {
    public let setup: ConfirmedChannelSetup
    public let ipHint: String?

    public init(setup: ConfirmedChannelSetup, ipHint: String?) {
        self.setup = setup
        self.ipHint = ipHint
    }
}

public enum ChannelSetupLookup: Equatable, Sendable {
    case notFound
    case found(SavedChannelSetup)
    /// Stored data was an unsupported schema or unreadable; it has been
    /// discarded. Show `ChannelSetupStoreCopy.needsRecheck`.
    case needsRecheck
}

public enum ChannelSetupStoreCopy {
    public static let needsRecheck = "Setup needs a quick re-check"
}

/// Persists the volunteer's confirmed channel setup (#1792), one per console
/// identity (model + name), so later slices can skip re-doing setup on
/// reconnect (#1794). The console's IP is kept only as a hint — lookups are
/// always by identity, never by address.
public final class ChannelSetupStore {
    public static let defaultsKeyPrefix = "channelSetup."
    /// Version of the persisted envelope (not ConfirmedChannelSetup's own).
    public static let schemaVersion = 1

    private struct Envelope: Codable {
        let schemaVersion: Int
        let ipHint: String?
        let setup: ConfirmedChannelSetup
    }

    private struct VersionProbe: Decodable {
        let schemaVersion: Int
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public static func key(for console: ConsoleIdentity) -> String {
        defaultsKeyPrefix + console.model + "|" + console.name
    }

    public func setup(for console: ConsoleIdentity) -> ChannelSetupLookup {
        let key = Self.key(for: console)
        guard let raw = defaults.object(forKey: key) else { return .notFound }
        guard let data = raw as? Data, let envelope = Self.migrate(data) else {
            defaults.removeObject(forKey: key)
            return .needsRecheck
        }
        guard envelope.setup.console == console else { return .notFound }
        return .found(SavedChannelSetup(setup: envelope.setup, ipHint: envelope.ipHint))
    }

    public func save(_ setup: ConfirmedChannelSetup, ipHint: String? = nil) {
        let envelope = Envelope(schemaVersion: Self.schemaVersion, ipHint: ipHint, setup: setup)
        guard let data = try? JSONEncoder().encode(envelope) else { return }
        defaults.set(data, forKey: Self.key(for: setup.console))
    }

    public func forget(_ console: ConsoleIdentity) {
        defaults.removeObject(forKey: Self.key(for: console))
    }

    public var savedConsoles: [ConsoleIdentity] {
        let prefix = Self.defaultsKeyPrefix
        let identities = defaults.dictionaryRepresentation().keys
            .filter { $0.hasPrefix(prefix) }
            .compactMap { key -> ConsoleIdentity? in
                guard let raw = defaults.object(forKey: key) else { return nil }
                guard let data = raw as? Data, let envelope = Self.migrate(data) else { return nil }
                return envelope.setup.console
            }
        return identities.sorted { ($0.model, $0.name) < ($1.model, $1.name) }
    }

    /// A future envelope bump adds a `case` here that converts the old
    /// shape; until then anything else is discarded.
    private static func migrate(_ data: Data) -> Envelope? {
        guard let probe = try? JSONDecoder().decode(VersionProbe.self, from: data) else { return nil }
        switch probe.schemaVersion {
        case schemaVersion:
            guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else { return nil }
            guard envelope.setup.schemaVersion == ConfirmedChannelSetup.schemaVersion else { return nil }
            return envelope
        default:
            return nil
        }
    }
}
