import Foundation
import Testing
@testable import SoundBuddyKit

/// Deterministic, seedable PRNG so the property test is reproducible across
/// runs — no `SystemRandomNumberGenerator` anywhere in this file.
private struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

private let foh = ConsoleIdentity(name: "FOH", model: "M32R")
private let altConsole = ConsoleIdentity(name: "Monitor", model: "X32")

private func randomEvent(_ rng: inout SplitMix64) -> ConsoleSessionEvent {
    switch Int.random(in: 0..<14, using: &rng) {
    case 0: .connect(foh)
    case 1: .connect(altConsole)
    case 2: .disconnect
    case 3: .identityReceived(foh)
    case 4: .identityReceived(altConsole)
    case 5: .syncCompleted
    case 6: .statusReply
    case 7: .pushReceived
    case 8: .targetOpened(Bool.random(using: &rng) ? "/ch/01/eq/1" : nil)
    case 9: .tick
    case 10: .socketFailed
    case 11: .networkLost
    case 12: .networkAvailable
    default: Bool.random(using: &rng) ? .enteredBackground : .enteredForeground
    }
}

@Suite struct ConsoleSessionPropertyTests {
    @Test func randomEventSequencesKeepOneSocketAndCapBackoff() {
        let seedCount: UInt64 = 200
        let stepsPerSeed = 300

        for seed in 0..<seedCount {
            var rng = SplitMix64(seed: seed)
            var state = ConsoleSessionState.idle
            var time: TimeInterval = 0

            for _ in 0..<stepsPerSeed {
                time += TimeInterval.random(in: 0..<4, using: &rng)
                let event = randomEvent(&rng)
                let wasOpen = state.socketOpen
                let (next, effects) = ConsoleSessionReducer.reduce(state, event, now: time)

                // socketOpen is a Bool, so "at most one socket" is structural
                // by construction; what's worth proving is that the effects
                // themselves only ever fire at the correct edge. `.socketFailed`
                // is the one path that closes the socket without a `.closeSocket`
                // effect (the socket is already gone), so it is exempt here.
                if effects.contains(.openSocket) {
                    #expect(!wasOpen, "openSocket emitted while a socket was already open (seed \(seed), event \(event))")
                }
                if effects.contains(.closeSocket) {
                    #expect(wasOpen, "closeSocket emitted while no socket was open (seed \(seed), event \(event))")
                }
                #expect(
                    !(effects.contains(.openSocket) && effects.contains(.closeSocket)),
                    "both openSocket and closeSocket emitted in the same step (seed \(seed), event \(event))"
                )

                if next.phase == .reconnecting, let retryAt = next.retryAt {
                    #expect(retryAt - time <= ConsoleSessionTiming.backoffCap + 1e-9, "retryAt exceeded the backoff cap (seed \(seed))")
                }

                state = next
            }
        }
    }
}
