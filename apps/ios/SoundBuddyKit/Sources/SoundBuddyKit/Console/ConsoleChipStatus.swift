import Foundation

/// Semantic chip color — the view maps this to its own SwiftUI colors, so
/// this stays UI-free.
public enum ConsoleChipTint: Equatable, Sendable {
    case green
    case amber
    case grey
}

/// The console link chip's state, derived from `ConsoleSessionPhase`.
/// Mirrors ADR-0079's rule that the four-client `/xremote` refusal
/// (`.liveDegraded`) reads as degraded, never offline.
public enum ConsoleChipStatus: Equatable, Sendable {
    case live
    case reconnecting
    case offline
    case degraded

    /// Exhaustive, no default: every `ConsoleSessionPhase` case must be
    /// claimed here so a new phase fails to compile instead of silently
    /// falling through to the wrong chip.
    public init(phase: ConsoleSessionPhase) {
        switch phase {
        case .live:
            self = .live
        case .liveDegraded:
            self = .degraded
        case .connecting, .syncing, .reconnecting, .suspended:
            self = .reconnecting
        case .idle, .noNetwork, .permissionDenied:
            self = .offline
        }
    }

    public var label: String {
        switch self {
        case .live: return "Live"
        case .reconnecting: return "Reconnecting…"
        case .offline: return "Offline"
        case .degraded: return "Degraded"
        }
    }

    public var tint: ConsoleChipTint {
        switch self {
        case .live: return .green
        case .reconnecting: return .amber
        case .offline: return .grey
        case .degraded: return .amber
        }
    }

    /// The "too many apps" copy for `.degraded`; `nil` otherwise. Reuses
    /// `ConsoleSessionPhase.liveDegraded.statusMessage` rather than
    /// duplicating the copy.
    public var tooltip: String? {
        guard self == .degraded else { return nil }
        return ConsoleSessionPhase.liveDegraded.statusMessage
    }

    /// The chip (and its picker) exist only when the console flag is on,
    /// consent is granted, and a console identity is set.
    public static func isVisible(flagEnabled: Bool, consentGranted: Bool, console: ConsoleIdentity?) -> Bool {
        flagEnabled && consentGranted && console != nil
    }
}
