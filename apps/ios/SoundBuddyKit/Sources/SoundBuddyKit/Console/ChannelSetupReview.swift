import Foundation

/// The channel-setup review screen's pure model (#1792): groups one finished
/// channel read into "Check these" / "Looks right" / hidden unused, records
/// what the volunteer confirmed, carries an optional single room-mic pick,
/// and on `done(confirmedAt:)` produces the `ConfirmedChannelSetup` value
/// #1785 will persist verbatim. No view, no socket, no desk write.
public struct ChannelSetupReview: Equatable, Sendable {
    /// The reason a strip without a guess (e.g. a seed excluded by a
    /// previous `restricting:` set, or a guesser bug) still needs a look.
    private static let noGuessReason = "No guess for this strip"

    /// The volunteer's single room-mic pick: one of the guesser's ranked
    /// candidates, some other channel entirely, or none at all (use this
    /// iPad's own mic).
    public enum RoomMicChoice: Equatable, Sendable {
        case candidate(ConsoleStripID)
        case otherChannel(ConsoleStripID)
        case none
    }

    /// One strip as the review screen shows it.
    public struct Row: Equatable, Sendable, Identifiable {
        public let id: ConsoleStripID
        public let strip: ConsoleChannelStrip
        public internal(set) var role: ChannelRole
        public let confidence: ChannelRoleConfidence
        public let reason: String
        public internal(set) var origin: ChannelRoleOrigin
        /// An unused or blank strip — never shown unless `showUnused`.
        public let isHidden: Bool
    }

    public let console: ConsoleIdentity
    /// Every visible-or-hidden row, in the inventory's walk order.
    public private(set) var rows: [Row]
    public var showUnused: Bool = false
    public private(set) var roomMic: RoomMicChoice
    /// The guesser's ranked room-mic candidates, mapped to row ids.
    public let roomMicCandidateIDs: [ConsoleStripID]
    private var didConfirmAll = false

    /// Builds the review from a finished read: `guesses` indexed by id
    /// (first occurrence wins), joined onto `inventory.stripIDs` in walk
    /// order — never guess order. A strip with no matching guess still gets
    /// a row (`.unknown`, `.low`, a fixed reason) so nothing a guesser bug
    /// drops ever silently disappears. `restricting`, when given, limits
    /// the rows to that id set (the seed #1785 will later diff against).
    public init(
        console: ConsoleIdentity,
        inventory: ConsoleChannelInventory,
        guesses: [ChannelRoleGuess],
        roomMicCandidates: [ChannelRoleGuess],
        restricting: [ConsoleStripID]? = nil
    ) {
        self.console = console

        var guessByConfigPath: [String: ChannelRoleGuess] = [:]
        for guess in guesses where guessByConfigPath[guess.id] == nil {
            guessByConfigPath[guess.id] = guess
        }

        var builtRows: [Row] = []
        for id in inventory.stripIDs {
            guard let strip = inventory.strips[id] else { continue }
            if let restricting, !restricting.contains(id) { continue }

            if let guess = guessByConfigPath[id.configPath] {
                let isHidden = guess.role == .unused || guess.basis == .blank
                builtRows.append(Row(
                    id: id, strip: strip, role: guess.role, confidence: guess.bucket,
                    reason: guess.reason, origin: .guessed, isHidden: isHidden
                ))
            } else {
                let isHidden = strip.name.trimmingCharacters(in: .whitespaces).isEmpty
                builtRows.append(Row(
                    id: id, strip: strip, role: .unknown, confidence: .low,
                    reason: ChannelSetupReview.noGuessReason, origin: .guessed, isHidden: isHidden
                ))
            }
        }
        rows = builtRows

        let idByConfigPath = Dictionary(uniqueKeysWithValues: builtRows.map { ($0.id.configPath, $0.id) })
        let mappedCandidates: [(id: ConsoleStripID, bucket: ChannelRoleConfidence)] = roomMicCandidates.compactMap { guess in
            guard let id = idByConfigPath[guess.id] else { return nil }
            return (id, guess.bucket)
        }
        roomMicCandidateIDs = mappedCandidates.map(\.id)

        if let first = mappedCandidates.first, first.bucket == .high || first.bucket == .medium {
            roomMic = .candidate(first.id)
        } else {
            roomMic = .none
        }
    }

    /// Rows a volunteer needs to look at: visible, still the guesser's own
    /// pick, and not already high confidence. Walk order.
    public var checkThese: [Row] {
        rows.filter { !$0.isHidden && $0.origin == .guessed && $0.confidence != .high }
    }

    /// Every visible row not in `checkThese` — high-confidence guesses plus
    /// anything the volunteer already confirmed.
    public var looksRight: [Row] {
        let needsChecking = Set(checkThese.map(\.id))
        return rows.filter { !$0.isHidden && !needsChecking.contains($0.id) }
    }

