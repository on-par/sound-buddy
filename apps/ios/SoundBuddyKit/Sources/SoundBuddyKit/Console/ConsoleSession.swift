import Foundation

/// Named timing constants for ConsoleSessionReducer (#1667): every interval,
/// limit and cap the state machine uses, named so none of it is a magic
/// number at the call site.
public enum ConsoleSessionTiming {
    /// How often a live/syncing session sends `/status` (the heartbeat).
    public static let statusInterval: TimeInterval = 5
    /// Consecutive unanswered `/status` sends before the session reconnects.
    public static let statusMissLimit = 2
    /// How often a live/syncing session renews its `/xremote` subscription.
    public static let xremoteRenewInterval: TimeInterval = 5
    /// The `/xremote` subscription's lifetime (ADR-0063): no push for this
    /// long while live means the four-client refusal, not an offline console.
    public static let pushSilenceLimit: TimeInterval = 10
    /// How often the open `/node` target is re-read while live.
    public static let targetResyncInterval: TimeInterval = 3
    /// ADR-0060's 350 ms probe timeout, times 3 retries.
    public static let connectTimeout: TimeInterval = 1.05
    /// Reconnect backoff's first delay and per-attempt base.
    public static let backoffBase: TimeInterval = 1
    /// Reconnect backoff never waits longer than this between attempts.
    public static let backoffCap: TimeInterval = 10
    /// Total time unreachable (connecting or reconnecting) before giving up
    /// and returning to the connect flow.
    public static let unreachableLimit: TimeInterval = 60
}

/// A console's identity for session matching: name + model only, ignoring
/// ip/firmware so a DHCP lease change or a firmware bump never looks like a
/// different console walked onto the network.
public struct ConsoleIdentity: Equatable, Sendable {
    public let name: String
    public let model: String

    public init(name: String, model: String) {
        self.name = name
        self.model = model
    }

    public init(_ info: ConsoleXInfo) {
        name = info.name
        model = info.model
    }
}

/// Why the session gave up and sent the user back to the connect flow.
public enum ConsoleReturnReason: Equatable, Sendable {
    case identityMismatch
    case unreachable
}

/// The console link's observable phase. `isLinkUp` (live/liveDegraded) is the
/// only phase pair where the channel is actually flowing; every other phase
/// is some form of "not yet" or "not now". Mirrors ADR-0079's rule that the
/// four-client /xremote refusal reads as degraded, never offline.
public enum ConsoleSessionPhase: Equatable, Sendable {
    case idle
    case connecting
    case syncing
    case live
    case liveDegraded
    case reconnecting
    case suspended
    case noNetwork
    case permissionDenied

    /// The user-facing status line, or nil when the phase needs none.
    public var statusMessage: String? {
        switch self {
        case .noNetwork: "Join the console's Wi-Fi"
        case .liveDegraded: "Updates paused — too many apps connected"
        case .reconnecting: "Console not answering — reconnecting…"
        case .suspended, .syncing: "Refreshing console values…"
        case .permissionDenied: "Allow Local Network access in Settings to reach the console"
        case .connecting: "Connecting…"
        case .live, .idle: nil
        }
    }

    /// True only while the channel is actually flowing (live or degraded).
    public var isLinkUp: Bool {
        self == .live || self == .liveDegraded
    }
}

/// The ConsoleSessionReducer's full fold state (#1667). A value type: the
/// reducer only ever produces a new one, never mutates in place from the
/// outside.
public struct ConsoleSessionState: Equatable, Sendable {
    public var phase: ConsoleSessionPhase
    public var console: ConsoleIdentity?
    /// Tracks the one long-lived socket's lifecycle. `.openSocket` is only
    /// ever emitted while this is false, and `.closeSocket` only while it is
    /// true — the structural invariant behind "at most one socket is open".
    public var socketOpen: Bool
    /// Whether a full snapshot has ever been synced this session; drives
    /// `isStale` once the link drops without a fresh resync.
    public var hasSnapshot: Bool
    public var networkAvailable: Bool
    /// Reconnect attempt counter, used by `backoffDelay(attempt:)`.
    public var attempt: Int
    public var retryAt: TimeInterval?
    public var connectDeadline: TimeInterval?
    public var nextStatusAt: TimeInterval?
    public var nextRenewAt: TimeInterval?
    public var nextResyncAt: TimeInterval?
    public var statusOutstanding: Bool
    public var missedStatus: Int
    public var lastPushAt: TimeInterval?
    public var unreachableSince: TimeInterval?
    /// The open `/node` target path, re-read every `targetResyncInterval`.
    public var targetPath: String?

