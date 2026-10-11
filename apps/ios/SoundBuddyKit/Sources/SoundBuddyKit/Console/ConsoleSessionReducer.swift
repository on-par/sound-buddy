import Foundation

/// Pure reducer for the console session (#1667), in the style of ADR-0079's
/// `reduceConsoleLink` (app/electron/ipc/console-link.ts) but with explicit
/// side effects returned as output instead of folded into booleans. `reduce`
/// has no timers, sockets or clocks inside it: time is the injected `now`,
/// and every deadline lives in `ConsoleSessionState` so tests can drive a
/// fake clock by passing numbers.
public enum ConsoleSessionReducer {
    /// Reconnect backoff: 1, 2, 4, 8, 10, 10, ... — doubling per attempt,
    /// capped at `backoffCap`. The attempt is clamped before shifting so an
    /// arbitrarily large (or negative) attempt can never overflow.
    public static func backoffDelay(attempt: Int) -> TimeInterval {
        let shiftLimit = 10 // 2^10 already saturates backoffCap many times over
        let safeAttempt = min(max(attempt, 0), shiftLimit)
        let delay = ConsoleSessionTiming.backoffBase * TimeInterval(1 << safeAttempt)
        return min(delay, ConsoleSessionTiming.backoffCap)
    }

    public static func reduce(
        _ state: ConsoleSessionState,
        _ event: ConsoleSessionEvent,
        now: TimeInterval
    ) -> (ConsoleSessionState, [ConsoleSessionEffect]) {
        var state = state
        var effects: [ConsoleSessionEffect] = []

        switch event {
        case let .connect(identity):
            state.console = identity
            state.hasSnapshot = false
            if !state.networkAvailable {
                closeIfOpen(&state, &effects)
                state.phase = .noNetwork
                clearTimers(&state)
                state.attempt = 0
                state.unreachableSince = nil
                break
            }
            beginConnecting(&state, &effects, now: now, unreachableSince: now)

        case .disconnect:
            closeIfOpen(&state, &effects)
            state = idleState(preservingNetworkAvailabilityFrom: state)

        case let .identityReceived(identity):
            guard state.phase == .connecting || state.phase == .reconnecting else { break }
            if state.console == identity {
                state.phase = .syncing
                state.unreachableSince = nil
                state.retryAt = nil
                state.connectDeadline = nil
                state.attempt = 0
                state.statusOutstanding = false
                state.missedStatus = 0
                effects.append(.sendXRemote)
                effects.append(.requestFullResync)
                state.nextStatusAt = now + ConsoleSessionTiming.statusInterval
                state.nextRenewAt = now + ConsoleSessionTiming.xremoteRenewInterval
                state.nextResyncAt = state.targetPath != nil ? now + ConsoleSessionTiming.targetResyncInterval : nil
            } else {
                closeIfOpen(&state, &effects)
                effects.append(.returnToConnectFlow(.identityMismatch))
                state = idleState(preservingNetworkAvailabilityFrom: state)
            }

        case .syncCompleted:
            guard state.phase == .syncing else { break }
            state.phase = .live
            state.hasSnapshot = true
            state.lastPushAt = now
            state.missedStatus = 0

        case .statusReply:
            guard state.socketOpen else { break }
            state.statusOutstanding = false
            state.missedStatus = 0

        case .pushReceived:
            state.lastPushAt = now
            if state.phase == .liveDegraded {
                state.phase = .live
            }

        case let .targetOpened(path):
            state.targetPath = path
            if path != nil, state.phase.isLinkUp {
                state.nextResyncAt = now
            }

        case .tick:
            switch state.phase {
            case .syncing, .live, .liveDegraded:
                tickLive(&state, &effects, now: now)
            case .connecting:
                tickConnecting(&state, &effects, now: now)
            case .reconnecting:
                tickReconnecting(&state, &effects, now: now)
            case .idle, .suspended, .noNetwork, .permissionDenied:
                break
            }

        case .socketFailed:
            state.socketOpen = false
            if isLinking(state.phase) {
                enterReconnecting(&state, now: now)
            }

        case .networkLost:
            state.networkAvailable = false
            switch state.phase {
            case .idle, .permissionDenied, .suspended:
                break
            default:
                closeIfOpen(&state, &effects)
                state.phase = .noNetwork
                clearTimers(&state)
            }

        case .networkAvailable:
            state.networkAvailable = true
            if state.phase == .noNetwork, state.console != nil {
                beginConnecting(&state, &effects, now: now, unreachableSince: now)
            }

        case .enteredBackground:
            guard state.phase != .idle, state.phase != .permissionDenied else { break }
            closeIfOpen(&state, &effects)
            state.phase = .suspended
            clearTimers(&state)

        case .enteredForeground:
            guard state.phase == .suspended else { break }
            if state.networkAvailable {
                beginConnecting(&state, &effects, now: now, unreachableSince: now)
            } else {
                state.phase = .noNetwork
            }

        case .localNetworkDenied:
            closeIfOpen(&state, &effects)
            state.phase = .permissionDenied
            clearTimers(&state)
        }

        return (state, effects)
    }

    // MARK: - Socket invariant

    private static func closeIfOpen(_ state: inout ConsoleSessionState, _ effects: inout [ConsoleSessionEffect]) {
        guard state.socketOpen else { return }
        effects.append(.closeSocket)
        state.socketOpen = false
    }

    private static func openIfClosed(_ state: inout ConsoleSessionState, _ effects: inout [ConsoleSessionEffect]) {
        guard !state.socketOpen else { return }
        effects.append(.openSocket)
        state.socketOpen = true
    }

    // MARK: - Shared transitions

