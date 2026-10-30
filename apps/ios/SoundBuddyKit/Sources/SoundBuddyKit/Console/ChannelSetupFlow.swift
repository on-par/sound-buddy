import Foundation
import Observation

/// Every user-facing string for the channel-setup flow (#1781), the
/// `ConsoleConnectCopy` idiom.
public enum ChannelSetupCopy {
    public static let rowTitle = "Discover channel setup"
    public static let title = "Channel setup"
    public static let unsupportedTitle = "Not supported yet"
    public static let continueButton = "Continue"
    public static let retry = "Retry"

    public static func unsupportedDetail(model: String) -> String {
        "Sound Buddy can read X32 and M32 consoles. \(model) support is coming later."
    }

    public static func reading(count: Int) -> String {
        "Reading \(count) channels…"
    }

    public static func readSummary(count: Int) -> String {
        count == 1 ? "Read 1 channel" : "Read \(count) channels"
    }

    /// Always actionable: every case ends with what to do next.
    public static func readFailed(_ error: ConsoleChannelReadError) -> String {
        switch error {
        case .transport(.localNetworkDenied):
            ConsoleConnectCopy.permissionDenied
        case .transport(.noWiFi):
            "Join the console's Wi-Fi, then tap Retry."
        case let .transport(.failed(message)):
            "Couldn't read the channels (\(message)). Check the console is on, then tap Retry."
        case let .unsupportedModel(model):
            unsupportedDetail(model: model)
        case .cancelled:
            "Reading stopped. Tap Retry to read again."
        }
    }

    public static let checkTheseHeader = "Check these"
    public static let showUnused = "Show unused"
    public static let confirmAll = "Confirm all"
    public static let done = "Done"
    public static let roomMicHeader = "Room mic (optional)"
    public static let roomMicOther = "Other channel…"
    public static let roomMicNone = "None, use this iPad's mic"
    public static let rolePickerTitle = "Role"

    public static func looksRight(count: Int) -> String {
        "Looks right (\(count))"
    }

    /// `ChannelSetupReview.spokenName(for:)` with its first letter
    /// uppercased — "Kick drum", "Hi-hat", "Room mic".
    public static func roleTitle(_ role: ChannelRole) -> String {
        let spoken = ChannelSetupReview.spokenName(for: role)
        guard let first = spoken.first else { return spoken }
        return first.uppercased() + spoken.dropFirst()
    }

    /// "Confirmed" once the volunteer has confirmed the row, otherwise the
    /// guesser's own confidence bucket.
    public static func confidenceChip(for row: ChannelSetupReview.Row) -> String {
        guard row.origin == .confirmed else {
            switch row.confidence {
            case .high: return "High"
            case .medium: return "Medium"
            case .low: return "Low"
            }
        }
        return "Confirmed"
    }

    /// `.none` reads as `roomMicNone`; a candidate or other channel reads as
    /// that row's desk name, or `roomMicOther` if its id isn't a row at all.
    public static func roomMicChoiceLabel(_ choice: ChannelSetupReview.RoomMicChoice, in review: ChannelSetupReview) -> String {
        let id: ConsoleStripID
        switch choice {
        case .none:
            return roomMicNone
        case .candidate(let candidateID), .otherChannel(let candidateID):
            id = candidateID
        }
        guard let row = review.rows.first(where: { $0.id == id }) else { return roomMicOther }
        return row.strip.displayName
    }
}

/// Where the setup flow is. Derived, never set directly, except for the
/// handoff that `continueToChannels()` stores.
public enum ChannelSetupStep: Equatable, Sendable {
    case consent
    case connect
    case unsupported(ConsoleXInfo)
    case channels(ConsoleXInfo)
}

/// Step 2's own progress, driven by `ConsoleChannelReader` (#1791).
public enum ChannelReadState: Equatable, Sendable {
    case idle
    case reading(stripCount: Int)
    case done(ConsoleChannelReadResult)
    case failed(ConsoleChannelReadError)
}

