import Foundation
import Observation

/// Copy for `ChannelSetupRecheck`'s own states; `.needsRecheck` reuses
/// `ChannelSetupStoreCopy.needsRecheck` and the Discover button reuses
/// `ChannelSetupCopy.rowTitle`, so neither is redefined here.
public enum ChannelSetupRecheckCopy {
    public static let reviewButton = "Review"

    public static func noSetup(consoleName: String) -> String {
        "No channel setup saved for \(consoleName) yet."
    }
}

/// The Analyze banner `ChannelSetupRecheck.banner` produces: a one-line
/// message, an optional detail (e.g. a withheld room-mic notice), and the one
/// action it offers. Every banner is actionable (constitution: Code quality).
public struct ChannelSetupBanner: Equatable, Sendable {
    public enum Action: Equatable, Sendable {
        case review
        case discover
    }

    public let message: String
    public let detail: String?
    public let action: Action

    public init(message: String, detail: String?, action: Action) {
        self.message = message
        self.detail = detail
        self.action = action
    }

    public var actionTitle: String {
        switch action {
        case .review: ChannelSetupRecheckCopy.reviewButton
        case .discover: ChannelSetupCopy.rowTitle
        }
    }
}

/// Where a reconnect re-check is. `.checking` covers both the store lookup
/// and (when there's a saved setup) the desk read that follows it.
public enum ChannelSetupRecheckState: Equatable, Sendable {
    case idle
    case checking(ConsoleIdentity)
    case applied(ConfirmedChannelSetup)
    case needsReview(info: ConsoleXInfo, read: ConsoleChannelReadResult, diff: ChannelSetupDiff)
    case offerSetup(ConsoleIdentity)
    case needsRecheck
    case readFailed(ConsoleChannelReadError)
}

/// Drives the 5c re-check (#1796): every time `ConsoleStore` reaches
/// `.connected`, look up that console's saved setup (5a) by identity, and
/// either apply it silently, save a colors-only change, surface a banner
/// listing what changed (so Review can reopen 4c's screen restricted to just
/// those strips), offer Discover when there's no saved setup, or ask for a
/// quick re-check when the stored data was unreadable. Read-only: sends only
/// `store.channelReader()`'s zero-arg `/xinfo`/`/node` queries over the one
/// socket (ADR-0161 §2) and never builds a `ConsoleEQWriter`. Gated by the
/// injected `isEnabled` (the `console` feature flag) — consent is implied,
/// since `ConsoleStore` only reaches `.connected` after its own consent gate.
@MainActor
@Observable
public final class ChannelSetupRecheck {
    @ObservationIgnored public let store: ConsoleStore
    @ObservationIgnored private let setupStore: ChannelSetupStore
    @ObservationIgnored private let isEnabled: () -> Bool
    @ObservationIgnored private var readTask: Task<Void, Never>?

    public private(set) var state: ChannelSetupRecheckState = .idle

    public init(store: ConsoleStore, setupStore: ChannelSetupStore, isEnabled: @escaping () -> Bool) {
        self.store = store
        self.setupStore = setupStore
        self.isEnabled = isEnabled
    }

    /// The setup Analyze/console code may use right now: `.applied`'s setup,
    /// or `.needsReview`'s merged setup (in memory, not yet saved).
    public var appliedSetup: ConfirmedChannelSetup? {
        switch state {
        case let .applied(setup):
            return setup
        case let .needsReview(_, _, diff):
            guard case let .needsReview(_, _, merged) = diff.outcome else { return nil }
            return merged
        default:
            return nil
        }
    }

    /// `appliedSetup?.roomMic`, except `nil` while `.needsReview` has
    /// suspended the room mic (its own strip changed) until `adopt` confirms
    /// a pick.
    public var effectiveRoomMic: ConsoleStripID? {
        if case let .needsReview(_, _, diff) = state, diff.roomMicSuspended { return nil }
        return appliedSetup?.roomMic
    }

    /// `nil` once there's nothing to tell the volunteer; otherwise an
    /// actionable banner for Analyze.
    public var banner: ChannelSetupBanner? {
        switch state {
        case let .needsReview(_, _, diff):
            ChannelSetupBanner(message: diff.bannerText ?? "", detail: diff.roomMicNotice, action: .review)
        case let .offerSetup(identity):
            ChannelSetupBanner(message: ChannelSetupRecheckCopy.noSetup(consoleName: identity.name), detail: nil, action: .discover)
        case .needsRecheck:
            ChannelSetupBanner(message: ChannelSetupStoreCopy.needsRecheck, detail: nil, action: .discover)
        case let .readFailed(error):
            ChannelSetupBanner(message: ChannelSetupCopy.readFailed(error), detail: nil, action: .discover)
        default:
            nil
        }
    }

