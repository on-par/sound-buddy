import Foundation
import Observation

/// Remembers which EQ target the engineer last picked, per console identity
/// (name + model) — same `UserDefaults` idiom as `KeepAwakePolicy`.
public enum ConsoleTargetMemory {
    public static let defaultsKeyPrefix = "consoleTarget."

    public static func key(for console: ConsoleIdentity) -> String {
        defaultsKeyPrefix + console.model + "|" + console.name
    }

    public static func storageToken(for target: ConsoleEQTarget) -> String {
        switch target {
        case .mainLR: return "main"
        case .channel(let index): return "ch\(index)"
        }
    }

    /// Accepts `"main"` and `"chN"` with N in 1...32 only; `nil` for
    /// anything else (garbage, out-of-range, or missing).
    public static func target(storageToken: String) -> ConsoleEQTarget? {
        if storageToken == "main" { return .mainLR }
        guard storageToken.hasPrefix("ch") else { return nil }
        let numberToken = storageToken.dropFirst(2)
        guard let index = Int(numberToken), (1...ConsoleTargetCatalog.channelCount).contains(index) else {
            return nil
        }
        return .channel(index)
    }

    /// The stored target for `console`, or `.mainLR` when none is stored or
    /// the stored token is unreadable.
    public static func load(for console: ConsoleIdentity, in defaults: UserDefaults) -> ConsoleEQTarget {
        guard let token = defaults.string(forKey: key(for: console)), let target = target(storageToken: token) else {
            return .mainLR
        }
        return target
    }

    public static func store(_ target: ConsoleEQTarget, for console: ConsoleIdentity, in defaults: UserDefaults) {
        defaults.set(storageToken(for: target), forKey: key(for: console))
    }
}

/// The selected console EQ target plus the scribble-strip catalog it is
/// picked from. `UserDefaults` and `phase` are injected: the #1666 adapter
/// forwards the live session's console identity, `/node` reply lines and
/// `ConsoleSessionModel.phase` here; the DEBUG fixture seed does the same by
/// hand.
@Observable
public final class ConsoleTargetModel {
    private let defaults: UserDefaults

    public private(set) var console: ConsoleIdentity?
    public private(set) var catalog = ConsoleTargetCatalog()
    public private(set) var selected: ConsoleEQTarget = .mainLR
    public var phase: ConsoleSessionPhase = .idle

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// Switching to a different console identity resets the catalog (the
    /// next resync repopulates it) and restores that console's remembered
    /// pick. Re-reporting the same identity (a reconnect) does nothing, so
    /// names survive the drop while the next walk refreshes them.
    public func consoleChanged(_ console: ConsoleIdentity?) {
        guard console != self.console else { return }
        self.console = console
        catalog = ConsoleTargetCatalog()
        selected = console.map { ConsoleTargetMemory.load(for: $0, in: defaults) } ?? .mainLR
    }

    public func ingest(nodeLine: String) {
        catalog.apply(nodeLine: nodeLine)
    }

    /// Ignores targets outside the 33-entry catalog; persists the pick
    /// under the current console's key, when there is one.
    public func select(_ target: ConsoleEQTarget) {
        guard ConsoleTargetCatalog.targets.contains(target) else { return }
        selected = target
        if let console {
            ConsoleTargetMemory.store(target, for: console, in: defaults)
        }
    }

    public var chipStatus: ConsoleChipStatus {
        ConsoleChipStatus(phase: phase)
    }

    /// e.g. "M32R · Main LR"; `nil` without a console.
    public var chipTitle: String? {
        guard let console else { return nil }
        return "\(console.model) · \(catalog.label(for: selected).displayName)"
    }
}