/// Drives "Discover channel setup" (#1781): consent, then the existing
/// #1666 connect flow, then a model gate shared with step 2's reader, then
/// handoff to the channels step. Every side effect (transport, consent) is
/// injected through `store`/`consent` — this type adds none of its own.
@MainActor
@Observable
public final class ChannelSetupFlow {
    @ObservationIgnored public let store: ConsoleStore
    @ObservationIgnored private let consent: ConsoleConsentStore
    private var handedOff: ConsoleXInfo?
    public private(set) var channelRead: ChannelReadState = .idle
    /// Built from a finished read (or a loaded fixture); `nil` until then and
    /// cleared only by `restart()`. The review screen's whole model.
    public private(set) var review: ChannelSetupReview?
    @ObservationIgnored private var readTask: Task<Void, Never>?
    /// Set only by `beginRecheckReview`: the diff the current review is
    /// restricted to, so `finish(at:)` can merge the reviewed strips back
    /// into the saved setup instead of replacing it outright. Cleared by
    /// `restart()` and a fresh `readChannels()`.
    @ObservationIgnored private var recheckBase: ChannelSetupDiff?

    public init(store: ConsoleStore, consent: ConsoleConsentStore) {
        self.store = store
        self.consent = consent
    }

    public var step: ChannelSetupStep {
        guard consent.isGranted else { return .consent }
        if let handedOff { return .channels(handedOff) }
        if case let .connected(info) = store.phase, !Self.isSupportedModel(info.model) { return .unsupported(info) }
        return .connect
    }

    /// Shares step 2's model table so the gate and the reader never disagree.
    public static func isSupportedModel(_ model: String) -> Bool {
        ConsoleChannelInventory.stripCounts(forModel: model) != nil
    }

    /// Called only from ConsoleConsentView's Allow closure.
    public func grantConsent() {
        consent.grant()
    }

    /// Hands a connected, supported console to step 2. Returns nil, leaving
    /// the step unchanged, in any other state.
    @discardableResult
    public func continueToChannels() -> ConsoleXInfo? {
        guard case let .connected(info) = store.phase, Self.isSupportedModel(info.model) else { return nil }
        handedOff = info
        return info
    }

    /// Called on scenePhase → .active. After a Local Network denial this
    /// cancels the transport (dropping the waiting NWConnection) and goes
    /// back to manual entry, so the next Connect builds a fresh connection
    /// once the user has allowed access in Settings. A no-op in every other
    /// phase.
    public func foregrounded() {
        if store.phase == .permissionDenied { store.disconnect() }
    }

    /// Clears a previous handoff so re-opening the row starts at step 1.
    public func restart() {
        handedOff = nil
        cancelRead()
        channelRead = .idle
        review = nil
        recheckBase = nil
    }

    /// Opens the review restricted to a reconnect diff's changed strips
    /// (#1796): `info`/`read` hand off the step as if a fresh read had just
    /// finished, and the review itself only lists `diff.changed`. A no-op
    /// unless `diff.outcome` is `.needsReview`. When the room mic is
    /// suspended (its own strip changed), the old pick is pre-filled from
    /// `diff`'s merged setup — a candidate if the guesser still ranks it,
    /// otherwise as another channel — but still needs Done to confirm it.
    public func beginRecheckReview(info: ConsoleXInfo, read: ConsoleChannelReadResult, diff: ChannelSetupDiff) {
        guard case let .needsReview(_, _, merged) = diff.outcome else { return }

        cancelRead()
        handedOff = info
        channelRead = .done(read)
        review = ChannelSetupReview(
            console: ConsoleIdentity(info), inventory: read.inventory, guesses: read.guesses,
            roomMicCandidates: read.roomMicCandidates, restricting: diff.changed
        )
        recheckBase = diff

        if diff.roomMicSuspended, let roomMicID = merged.roomMic {
            updateReview { review in
                _ = review.selectRoomMic(.candidate(roomMicID)) || review.selectRoomMic(.otherChannel(roomMicID))
            }
        }
    }

    /// `true` for a normal (non-recheck) review, or a recheck review whose
    /// room mic was suspended; `false` for a recheck review that left the
    /// room mic untouched — nothing to re-pick.
    public var showsRoomMicPicker: Bool {
        guard let recheckBase else { return true }
        return recheckBase.roomMicSuspended
    }

    /// The walk, then (if anything is missing) one sweep, over the store's
    /// one socket. A no-op outside the `.channels` step.
    public func readChannels() async {
        guard case let .channels(info) = step else { return }
        recheckBase = nil
        guard let host = store.lastAttemptedAddress ?? ConsoleIPv4(info.ip) else {
            channelRead = .failed(.transport(.failed("no console address")))
            return
        }

        let stripCount = ConsoleChannelInventory.stripCounts(forModel: info.model)?.values.reduce(0, +) ?? 0
        channelRead = .reading(stripCount: stripCount)
        let reader = store.channelReader()
        await runRead(cancelledState: .idle, console: ConsoleIdentity(info)) { await reader.read(info, host: host) }
    }