    public init(
        phase: ConsoleSessionPhase,
        console: ConsoleIdentity?,
        socketOpen: Bool,
        hasSnapshot: Bool,
        networkAvailable: Bool,
        attempt: Int,
        retryAt: TimeInterval?,
        connectDeadline: TimeInterval?,
        nextStatusAt: TimeInterval?,
        nextRenewAt: TimeInterval?,
        nextResyncAt: TimeInterval?,
        statusOutstanding: Bool,
        missedStatus: Int,
        lastPushAt: TimeInterval?,
        unreachableSince: TimeInterval?,
        targetPath: String?
    ) {
        self.phase = phase
        self.console = console
        self.socketOpen = socketOpen
        self.hasSnapshot = hasSnapshot
        self.networkAvailable = networkAvailable
        self.attempt = attempt
        self.retryAt = retryAt
        self.connectDeadline = connectDeadline
        self.nextStatusAt = nextStatusAt
        self.nextRenewAt = nextRenewAt
        self.nextResyncAt = nextResyncAt
        self.statusOutstanding = statusOutstanding
        self.missedStatus = missedStatus
        self.lastPushAt = lastPushAt
        self.unreachableSince = unreachableSince
        self.targetPath = targetPath
    }

    /// The session's rest state: no console, no socket, network assumed
    /// available until told otherwise.
    public static let idle = ConsoleSessionState(
        phase: .idle,
        console: nil,
        socketOpen: false,
        hasSnapshot: false,
        networkAvailable: true,
        attempt: 0,
        retryAt: nil,
        connectDeadline: nil,
        nextStatusAt: nil,
        nextRenewAt: nil,
        nextResyncAt: nil,
        statusOutstanding: false,
        missedStatus: 0,
        lastPushAt: nil,
        unreachableSince: nil,
        targetPath: nil
    )

    /// True once a snapshot exists but the link is not currently up — the UI
    /// dims values rather than clearing them while the session recovers.
    public var isStale: Bool { hasSnapshot && !phase.isLinkUp }
}

/// Inputs the reducer folds. `tick` is the only time-driven event: there are
/// no timers inside the reducer, so a clock adapter sends `.tick` and every
/// deadline lives in `ConsoleSessionState`.
public enum ConsoleSessionEvent: Equatable, Sendable {
    case connect(ConsoleIdentity)
    case disconnect
    case identityReceived(ConsoleIdentity)
    case syncCompleted
    case statusReply
    case pushReceived
    case targetOpened(String?)
    case tick
    case socketFailed
    case networkLost
    case networkAvailable
    case enteredBackground
    case enteredForeground
    case localNetworkDenied

    /// Maps an `NWPath` summary to a network event for the future
    /// `NWPathMonitor` adapter (#1666 follow-up): available only when the
    /// path is satisfied and uses Wi-Fi, since the console is LAN-only.
    public static func networkPath(isSatisfied: Bool, usesWiFi: Bool) -> ConsoleSessionEvent {
        (isSatisfied && usesWiFi) ? .networkAvailable : .networkLost
    }
}

/// Side effects the reducer returns as values rather than performing. The
/// adapter executes these against the real socket/clock; the reducer itself
/// never touches either.
public enum ConsoleSessionEffect: Equatable, Sendable {
    case openSocket
    case closeSocket
    case sendXInfo
    case sendStatus
    case sendXRemote
    case requestFullResync
    case resyncTarget(String)
    case returnToConnectFlow(ConsoleReturnReason)
}