    private static func clearTimers(_ state: inout ConsoleSessionState) {
        state.retryAt = nil
        state.connectDeadline = nil
        state.nextStatusAt = nil
        state.nextRenewAt = nil
        state.nextResyncAt = nil
        state.statusOutstanding = false
    }

    private static func idleState(preservingNetworkAvailabilityFrom state: ConsoleSessionState) -> ConsoleSessionState {
        var next = ConsoleSessionState.idle
        next.networkAvailable = state.networkAvailable
        return next
    }

    /// The one entry point into `.connecting` with a fresh attempt counter:
    /// `.connect`, Wi-Fi returning from `.noNetwork`, and foregrounding from
    /// `.suspended`. Reuses the socket if one is already open.
    private static func beginConnecting(
        _ state: inout ConsoleSessionState,
        _ effects: inout [ConsoleSessionEffect],
        now: TimeInterval,
        unreachableSince: TimeInterval
    ) {
        openIfClosed(&state, &effects)
        effects.append(.sendXInfo)
        state.phase = .connecting
        state.connectDeadline = now + ConsoleSessionTiming.connectTimeout
        state.unreachableSince = unreachableSince
        state.attempt = 0
        state.retryAt = nil
        state.nextStatusAt = nil
        state.nextRenewAt = nil
        state.nextResyncAt = nil
        state.statusOutstanding = false
        state.missedStatus = 0
    }

    /// Enters (or re-enters) `.reconnecting` using whatever `attempt` is
    /// already in `state` — callers that want a fresh backoff (the missed-
    /// status path) reset `attempt` themselves first. Never touches the
    /// socket: reconnect probes reuse the one that's already open.
    private static func enterReconnecting(_ state: inout ConsoleSessionState, now: TimeInterval) {
        state.phase = .reconnecting
        state.retryAt = now + backoffDelay(attempt: state.attempt)
        state.connectDeadline = nil
        state.nextStatusAt = nil
        state.nextRenewAt = nil
        state.nextResyncAt = nil
        state.statusOutstanding = false
    }

    private static func isLinking(_ phase: ConsoleSessionPhase) -> Bool {
        switch phase {
        case .connecting, .syncing, .live, .liveDegraded, .reconnecting:
            true
        case .idle, .suspended, .noNetwork, .permissionDenied:
            false
        }
    }

    /// Re-anchors a recurring deadline by one interval, snapping forward to
    /// `now + interval` instead of compounding a backlog when a tick arrives
    /// long after the deadline (e.g. the app was suspended).
    private static func advance(_ deadline: TimeInterval, by interval: TimeInterval, now: TimeInterval) -> TimeInterval {
        let next = deadline + interval
        return next >= now ? next : now + interval
    }

    // MARK: - Tick handling

    /// `.syncing`, `.live` and `.liveDegraded` all run the same status/renew/
    /// resync timers — they're armed together on `identityReceived` — but
    /// only `.live` can degrade to `.liveDegraded` on push silence.
    private static func tickLive(
        _ state: inout ConsoleSessionState,
        _ effects: inout [ConsoleSessionEffect],
        now: TimeInterval
    ) {
        if let nextStatusAt = state.nextStatusAt, now >= nextStatusAt {
            if state.statusOutstanding {
                state.missedStatus += 1
            }
            if state.missedStatus >= ConsoleSessionTiming.statusMissLimit {
                state.attempt = 0
                state.unreachableSince = now - ConsoleSessionTiming.statusInterval * TimeInterval(ConsoleSessionTiming.statusMissLimit)
                enterReconnecting(&state, now: now)
                return
            }
            effects.append(.sendStatus)
            state.statusOutstanding = true
            state.nextStatusAt = advance(nextStatusAt, by: ConsoleSessionTiming.statusInterval, now: now)
        }

        if let nextRenewAt = state.nextRenewAt, now >= nextRenewAt {
            effects.append(.sendXRemote)
            state.nextRenewAt = advance(nextRenewAt, by: ConsoleSessionTiming.xremoteRenewInterval, now: now)
        }

        if let nextResyncAt = state.nextResyncAt, now >= nextResyncAt, let path = state.targetPath {
            effects.append(.resyncTarget(path))
            state.nextResyncAt = advance(nextResyncAt, by: ConsoleSessionTiming.targetResyncInterval, now: now)
        }

        if state.phase == .live, let lastPushAt = state.lastPushAt,
           now - lastPushAt >= ConsoleSessionTiming.pushSilenceLimit {
            state.phase = .liveDegraded
        }
    }

    private static func tickConnecting(
        _ state: inout ConsoleSessionState,
        _ effects: inout [ConsoleSessionEffect],
        now: TimeInterval
    ) {
        if let unreachableSince = state.unreachableSince, now - unreachableSince > ConsoleSessionTiming.unreachableLimit {
            closeIfOpen(&state, &effects)
            effects.append(.returnToConnectFlow(.unreachable))
            state = idleState(preservingNetworkAvailabilityFrom: state)
            return
        }

        if let deadline = state.connectDeadline, now >= deadline {
            enterReconnecting(&state, now: now)
        }
    }

    private static func tickReconnecting(
        _ state: inout ConsoleSessionState,
        _ effects: inout [ConsoleSessionEffect],
        now: TimeInterval
    ) {
        if let unreachableSince = state.unreachableSince, now - unreachableSince > ConsoleSessionTiming.unreachableLimit {
            closeIfOpen(&state, &effects)
            effects.append(.returnToConnectFlow(.unreachable))
            state = idleState(preservingNetworkAvailabilityFrom: state)
            return
        }

        if let retryAt = state.retryAt, now >= retryAt {
            state.attempt += 1
            openIfClosed(&state, &effects)
            effects.append(.sendXInfo)
            state.phase = .connecting
            state.connectDeadline = now + ConsoleSessionTiming.connectTimeout
            state.retryAt = nil
        }
    }
}
