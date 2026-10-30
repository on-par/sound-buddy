import Foundation

/// On reconnect, compares a saved `ConfirmedChannelSetup` (5a) against a
/// fresh `ConsoleChannelInventory` + fresh `ChannelRoleGuess`es (4a) and
/// tells the volunteer only what changed on the desk: nothing, colors only
/// (apply silently), or a specific list of name/source changes to review —
/// with the room mic suspended if its own strip changed, and strips that
/// didn't answer reported as missing rather than changed. Pure, read-only,
/// layout-agnostic: no socket, no desk write, no `Date()`. Side effects
/// (desk read, save, UI) stay in 4a/5a/5c (#1796).
public struct ChannelSetupDiff: Equatable, Sendable {
    public enum Outcome: Equatable, Sendable {
        case unchanged
        case updatedSilently(ConfirmedChannelSetup)
        case needsReview(changed: [ConsoleStripID], reguessed: [ChannelRoleGuess], merged: ConfirmedChannelSetup)
    }

    public let outcome: Outcome
    /// Saved strips the fresh read has no complete strip for, walk order.
    /// Never also in `changed`.
    public let missing: [ConsoleStripID]
    /// True only when the saved room-mic strip's name or source changed.
    public let roomMicSuspended: Bool
    /// e.g. "Room mic Ch 16 is now 'Kick 2'"; nil unless `roomMicSuspended`.
    public let roomMicNotice: String?

    /// `.needsReview`'s list, else empty.
    public var changed: [ConsoleStripID] {
        guard case .needsReview(let changed, _, _) = outcome else { return [] }
        return changed
    }

    /// `Self.bannerText(changedCount:)` for this diff's own `changed` count.
    public var bannerText: String? {
        ChannelSetupDiff.bannerText(changedCount: changed.count)
    }

    /// `nil` once there is nothing to review; otherwise an actionable
    /// desk-changed banner. Mirrors `ConsoleChannelInventory.missingSummary`'s
    /// switch shape.
    public static func bannerText(changedCount: Int) -> String? {
        switch changedCount {
        case ..<1:
            return nil
        case 1:
            return "1 channel changed on the desk since your setup — Review"
        default:
            return "\(changedCount) channels changed on the desk since your setup — Review"
        }
    }

    /// Walks `inventory.stripIDs` (never `saved.strips`' own order) joining
    /// `saved` and `guesses` onto it by id/`configPath` (first occurrence
    /// wins, same rule as `ChannelSetupReview.init`): a strip that didn't
    /// answer is `missing`, a strip whose name or routed source differs (or
    /// is new to the setup) is `changed` and re-guessed, and a color-only
    /// difference is folded into `merged` without being reported.
    public static func compare(saved: ConfirmedChannelSetup, inventory: ConsoleChannelInventory, guesses: [ChannelRoleGuess]) -> ChannelSetupDiff {
        var savedByID: [ConsoleStripID: ConfirmedChannelSetup.Strip] = [:]
        for strip in saved.strips where savedByID[strip.id] == nil {
            savedByID[strip.id] = strip
        }

        var guessByConfigPath: [String: ChannelRoleGuess] = [:]
        for guess in guesses where guessByConfigPath[guess.id] == nil {
            guessByConfigPath[guess.id] = guess
        }

        var mergedStrips: [ConfirmedChannelSetup.Strip] = []
        var changed: [ConsoleStripID] = []
        var reguessed: [ChannelRoleGuess] = []
        var missing: [ConsoleStripID] = []
        var anyColorChange = false

        func mergeAsChanged(_ id: ConsoleStripID, fresh: ConsoleChannelStrip) {
            let guess = guessByConfigPath[id.configPath]
            mergedStrips.append(ConfirmedChannelSetup.Strip(
                id: id, name: fresh.name, color: fresh.color, source: fresh.source,
                role: guess?.role ?? .unknown, origin: .guessed
            ))
            changed.append(id)
            if let guess { reguessed.append(guess) }
        }

        for id in inventory.stripIDs {
            let freshStrip = inventory.strips[id]
            let savedStrip = savedByID[id]

            switch (freshStrip, savedStrip) {
            case (nil, let saved?):
                missing.append(id)
                mergedStrips.append(saved)
            case (nil, nil):
                continue
            case (let fresh?, nil):
                mergeAsChanged(id, fresh: fresh)
            case (let fresh?, let saved?):
                if fresh.name != saved.name || fresh.source != saved.source {
                    mergeAsChanged(id, fresh: fresh)
                } else {
                    if fresh.color != saved.color { anyColorChange = true }
                    mergedStrips.append(ConfirmedChannelSetup.Strip(
                        id: saved.id, name: saved.name, color: fresh.color,
                        source: saved.source, role: saved.role, origin: saved.origin
                    ))
                }
            }
        }

        let inventoryIDs = Set(inventory.stripIDs)
        var seenExtraIDs: Set<ConsoleStripID> = []
        for strip in saved.strips where !inventoryIDs.contains(strip.id) {
            guard seenExtraIDs.insert(strip.id).inserted else { continue }
            missing.append(strip.id)
            mergedStrips.append(strip)
        }

        let merged = ConfirmedChannelSetup(console: saved.console, strips: mergedStrips, roomMic: saved.roomMic, confirmedAt: saved.confirmedAt)

        var roomMicSuspended = false
        var roomMicNotice: String?
        if let roomMicID = saved.roomMic, changed.contains(roomMicID), let freshRoomMic = inventory.strips[roomMicID] {
            roomMicSuspended = true
            let nameChanged = savedByID[roomMicID].map { $0.name != freshRoomMic.name } ?? true
            if nameChanged {
                roomMicNotice = "Room mic \(roomMicID.fallbackName) is now '\(freshRoomMic.displayName)'"
            } else {
                roomMicNotice = "Room mic \(roomMicID.fallbackName) ('\(freshRoomMic.displayName)') has a new input source"
            }
        }

        let outcome: Outcome
        if !changed.isEmpty {
            outcome = .needsReview(changed: changed, reguessed: reguessed, merged: merged)
        } else if anyColorChange {
            outcome = .updatedSilently(merged)
        } else {
            outcome = .unchanged
        }

        return ChannelSetupDiff(outcome: outcome, missing: missing, roomMicSuspended: roomMicSuspended, roomMicNotice: roomMicNotice)
    }
}