    /// `looksRight.count`, for the "Looks right (N)" section header.
    public var looksRightCount: Int { looksRight.count }

    /// Hidden rows, shown only once the volunteer asks for them.
    public var unused: [Row] {
        showUnused ? rows.filter(\.isHidden) : []
    }

    /// Sets `id`'s role and marks it confirmed. `false`, no change, if `id`
    /// matches no row.
    @discardableResult
    public mutating func setRole(_ role: ChannelRole, for id: ConsoleStripID) -> Bool {
        guard let index = rows.firstIndex(where: { $0.id == id }) else { return false }
        rows[index].role = role
        rows[index].origin = .confirmed
        return true
    }

    /// Confirms every visible row's current role without changing it.
    /// Hidden rows stay `.guessed`.
    public mutating func confirmAll() {
        for index in rows.indices where !rows[index].isHidden {
            rows[index].origin = .confirmed
        }
        didConfirmAll = true
    }

    /// Whether Done is enabled: nothing left to check, or the volunteer
    /// already confirmed everything at once.
    public var isDoneEnabled: Bool {
        checkThese.isEmpty || didConfirmAll
    }

    /// The room-mic picker's options: ranked candidates, then every other
    /// visible channel, then "None" last.
    public var roomMicOptions: [RoomMicChoice] {
        let candidateIDs = Set(roomMicCandidateIDs)
        var options = roomMicCandidateIDs.map { RoomMicChoice.candidate($0) }
        for row in rows where !row.isHidden && !candidateIDs.contains(row.id) {
            options.append(.otherChannel(row.id))
        }
        options.append(.none)
        return options
    }

    /// Accepts `.none` unconditionally; a candidate or other-channel pick
    /// only if its id is actually offered. `false`, no change, otherwise.
    @discardableResult
    public mutating func selectRoomMic(_ choice: RoomMicChoice) -> Bool {
        switch choice {
        case .none:
            roomMic = .none
            return true
        case .candidate(let id):
            guard roomMicCandidateIDs.contains(id) else { return false }
            roomMic = choice
            return true
        case .otherChannel(let id):
            guard rows.contains(where: { $0.id == id }) else { return false }
            roomMic = choice
            return true
        }
    }

    /// VoiceOver label for one row, or `nil` if `id` matches no row.
    public func accessibilityLabel(for id: ConsoleStripID) -> String? {
        guard let row = rows.first(where: { $0.id == id }) else { return nil }

        let kindWord: String
        switch row.id.kind {
        case .ch: kindWord = "Channel"
        case .auxin: kindWord = "Aux in"
        case .bus: kindWord = "Bus"
        }

        let confidencePhrase = row.origin == .confirmed ? "confirmed" : "\(row.confidence.rawValue) confidence"
        return "\(kindWord) \(row.id.number), \(row.strip.displayName), \(ChannelSetupReview.spokenName(for: row.role)), \(confidencePhrase)"
    }

    /// The spoken word(s) for a role, as read in the accessibility label.
    public static func spokenName(for role: ChannelRole) -> String {
        switch role {
        case .vocal: "vocal"
        case .speech: "speech"
        case .choir: "choir"
        case .kick: "kick drum"
        case .snare: "snare drum"
        case .tom: "tom"
        case .hiHat: "hi-hat"
        case .overheads: "overheads"
        case .bass: "bass"
        case .electricGuitar: "electric guitar"
        case .acousticGuitar: "acoustic guitar"
        case .keys: "keys"
        case .synth: "synth"
        case .tracks: "tracks"
        case .click: "click"
        case .guide: "guide"
        case .playback: "playback"
        case .roomMic: "room mic"
        case .talkback: "talkback"
        case .unused: "unused"
        case .unknown: "unknown"
        }
    }

    /// `nil` unless `isDoneEnabled`; otherwise the finished setup, with
    /// `confirmedAt` injected by the caller — this type never calls
    /// `Date()` itself.
    public func done(confirmedAt date: Date) -> ConfirmedChannelSetup? {
        guard isDoneEnabled else { return nil }

        let roomMicID: ConsoleStripID?
        switch roomMic {
        case .none:
            roomMicID = nil
        case .candidate(let id), .otherChannel(let id):
            roomMicID = id
        }

        let strips = rows.map {
            ConfirmedChannelSetup.Strip(
                id: $0.id, name: $0.strip.name, color: $0.strip.color,
                source: $0.strip.source, role: $0.role, origin: $0.origin
            )
        }
        return ConfirmedChannelSetup(console: console, strips: strips, roomMic: roomMicID, confirmedAt: date)
    }
}
