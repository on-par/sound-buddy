import Foundation
import Testing
@testable import SoundBuddyKit

private typealias State = ConsoleSessionState
private typealias Event = ConsoleSessionEvent
private typealias Effect = ConsoleSessionEffect

private let epsilon = 1e-9
private let foh = ConsoleIdentity(name: "FOH", model: "M32R")
private let other = ConsoleIdentity(name: "Monitor", model: "X32")

/// Drives one fake-clock step through the reducer and stores the result,
/// mirroring `ConsoleSessionModel.send` without the `@Observable` wrapper.
@discardableResult
private func run(_ state: inout State, _ event: Event, at time: TimeInterval) -> [Effect] {
    let (next, effects) = ConsoleSessionReducer.reduce(state, event, now: time)
    state = next
    return effects
}

/// `.connect` -> `.identityReceived` -> `.syncCompleted`, all at `time` —
/// the shortest path into `.live` with a snapshot and an open socket.
private func liveState(at time: TimeInterval, console: ConsoleIdentity = foh) -> State {
    var state = State.idle
    run(&state, .connect(console), at: time)
    run(&state, .identityReceived(console), at: time)
    run(&state, .syncCompleted, at: time)
    return state
}

@Suite struct ConsoleSessionReducerTests {
    // MARK: - Connect / disconnect

    @Test func connectOpensSocketAndSendsXInfo() {
        var state = State.idle
        let effects = run(&state, .connect(foh), at: 0)
        #expect(effects == [.openSocket, .sendXInfo])
        #expect(state.phase == .connecting)
        #expect(state.socketOpen)
        #expect(state.console == foh)
        #expect(abs((state.connectDeadline ?? 0) - ConsoleSessionTiming.connectTimeout) < epsilon)
    }

    @Test func connectWithoutNetworkGoesToNoNetworkWithoutOpeningSocket() {
        var state = State.idle
        run(&state, .networkLost, at: 0)
        let effects = run(&state, .connect(foh), at: 1)
        #expect(effects.isEmpty)
        #expect(state.phase == .noNetwork)
        #expect(!state.socketOpen)
    }

    @Test func disconnectClosesSocketAndReturnsToIdle() {
        var state = liveState(at: 0)
        let effects = run(&state, .disconnect, at: 1)
        #expect(effects == [.closeSocket])
        #expect(state == .idle)
    }

    @Test func noOpEventsReturnTheUnchangedState() {
        let before = State.idle
        var state = before
        let effects = run(&state, .statusReply, at: 5)
        #expect(effects.isEmpty)
        #expect(state == before)

        var live = liveState(at: 0)
        let unchanged = live
        let tickEffects = run(&live, .identityReceived(foh), at: 1) // wrong phase for identityReceived
        #expect(tickEffects.isEmpty)
        #expect(live == unchanged)
    }

    // MARK: - Heartbeat / reconnect (evidence: twoMissedStatusRepliesReconnect...)