    /// Resweeps only the previous read's missing strips. A no-op unless the
    /// previous read finished with something missing.
    public func retryMissingChannels() async {
        guard case let .done(previous) = channelRead, !previous.missing.isEmpty else { return }
        guard case let .channels(info) = step else { return }
        guard let host = store.lastAttemptedAddress ?? ConsoleIPv4(info.ip) else { return }

        channelRead = .reading(stripCount: previous.missing.count)
        let reader = store.channelReader()
        await runRead(cancelledState: .done(previous), console: ConsoleIdentity(info)) { await reader.retryMissing(previous, host: host) }
    }

    /// Stops an in-flight read (sheet closed / restart) without changing
    /// `channelRead` — the caller decides what state follows.
    public func cancelRead() {
        readTask?.cancel()
        readTask = nil
    }

    /// Cancels any previous read, runs `operation` in a fresh task and waits
    /// for it, so both entry points above resolve `channelRead` the same
    /// way: `.success` → `.done` (and a fresh `review`),
    /// `.failure(.cancelled)` → `cancelledState` (leaving `review`
    /// untouched), any other failure → `.failed` (same).
    private func runRead(
        cancelledState: ChannelReadState,
        console: ConsoleIdentity,
        _ operation: @escaping () async -> Result<ConsoleChannelReadResult, ConsoleChannelReadError>
    ) async {
        readTask?.cancel()
        let task = Task { @MainActor [weak self] in
            let result = await operation()
            guard let self else { return }
            switch result {
            case let .success(readResult):
                self.channelRead = .done(readResult)
                self.review = Self.makeReview(readResult, console: console)
            case .failure(.cancelled):
                self.channelRead = cancelledState
            case let .failure(error):
                self.channelRead = .failed(error)
            }
        }
        readTask = task
        await task.value
    }

    private static func makeReview(_ result: ConsoleChannelReadResult, console: ConsoleIdentity) -> ChannelSetupReview {
        ChannelSetupReview(
            console: console, inventory: result.inventory,
            guesses: result.guesses, roomMicCandidates: result.roomMicCandidates
        )
    }

    /// Applies `mutate` to the current review and writes the result back. A
    /// no-op before any review exists.
    public func updateReview(_ mutate: (inout ChannelSetupReview) -> Void) {
        guard var current = review else { return }
        mutate(&current)
        review = current
    }

    /// `nil` unless the review is done (nothing left to check, or the
    /// volunteer tapped Confirm all); otherwise the finished setup, with
    /// `date` injected by the caller. No side effect, no transport.
    ///
    /// Without a recheck base, this is just the review's own result. With
    /// one, the result is the recheck diff's merged setup with only the
    /// reviewed strips replaced — so strips the review never touched (because
    /// `beginRecheckReview` restricted it to `diff.changed`) keep the merged
    /// setup's values rather than being dropped — and the room mic taken
    /// from the review only when the diff had suspended it.
    public func finish(at date: Date) -> ConfirmedChannelSetup? {
        guard let recheckBase else { return review?.done(confirmedAt: date) }
        guard case let .needsReview(_, _, merged) = recheckBase.outcome else { return nil }
        guard let reviewed = review?.done(confirmedAt: date) else { return nil }

        let reviewedByID = Dictionary(uniqueKeysWithValues: reviewed.strips.map { ($0.id, $0) })
        let strips = merged.strips.map { reviewedByID[$0.id] ?? $0 }
        let roomMic = recheckBase.roomMicSuspended ? reviewed.roomMic : merged.roomMic

        return ConfirmedChannelSetup(console: merged.console, strips: strips, roomMic: roomMic, confirmedAt: date)
    }

    /// Debug/UI-test-only: seeds `channelRead`/`review` from a fixture
    /// (#1793) with no transport call at all — `step` still requires
    /// consent, same as a real read.
    public func loadFixture(_ fixture: ChannelSetupFixture) {
        cancelRead()
        handedOff = fixture.xInfo
        let result = fixture.readResult()
        channelRead = .done(result)
        review = Self.makeReview(result, console: ConsoleIdentity(fixture.xInfo))
    }
}