    /// `info` only on a transition into `.connected` with a different
    /// identity (or from a non-connected phase) — never on an unchanged
    /// connection, so a background re-render never re-checks mid-session.
    public static func connectedInfo(from old: ConsoleConnectPhase, to new: ConsoleConnectPhase) -> ConsoleXInfo? {
        guard case let .connected(info) = new else { return nil }
        if case let .connected(oldInfo) = old, ConsoleIdentity(oldInfo) == ConsoleIdentity(info) {
            return nil
        }
        return info
    }

    /// Called from `connectedInfo`'s result. A no-op (and sends nothing)
    /// while the flag is off.
    public func connected(_ info: ConsoleXInfo) async {
        guard isEnabled() else { return }
        let identity = ConsoleIdentity(info)
        state = .checking(identity)

        switch setupStore.setup(for: identity) {
        case .notFound:
            state = .offerSetup(identity)
        case .needsRecheck:
            state = .needsRecheck
        case let .found(saved):
            guard let host = store.lastAttemptedAddress ?? ConsoleIPv4(info.ip) else {
                state = .readFailed(.transport(.failed("no console address")))
                return
            }
            let reader = store.channelReader()
            await runRead(saved: saved, info: info) { await reader.read(info, host: host) }
        }
    }

    /// The saved-vs-fresh comparison (pure in `ChannelSetupDiff`), plus the
    /// only side effect this type performs itself: persisting a
    /// colors-only change.
    public func evaluate(_ saved: SavedChannelSetup, info: ConsoleXInfo, read: ConsoleChannelReadResult) {
        let diff = ChannelSetupDiff.compare(saved: saved.setup, inventory: read.inventory, guesses: read.guesses)
        switch diff.outcome {
        case .unchanged:
            state = .applied(saved.setup)
        case let .updatedSilently(merged):
            try? setupStore.save(merged, ipHint: info.ip)
            state = .applied(merged)
        case .needsReview:
            state = .needsReview(info: info, read: read, diff: diff)
        }
    }

    /// Saves a confirmed setup (from the recheck review, or a fresh
    /// Discover) and marks it applied with the room mic un-suspended.
    public func adopt(_ setup: ConfirmedChannelSetup, ipHint: String?) {
        try? setupStore.save(setup, ipHint: ipHint)
        state = .applied(setup)
    }

    /// Stops an in-flight read and returns to `.idle`.
    public func cancel() {
        readTask?.cancel()
        readTask = nil
        state = .idle
    }

    /// Disconnect/consent revoked: drop any in-flight read and reset.
    public func reset() {
        cancel()
    }

    /// Settings' "Forget this console" (#1797): removes the saved setup and, if
    /// the current state belongs to that console, drops it so nothing keeps
    /// applying a forgotten setup. The next `connected(_:)` then offers setup.
    public func forget(_ console: ConsoleIdentity) {
        setupStore.forget(console)
        if stateConsole == console { cancel() }
    }

    /// The console `state` currently belongs to, or `nil` for the states
    /// with no identity (`.idle`, `.needsRecheck`, `.readFailed`).
    private var stateConsole: ConsoleIdentity? {
        switch state {
        case let .checking(id):
            id
        case let .offerSetup(id):
            id
        case let .applied(setup):
            setup.console
        case let .needsReview(info, _, _):
            ConsoleIdentity(info)
        case .idle, .needsRecheck, .readFailed:
            nil
        }
    }

    private func runRead(
        saved: SavedChannelSetup, info: ConsoleXInfo,
        _ operation: @escaping () async -> Result<ConsoleChannelReadResult, ConsoleChannelReadError>
    ) async {
        readTask?.cancel()
        let task = Task { @MainActor [weak self] in
            let result = await operation()
            guard let self else { return }
            switch result {
            case let .success(read):
                self.evaluate(saved, info: info, read: read)
            case .failure(.cancelled):
                self.state = .idle
            case let .failure(error):
                self.state = .readFailed(error)
            }
        }
        readTask = task
        await task.value
    }
}