    @Test func twoMissedStatusRepliesReconnectWithBackoffAndRecoverToLive() {
        var state = liveState(at: 0)

        // Keep push-silence (10 s) from degrading the link on its own — this
        // test is isolating the missed-/status/ path, not the push-silence one.
        run(&state, .pushReceived, at: 4)
        var effects = run(&state, .tick, at: 5)
        #expect(effects.contains(.sendStatus))
        #expect(state.phase == .live)

        run(&state, .pushReceived, at: 9)
        effects = run(&state, .tick, at: 10)
        #expect(effects.contains(.sendStatus))
        #expect(state.phase == .live)

        effects = run(&state, .tick, at: 15)
        #expect(effects.isEmpty)
        #expect(state.phase == .reconnecting)
        #expect(abs((state.retryAt ?? 0) - 16) < epsilon) // backoffDelay(attempt: 0) == 1
        #expect(state.socketOpen)

        // The first retry (backoffDelay(0) == 1) is already proven above by
        // retryAt == 16; this loop walks the remaining documented sequence.
        let expectedDelays: [TimeInterval] = [2, 4, 8, 10, 10]
        var sawOpenSocket = false
        for delay in expectedDelays {
            let retryAt = state.retryAt ?? -1
            let retryEffects = run(&state, .tick, at: retryAt)
            if retryEffects.contains(.openSocket) { sawOpenSocket = true }
            #expect(retryEffects.contains(.sendXInfo))
            #expect(state.phase == .connecting)

            let deadline = state.connectDeadline ?? -1
            run(&state, .tick, at: deadline)
            #expect(state.phase == .reconnecting)
            #expect(abs((state.retryAt ?? -1) - (deadline + delay)) < epsilon)
        }
        #expect(!sawOpenSocket)

        let recoverTime = state.retryAt ?? 0
        run(&state, .identityReceived(foh), at: recoverTime)
        #expect(state.phase == .syncing)
        run(&state, .syncCompleted, at: recoverTime)
        #expect(state.phase == .live)
    }

    // MARK: - Background / foreground (evidence: backgroundForThirtySeconds...)

    @Test func backgroundForThirtySecondsResyncsBeforeLiveAndStaysStale() {
        var state = liveState(at: 0)
        #expect(!state.isStale)

        var effects = run(&state, .enteredBackground, at: 10)
        #expect(effects == [.closeSocket])
        #expect(state.phase == .suspended)
        #expect(state.isStale)

        effects = run(&state, .enteredForeground, at: 40)
        #expect(effects == [.openSocket, .sendXInfo])
        #expect(state.phase == .connecting)
        #expect(state.isStale)

        effects = run(&state, .identityReceived(foh), at: 40)
        #expect(effects.contains(.requestFullResync))
        #expect(effects.contains(.sendXRemote))
        #expect(state.phase == .syncing)
        #expect(state.isStale)

        run(&state, .syncCompleted, at: 40)
        #expect(state.phase == .live)
        #expect(!state.isStale)
    }

    // MARK: - LiveDegraded (evidence: statusAnsweringWithoutPushesIsLiveDegraded...)

    @Test func statusAnsweringWithoutPushesIsLiveDegradedNeverReconnecting() {
        var state = liveState(at: 0)

        var time: TimeInterval = 0
        for _ in 0..<12 {
            time += 5
            let effects = run(&state, .tick, at: time)
            if effects.contains(.sendStatus) {
                run(&state, .statusReply, at: time)
            }
            #expect(state.phase != .reconnecting)
            if state.phase == .liveDegraded { break }
        }

        #expect(state.phase == .liveDegraded)
        #expect(state.phase.statusMessage == "Updates paused — too many apps connected")
        #expect(state.missedStatus == 0)

        run(&state, .pushReceived, at: time)
        #expect(state.phase == .live)
    }

    // MARK: - Wi-Fi (evidence: wifiOffShowsNoNetworkAndWifiBackReconnects...)

    @Test func wifiOffShowsNoNetworkAndWifiBackReconnectsWithoutInput() {
        var state = liveState(at: 0)

        var effects = run(&state, .networkLost, at: 5)
        #expect(effects == [.closeSocket])
        #expect(state.phase == .noNetwork)
        #expect(state.phase.statusMessage == "Join the console's Wi-Fi")
        #expect(!state.networkAvailable)

        effects = run(&state, .networkAvailable, at: 6)
        #expect(effects == [.openSocket, .sendXInfo])
        #expect(state.phase == .connecting)
        #expect(state.networkAvailable)
    }

    // MARK: - Identity mismatch / unreachable

    @Test func identityMismatchReturnsToConnectFlow() {
        var state = State.idle
        run(&state, .connect(foh), at: 0)
        let effects = run(&state, .identityReceived(other), at: 0.1)
        #expect(effects == [.closeSocket, .returnToConnectFlow(.identityMismatch)])
        #expect(state.phase == .idle)
        #expect(!state.socketOpen)
    }

