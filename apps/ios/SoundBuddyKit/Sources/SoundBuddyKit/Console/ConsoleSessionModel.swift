import Foundation
import Observation

/// Thin `@Observable` wrapper around `ConsoleSessionReducer` (#1667),
/// following `AnalyzeModel`'s injected `now:` idiom. Owns no timers and no
/// socket itself: the future transport adapter (#1666) drives `.tick` from
/// its own clock and performs the returned effects against the real socket.
///
/// Gated by a required, injected `isConsentGranted` closure (#1665, ADR-0161
/// §8): while it returns `false`, `.connect` is ignored, every effect except
/// `.closeSocket`/`.returnToConnectFlow` is dropped, and no datagram (EQ
/// writer included) reaches `sendDatagram`. The gate is structural, not a
/// default — there is no way to construct a model that skips it.
@Observable
public final class ConsoleSessionModel {
    public private(set) var state: ConsoleSessionState = .idle

    /// Whether `eqWriter` currently hands out the session's `ConsoleEQWriter`
    /// (ADR-0161 §3's explicit arm/disarm). `false` both before the first
    /// `arm()` and after any `disarm()`.
    public private(set) var isArmed = false

    private let now: () -> TimeInterval
    private let isConsentGranted: () -> Bool
    private let perform: (ConsoleSessionEffect) -> Void
    private let sendDatagram: (Data) -> Void

    /// One writer per model, created on the first `arm()` and reused on
    /// every re-arm, so a target's pre-session snapshot survives a
    /// disarm/re-arm cycle.
    private var sessionWriter: ConsoleEQWriter?

    public init(
        now: @escaping () -> TimeInterval,
        isConsentGranted: @escaping () -> Bool,
        perform: @escaping (ConsoleSessionEffect) -> Void,
        sendDatagram: @escaping (Data) -> Void = { _ in }
    ) {
        self.now = now
        self.isConsentGranted = isConsentGranted
        self.perform = perform
        self.sendDatagram = { data in if isConsentGranted() { sendDatagram(data) } }
    }

    public var phase: ConsoleSessionPhase { state.phase }
    public var isStale: Bool { state.isStale }
    public var statusMessage: String? { state.phase.statusMessage }

    /// Folds `event` through the reducer at the injected clock's current
    /// time, stores the resulting state, then forwards each effect to the
    /// injected performer in order. Without consent, `.connect` is ignored
    /// outright (the phase never leaves `.idle`); every other event still
    /// reduces normally but only `.closeSocket`/`.returnToConnectFlow`
    /// effects reach `perform` — see `isAllowedWithoutConsent`.
    public func send(_ event: ConsoleSessionEvent) {
        let granted = isConsentGranted()
        if !granted, case .connect = event { return }
        let (nextState, effects) = ConsoleSessionReducer.reduce(state, event, now: now())
        state = nextState
        let allowed = granted ? effects : effects.filter(Self.isAllowedWithoutConsent)
        for effect in allowed {
            perform(effect)
        }
    }

    /// Exhaustive, no `default`: a new `ConsoleSessionEffect` case fails to
    /// compile here until someone decides whether it's safe without consent.
    private static func isAllowedWithoutConsent(_ effect: ConsoleSessionEffect) -> Bool {
        switch effect {
        case .closeSocket, .returnToConnectFlow:
            true
        case .openSocket, .sendXInfo, .sendStatus, .sendXRemote, .requestFullResync, .resyncTarget:
            false
        }
    }

    /// The app calls this when Settings > Revoke access fires: disarms (so
    /// `eqWriter` goes back to `nil`) then disconnects, which closes an open
    /// socket and returns the phase to `.idle`.
    public func consentRevoked() {
        disarm()
        send(.disconnect)
    }

    /// Arms the session for EQ writes. Returns `nil`, and leaves `isArmed`
    /// false, unless the link is currently up (`phase.isLinkUp`). The auto-
    /// relock triggers (ADR-0161 §3: idle timeout, background, reconnect,
    /// identity change, disconnect) are #1674's job, calling `disarm()`;
    /// this slice only exposes the explicit toggle. `ConsoleEQWriter` itself
    /// re-checks `isArmed` on every submit and every pump, so a writer
    /// reference retained across a later `disarm()` cannot write.
    @discardableResult
    public func arm() -> ConsoleEQWriter? {
        guard state.phase.isLinkUp else { return nil }
        isArmed = true
        if sessionWriter == nil {
            sessionWriter = ConsoleEQWriter(
                now: now,
                isArmed: { [weak self] in self?.isArmed ?? false },
                send: sendDatagram
            )
        }
        return sessionWriter
    }

    /// Disarms the session: `eqWriter` goes back to `nil`, and the writer
    /// itself stops sending (it re-checks `isArmed` on its own).
    public func disarm() {
        isArmed = false
    }

    /// The session's `ConsoleEQWriter`, or `nil` whenever `isArmed` is
    /// false.
    public var eqWriter: ConsoleEQWriter? { isArmed ? sessionWriter : nil }
}
