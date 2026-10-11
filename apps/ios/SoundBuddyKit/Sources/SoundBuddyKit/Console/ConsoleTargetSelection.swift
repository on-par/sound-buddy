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

/// The selected console EQ target, the scribble-strip catalog it is picked
/// from, and that target's last known EQ. `UserDefaults` and `phase` are
/// injected: the #1666 adapter forwards the live session's console
/// identity, `/node` reply lines, `/xremote` pushes and
/// `ConsoleSessionModel.phase` here; the DEBUG fixture seed does the same by
/// hand. `applyCoaching(using:)` and `undoAppliedCoaching(using:)` (#1676)
/// take an injected `ConsoleEQWriter?` so the one write path stays testable
/// here without an armed `ConsoleSessionModel` in the loop.
@Observable
public final class ConsoleTargetModel {
    /// Shown by the picker and the EQ panel when "Follow desk select" is on
    /// and the desk selects a strip we don't model (aux in, FX return, bus,
    /// matrix, Mono/Center).
    public static let unsupportedDeskSelectHint = "Not supported yet"

    private let defaults: UserDefaults

    public private(set) var console: ConsoleIdentity?
    public private(set) var catalog = ConsoleTargetCatalog()
    public private(set) var selected: ConsoleEQTarget = .mainLR
    public private(set) var eq: ConsoleEQ?
    public var phase: ConsoleSessionPhase = .idle

    /// The coaching hint behind the current ghost band (#1671), in memory
    /// only — never persisted. Non-nil only while it's showing; `eqPanel`
    /// only turns it into a suggestion while Main LR is selected.
    public private(set) var coachingEvent: CoachingEvent?

    /// The last coaching suggestion Apply actually wrote to Main LR (#1676),
    /// in memory only — never persisted. Non-nil only until `undoAppliedCoaching`
    /// reverts it or `consoleChanged` clears it for a new identity.
    public private(set) var appliedCoaching: ConsoleCoachingApplied?

    /// Opt-in, in-memory only (never persisted): when on, a `/-stat/selidx`
    /// push from the desk switches `selected` to the matching strip, or
    /// sets `deskSelectHint` when the strip isn't one we model.
    public private(set) var followDeskSelect = false
    public private(set) var deskSelectHint: String?

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// Switching to a different console identity resets the catalog (the
    /// next resync repopulates it) and the EQ (the next resync repopulates
    /// it too). Re-reporting the same identity (a reconnect) does nothing,
    /// so names and values survive the drop while the next walk refreshes
    /// them. `followDeskSelect` is a session preference and survives the
    /// switch; any stale hint from the previous console does not.
    public func consoleChanged(_ console: ConsoleIdentity?) {
        guard console != self.console else { return }
        self.console = console
        catalog = ConsoleTargetCatalog()
        selected = console.map { ConsoleTargetMemory.load(for: $0, in: defaults) } ?? .mainLR
        eq = nil
        deskSelectHint = nil
        coachingEvent = nil
        appliedCoaching = nil
    }

    public func ingest(nodeLine: String) {
        catalog.apply(nodeLine: nodeLine)
        fold { $0.apply(nodeLine: nodeLine) }
    }

    /// Folds one decoded `/xremote` push into the selected target's EQ,
    /// unless it is a `/-stat/selidx` desk-select push — those are consumed
    /// by `followDesk` instead and never folded into the EQ.
    public func ingest(push message: OSCMessage) {
        if let deskSelect = ConsoleDeskSelect(push: message) {
            followDesk(deskSelect)
            return
        }
        fold { $0.apply(push: message) }
    }

    /// Ignored unless `followDeskSelect` is on. A supported strip is
    /// selected immediately (clearing the hint); an unsupported one keeps
    /// the current target and sets the hint instead.
    private func followDesk(_ deskSelect: ConsoleDeskSelect) {
        guard followDeskSelect else { return }
        switch deskSelect {
        case .target(let target):
            select(target)
        case .unsupported:
            deskSelectHint = Self.unsupportedDeskSelectHint
        }
    }

    /// Turning follow off also clears any stale "Not supported yet" hint.
    public func setFollowDeskSelect(_ on: Bool) {
        followDeskSelect = on
        if !on {
            deskSelectHint = nil
        }
    }

    /// `body` runs against a copy seeded from the current `eq` (or a flat
    /// seed for `selected`, if there is none yet); the copy replaces `eq`
    /// only when `body` returns true, so a rejected line or push never
    /// partially applies.
    private func fold(_ body: (inout ConsoleEQ) -> Bool) {
        var next = eq ?? ConsoleEQ.flat(for: selected)
        if body(&next) {
            eq = next
        }
    }