    @Test func moreThanSixtySecondsUnreachableReturnsToConnectFlow() {
        var state = State.idle
        run(&state, .connect(foh), at: 0)

        var time: TimeInterval = 0
        var sawReturn = false
        for _ in 0..<80 {
            let deadline = state.connectDeadline ?? (state.retryAt ?? (time + 0.1))
            time = deadline
            let effects = run(&state, .tick, at: time)
            if effects.contains(where: { $0 == .returnToConnectFlow(.unreachable) }) {
                sawReturn = true
                break
            }
        }

        #expect(sawReturn)
        #expect(state.phase == .idle)
        #expect(!state.socketOpen)
        #expect(time - 0 > ConsoleSessionTiming.unreachableLimit)
    }

    @Test func moreThanSixtySecondsUnreachableWhileStillConnectingReturnsToConnectFlow() {
        var state = State.idle
        run(&state, .connect(foh), at: 0)
        #expect(state.phase == .connecting)

        let effects = run(&state, .tick, at: 61)
        #expect(effects == [.closeSocket, .returnToConnectFlow(.unreachable)])
        #expect(state.phase == .idle)
        #expect(!state.socketOpen)
    }

    // MARK: - Local network permission

    @Test func localNetworkDeniedHasNoRetriesOnTick() {
        var state = State.idle
        run(&state, .connect(foh), at: 0)
        var effects = run(&state, .localNetworkDenied, at: 0.5)
        #expect(effects == [.closeSocket])
        #expect(state.phase == .permissionDenied)

        effects = run(&state, .tick, at: 1000)
        #expect(effects.isEmpty)
        #expect(state.phase == .permissionDenied)

        effects = run(&state, .connect(foh), at: 1001)
        #expect(effects == [.openSocket, .sendXInfo])
        #expect(state.phase == .connecting)
    }

    // MARK: - socketFailed

    @Test func socketFailedWhileLiveReconnectsThenReopens() {
        var state = liveState(at: 0)

        var effects = run(&state, .socketFailed, at: 1)
        #expect(effects.isEmpty)
        #expect(state.phase == .reconnecting)
        #expect(!state.socketOpen)

        let retryAt = state.retryAt ?? 0
        effects = run(&state, .tick, at: retryAt)
        #expect(effects.contains(.openSocket))
        #expect(effects.contains(.sendXInfo))
        #expect(state.phase == .connecting)
        #expect(state.socketOpen)
    }

    @Test func socketFailedWhileIdleIsIgnored() {
        var state = State.idle
        let effects = run(&state, .socketFailed, at: 1)
        #expect(effects.isEmpty)
        #expect(state.phase == .idle)
    }

    // MARK: - xremote renew / target resync cadence

    @Test func xremoteRenewsEveryFiveSeconds() {
        var state = liveState(at: 0)
        var sendCount = 0
        var time: TimeInterval = 0
        for _ in 0..<3 {
            time += 5
            let effects = run(&state, .tick, at: time)
            if effects.contains(.sendXRemote) { sendCount += 1 }
            run(&state, .statusReply, at: time)
        }
        #expect(sendCount == 3)
    }

    @Test func resyncTargetFiresEveryThreeSecondsOnlyWithATarget() {
        var state = liveState(at: 0)

        let noTargetEffects = run(&state, .tick, at: 3)
        #expect(!noTargetEffects.contains { if case .resyncTarget = $0 { true } else { false } })

        run(&state, .targetOpened("/ch/01/eq/1"), at: 3)
        let effects = run(&state, .tick, at: 6)
        #expect(effects.contains(.resyncTarget("/ch/01/eq/1")))

        run(&state, .targetOpened(nil), at: 6)
        let afterClose = run(&state, .tick, at: 9)
        #expect(!afterClose.contains { if case .resyncTarget = $0 { true } else { false } })
    }

