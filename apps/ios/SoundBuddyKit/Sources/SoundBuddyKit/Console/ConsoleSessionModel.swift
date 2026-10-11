import Foundation
import Observation

/// Thin `@Observable` wrapper around `ConsoleSessionReducer` (#1667),
/// following `AnalyzeModel`'s injected `now:` idiom. Owns no timers and no
/// socket itself: the future transport adapter (#1666) drives `.tick` from
/// its own clock and performs the returned effects against the real socket.
@Observable
public final class ConsoleSessionModel {
    public private(set) var state: ConsoleSessionState = .idle

    private let now: () -> TimeInterval
    private let perform: (ConsoleSessionEffect) -> Void

    public init(now: @escaping () -> TimeInterval, perform: @escaping (ConsoleSessionEffect) -> Void) {
        self.now = now
        self.perform = perform
    }

    public var phase: ConsoleSessionPhase { state.phase }
    public var isStale: Bool { state.isStale }
    public var statusMessage: String? { state.phase.statusMessage }

    /// Folds `event` through the reducer at the injected clock's current
    /// time, stores the resulting state, then forwards each effect to the
    /// injected performer in order.
    public func send(_ event: ConsoleSessionEvent) {
        let (nextState, effects) = ConsoleSessionReducer.reduce(state, event, now: now())
        state = nextState
        for effect in effects {
            perform(effect)
        }
    }
}