    /// Ignores targets outside the 33-entry catalog; persists the pick
    /// under the current console's key, when there is one. Selecting a
    /// different target clears the EQ, since the new target's values are
    /// unknown until the next read. A manual pick (or a followed desk pick,
    /// which also calls this) always clears any stale desk-select hint.
    /// Picking anything other than Main LR also clears the coaching ghost
    /// (#1671) — it only ever applies to Main LR.
    public func select(_ target: ConsoleEQTarget) {
        guard ConsoleTargetCatalog.targets.contains(target) else { return }
        if target != selected {
            eq = nil
        }
        selected = target
        deskSelectHint = nil
        if target != .mainLR {
            coachingEvent = nil
        }
        if let console {
            ConsoleTargetMemory.store(target, for: console, in: defaults)
        }
    }

    /// Selects Main LR (the picker's own path, so the pick is remembered for
    /// this console) and stores `event` as the ghost's source (#1671). The
    /// view opens the EQ panel after calling this — on iPhone a sheet, on
    /// iPad landscape the already-visible side column just updates.
    public func showCoaching(_ event: CoachingEvent) {
        select(.mainLR)
        coachingEvent = event
    }

    /// Removes the ghost without changing the selected target.
    public func clearCoaching() {
        coachingEvent = nil
    }

    /// Writes the current ghost suggestion to Main LR through `writer`
    /// (#1676). A no-op, sending nothing, unless Main LR is selected, its EQ
    /// has been read, and a suggestion is showing. With no armed `writer`
    /// (nil, or disarmed), throws `.disarmed` and sends nothing — `submit`
    /// itself re-checks armed state. Records Main LR's pre-session snapshot
    /// first when the writer still needs one, since `submit` would otherwise
    /// throw `.snapshotMissing`. Only after `submit` succeeds does this fold
    /// the written band into `eq` (optimistic — a later desk push still
    /// overwrites it, ADR-0161 §7), record `appliedCoaching`, and clear the
    /// ghost.
    public func applyCoaching(using writer: ConsoleEQWriter?) throws(ConsoleEQWriteError) {
        guard selected == .mainLR, let eq, let suggestion = eqPanel.coaching else { return }
        guard let writer else { throw .disarmed }

        let applied = ConsoleCoachingMapper.applied(suggestion, to: eq)
        if writer.needsSnapshot(for: .mainLR) {
            writer.recordSnapshot(eq)
        }
        try writer.submit(.band(applied.bandNumber, suggestion.band, gestureStart: applied.prior), on: .mainLR)

        var next = eq
        next.bands[applied.bandIndex] = applied.written
        self.eq = next
        appliedCoaching = applied
        coachingEvent = nil
    }

    /// Writes `appliedCoaching`'s prior band back to Main LR through
    /// `writer`, the exact inverse of the Apply that produced it. A no-op
    /// when nothing is applied. With no armed `writer`, throws `.disarmed`
    /// and leaves `appliedCoaching` so the Undo stays visible. Only restores
    /// `eq` locally while Main LR is still selected and read — Undo always
    /// targets `.mainLR` regardless of what's currently selected.
    public func undoAppliedCoaching(using writer: ConsoleEQWriter?) throws(ConsoleEQWriteError) {
        guard let applied = appliedCoaching else { return }
        guard let writer else { throw .disarmed }

        try writer.submit(.band(applied.bandNumber, applied.prior, gestureStart: applied.written), on: .mainLR)

        if selected == .mainLR, var current = eq {
            current.bands[applied.bandIndex] = applied.prior
            eq = current
        }
        appliedCoaching = nil
    }

    public var chipStatus: ConsoleChipStatus {
        ConsoleChipStatus(phase: phase)
    }

    /// e.g. "M32R · Main LR"; `nil` without a console.
    public var chipTitle: String? {
        guard let console else { return nil }
        return "\(console.model) · \(catalog.label(for: selected).displayName)"
    }

    /// The read-only EQ panel's full render state for the selected target.
    /// The coaching suggestion is only ever derived while Main LR is
    /// selected and its EQ has been read (#1671) — picking Main LR from a
    /// channel clears `eq` until the next read, so the ghost appears once
    /// the value arrives rather than racing it.
    public var eqPanel: ConsoleEQPanelState {
        let coaching: ConsoleCoachingSuggestion? = selected == .mainLR
            ? coachingEvent.flatMap { event in eq.flatMap { ConsoleCoachingMapper.suggestion(for: event, mainLR: $0) } }
            : nil
        return ConsoleEQPanelState(target: selected, eq: eq, phase: phase, coaching: coaching)
    }
}