    // MARK: - Foreground while the network is down

    @Test func enteredForegroundWhileNetworkDownGoesToNoNetwork() {
        var state = liveState(at: 0)
        run(&state, .enteredBackground, at: 1)
        run(&state, .networkLost, at: 2)

        let effects = run(&state, .enteredForeground, at: 3)
        #expect(effects.isEmpty)
        #expect(state.phase == .noNetwork)
    }

    // MARK: - networkPath mapping

    @Test func networkPathMapsAllFourCombinations() {
        #expect(Event.networkPath(isSatisfied: true, usesWiFi: true) == .networkAvailable)
        #expect(Event.networkPath(isSatisfied: true, usesWiFi: false) == .networkLost)
        #expect(Event.networkPath(isSatisfied: false, usesWiFi: true) == .networkLost)
        #expect(Event.networkPath(isSatisfied: false, usesWiFi: false) == .networkLost)
    }

    // MARK: - backoffDelay

    @Test func backoffDelayDoublesPerAttemptUpToTheCap() {
        let expected: [TimeInterval] = [1, 2, 4, 8, 10, 10, 10]
        for (attempt, delay) in expected.enumerated() {
            #expect(abs(ConsoleSessionReducer.backoffDelay(attempt: attempt) - delay) < epsilon)
        }
    }

    @Test func backoffDelayFloorsNegativeAttemptsAndCapsHugeOnes() {
        #expect(abs(ConsoleSessionReducer.backoffDelay(attempt: -5) - 1) < epsilon)
        #expect(abs(ConsoleSessionReducer.backoffDelay(attempt: 1_000_000) - 10) < epsilon)
    }

    // MARK: - statusMessage, every case

    @Test func everyPhaseHasItsDocumentedStatusMessage() {
        #expect(ConsoleSessionPhase.idle.statusMessage == nil)
        #expect(ConsoleSessionPhase.connecting.statusMessage == "Connecting…")
        #expect(ConsoleSessionPhase.syncing.statusMessage == "Refreshing console values…")
        #expect(ConsoleSessionPhase.live.statusMessage == nil)
        #expect(ConsoleSessionPhase.liveDegraded.statusMessage == "Updates paused — too many apps connected")
        #expect(ConsoleSessionPhase.reconnecting.statusMessage == "Console not answering — reconnecting…")
        #expect(ConsoleSessionPhase.suspended.statusMessage == "Refreshing console values…")
        #expect(ConsoleSessionPhase.noNetwork.statusMessage == "Join the console's Wi-Fi")
        #expect(ConsoleSessionPhase.permissionDenied.statusMessage == "Allow Local Network access in Settings to reach the console")
    }

    @Test func isLinkUpOnlyForLiveAndLiveDegraded() {
        let upPhases: Set<ConsoleSessionPhase> = [.live, .liveDegraded]
        let all: [ConsoleSessionPhase] = [
            .idle, .connecting, .syncing, .live, .liveDegraded, .reconnecting, .suspended, .noNetwork, .permissionDenied,
        ]
        for phase in all {
            #expect(phase.isLinkUp == upPhases.contains(phase))
        }
    }

    // MARK: - ConsoleIdentity

    @Test func consoleIdentityIgnoresIpAndFirmware() {
        let a = OSCMessage("/xinfo", [.string("1.2.3.4"), .string("FOH"), .string("M32R"), .string("4.02")])
        let b = OSCMessage("/xinfo", [.string("5.6.7.8"), .string("FOH"), .string("M32R"), .string("4.05")])
        guard let infoA = ConsoleXInfo(reply: a), let infoB = ConsoleXInfo(reply: b) else {
            Issue.record("expected both /xinfo replies to parse")
            return
        }
        #expect(ConsoleIdentity(infoA) == ConsoleIdentity(infoB))
    }
}
