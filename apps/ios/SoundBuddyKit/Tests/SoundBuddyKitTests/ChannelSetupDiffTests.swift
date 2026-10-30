import Foundation
import Testing
@testable import SoundBuddyKit

private func confirmedSetup(_ fixture: ChannelSetupFixture, at date: Date = Date(timeIntervalSince1970: 1_700_000_000)) throws -> ConfirmedChannelSetup {
    let read = fixture.readResult()
    var review = ChannelSetupReview(console: ConsoleIdentity(fixture.xInfo), inventory: read.inventory, guesses: read.guesses, roomMicCandidates: read.roomMicCandidates)
    review.confirmAll()
    return try #require(review.done(confirmedAt: date))
}

private func freshRead(_ fixture: ChannelSetupFixture, edit: (inout [String]) -> Void = { _ in }) -> (ConsoleChannelInventory, [ChannelRoleGuess]) {
    var lines = fixture.nodeLines
    edit(&lines)
    guard var inventory = ConsoleChannelInventory(model: fixture.model) else {
        preconditionFailure("ChannelSetupFixture.model (\(fixture.model)) must be in ConsoleChannelInventory's model table")
    }
    for line in lines {
        inventory.apply(nodeLine: line)
    }
    let guesses = ChannelRoleGuesser.bundled().guess(ConsoleChannelReadResult.roleInputs(from: inventory))
    return (inventory, guesses)
}

private func closingQuoteIndex(in line: String) -> String.Index? {
    guard let openQuote = line.firstIndex(of: "\"") else { return nil }
    return line[line.index(after: openQuote)...].firstIndex(of: "\"")
}

private func rename(_ lines: inout [String], id: ConsoleStripID, to newName: String) {
    guard let index = lines.firstIndex(where: { $0.hasPrefix(id.configPath + " ") }) else { return }
    guard let openQuote = lines[index].firstIndex(of: "\""), let closeQuote = closingQuoteIndex(in: lines[index]) else { return }
    lines[index].replaceSubrange(lines[index].index(after: openQuote)..<closeQuote, with: newName)
}

private func recolor(_ lines: inout [String], id: ConsoleStripID, to color: ConsoleChannelColor) {
    guard let index = lines.firstIndex(where: { $0.hasPrefix(id.configPath + " ") }) else { return }
    let line = lines[index]
    guard let closeQuote = closingQuoteIndex(in: line) else { return }
    let head = line[...closeQuote]
    var tokens = line[line.index(after: closeQuote)...].split(separator: " ").map(String.init)
    guard tokens.count >= 2 else { return }
    tokens[1] = color.rawValue
    lines[index] = head + " " + tokens.joined(separator: " ")
}

private func resource(_ lines: inout [String], id: ConsoleStripID, to sourceRaw: Int) {
    guard let index = lines.firstIndex(where: { $0.hasPrefix(id.configPath + " ") }) else { return }
    let line = lines[index]
    guard let closeQuote = closingQuoteIndex(in: line) else { return }
    let head = line[...closeQuote]
    var tokens = line[line.index(after: closeQuote)...].split(separator: " ").map(String.init)
    guard tokens.count >= 3 else { return }
    tokens[2] = String(sourceRaw)
    lines[index] = head + " " + tokens.joined(separator: " ")
}

private func silence(_ lines: inout [String], id: ConsoleStripID) {
    lines.removeAll { $0.hasPrefix(id.configPath + " ") }
}

/// Which strips each fixture's tests edit — different channel numbers per
/// fixture, so no test assumes a specific one.
private struct DiffEdits {
    let nameStrip: ConsoleStripID
    let newName: String
    let sourceStrip: ConsoleStripID
    let newSourceRaw: Int
    let colorEdits: [(id: ConsoleStripID, newColor: ConsoleChannelColor)]
    let silentStrips: [ConsoleStripID]
}

extension ChannelSetupFixture {
    fileprivate var diffEdits: DiffEdits {
        switch self {
        case .spike:
            return DiffEdits(
                nameStrip: ConsoleStripID(kind: .ch, number: 3),
                newName: "Priya",
                sourceStrip: ConsoleStripID(kind: .ch, number: 9),
                newSourceRaw: 20,
                colorEdits: [
                    (ConsoleStripID(kind: .ch, number: 25), .green),
                    (ConsoleStripID(kind: .ch, number: 12), .blue),
                ],
                silentStrips: [ConsoleStripID(kind: .ch, number: 13), ConsoleStripID(kind: .ch, number: 14)]
            )
        case .synthetic:
            return DiffEdits(
                nameStrip: ConsoleStripID(kind: .ch, number: 2),
                newName: "Choir Lead",
                sourceStrip: ConsoleStripID(kind: .ch, number: 7),
                newSourceRaw: 20,
                colorEdits: [
                    (ConsoleStripID(kind: .ch, number: 4), .green),
                    (ConsoleStripID(kind: .ch, number: 9), .blue),
                ],
                silentStrips: [ConsoleStripID(kind: .ch, number: 11), ConsoleStripID(kind: .ch, number: 12)]
            )
        }
    }
}

@Suite struct ChannelSetupDiffTests {
    @Test(arguments: ChannelSetupFixture.allCases)
    func identicalFreshReadIsUnchanged(_ fixture: ChannelSetupFixture) throws {
        let saved = try confirmedSetup(fixture)
        let (inventory, guesses) = freshRead(fixture)

        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

        #expect(diff.outcome == .unchanged)
        #expect(diff.missing.isEmpty)
        #expect(diff.roomMicSuspended == false)
        #expect(diff.roomMicNotice == nil)
        #expect(diff.changed.isEmpty)
        #expect(diff.bannerText == nil)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func colorOnlyChangesUpdateSilentlyAndKeepRoles(_ fixture: ChannelSetupFixture) throws {
        let saved = try confirmedSetup(fixture)
        let edits = fixture.diffEdits

        let (inventory, guesses) = freshRead(fixture) { lines in
            for edit in edits.colorEdits {
                recolor(&lines, id: edit.id, to: edit.newColor)
            }
        }
        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

        guard case .updatedSilently(let merged) = diff.outcome else {
            Issue.record("expected .updatedSilently, got \(diff.outcome)")
            return
        }
        #expect(diff.changed.isEmpty)
        #expect(diff.bannerText == nil)
        #expect(diff.missing.isEmpty)
        #expect(merged.roomMic == saved.roomMic)
        #expect(merged.confirmedAt == saved.confirmedAt)

        for edit in edits.colorEdits {
            let mergedStrip = try #require(merged.strips.first { $0.id == edit.id })
            #expect(mergedStrip.color == edit.newColor)
        }
        #expect(merged.strips.map(\.id) == saved.strips.map(\.id))
        for (mergedStrip, savedStrip) in zip(merged.strips, saved.strips) {
            #expect(mergedStrip.role == savedStrip.role, "\(mergedStrip.id.configPath)")
            #expect(mergedStrip.origin == savedStrip.origin, "\(mergedStrip.id.configPath)")
            #expect(mergedStrip.name == savedStrip.name, "\(mergedStrip.id.configPath)")
            #expect(mergedStrip.source == savedStrip.source, "\(mergedStrip.id.configPath)")
        }
    }

    @Test func nameOnCh3AndSourceOnCh9NeedReviewWithFreshGuesses() throws {
        let fixture = ChannelSetupFixture.spike
        let saved = try confirmedSetup(fixture)
        let ch3 = ConsoleStripID(kind: .ch, number: 3)
        let ch9 = ConsoleStripID(kind: .ch, number: 9)

        let (inventory, guesses) = freshRead(fixture) { lines in
            rename(&lines, id: ch3, to: "Priya")
            resource(&lines, id: ch9, to: 20)
        }
        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

        guard case .needsReview(let changed, let reguessed, let merged) = diff.outcome else {
            Issue.record("expected .needsReview, got \(diff.outcome)")
            return
        }
        #expect(changed == [ch3, ch9])
        #expect(Set(reguessed.map(\.id)) == Set([ch3.configPath, ch9.configPath]))
        for guess in reguessed {
            #expect(guesses.contains(guess))
        }
        for stripID in [ch3, ch9] {
            let mergedStrip = try #require(merged.strips.first { $0.id == stripID })
            let guess = try #require(guesses.first { $0.id == stripID.configPath })
            #expect(mergedStrip.role == guess.role)
            #expect(mergedStrip.origin == .guessed)
        }
        let changedIDs = Set(changed)
        for (mergedStrip, savedStrip) in zip(merged.strips, saved.strips) where !changedIDs.contains(mergedStrip.id) {
            #expect(mergedStrip.role == savedStrip.role, "\(mergedStrip.id.configPath)")
            #expect(mergedStrip.origin == savedStrip.origin, "\(mergedStrip.id.configPath)")
        }
        #expect(diff.bannerText?.contains("2 channels changed") == true)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func renamedRoomMicIsNamedAndSuspended(_ fixture: ChannelSetupFixture) throws {
        let saved = try confirmedSetup(fixture)
        let roomMicID = try #require(saved.roomMic)

        let (inventory, guesses) = freshRead(fixture) { lines in
            rename(&lines, id: roomMicID, to: "Kick 2")
        }
        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

        #expect(diff.roomMicSuspended == true)
        #expect(diff.roomMicNotice == "Room mic \(roomMicID.fallbackName) is now 'Kick 2'")
        #expect(diff.changed.contains(roomMicID))

        guard case .needsReview(_, _, let merged) = diff.outcome else {
            Issue.record("expected .needsReview, got \(diff.outcome)")
            return
        }
        #expect(merged.roomMic == saved.roomMic)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func roomMicSourceChangeIsNamedAndSuspended(_ fixture: ChannelSetupFixture) throws {
        let saved = try confirmedSetup(fixture)
        let roomMicID = try #require(saved.roomMic)
        #expect(roomMicID.kind.hasSource)

        let (inventory, guesses) = freshRead(fixture) { lines in
            resource(&lines, id: roomMicID, to: 61)
        }
        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

        #expect(diff.roomMicSuspended == true)
        let notice = try #require(diff.roomMicNotice)
        #expect(notice.contains(roomMicID.fallbackName))
        #expect(notice.contains("has a new input source"))
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func roomMicColorOnlyChangeDoesNotSuspend(_ fixture: ChannelSetupFixture) throws {
        let saved = try confirmedSetup(fixture)
        let roomMicID = try #require(saved.roomMic)
        let savedRoomMicStrip = try #require(saved.strips.first { $0.id == roomMicID })
        let newColor: ConsoleChannelColor = savedRoomMicStrip.color == .green ? .blue : .green

        let (inventory, guesses) = freshRead(fixture) { lines in
            recolor(&lines, id: roomMicID, to: newColor)
        }
        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

        #expect(diff.roomMicSuspended == false)
        #expect(diff.roomMicNotice == nil)
        guard case .updatedSilently = diff.outcome else {
            Issue.record("expected .updatedSilently, got \(diff.outcome)")
            return
        }
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func stripsThatDidNotAnswerAreMissingNotChanged(_ fixture: ChannelSetupFixture) throws {
        let saved = try confirmedSetup(fixture)
        let edits = fixture.diffEdits
        let silentIDs = edits.silentStrips

        let (inventory, guesses) = freshRead(fixture) { lines in
            for id in silentIDs { silence(&lines, id: id) }
        }
        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

        #expect(diff.missing == silentIDs)
        #expect(diff.changed.isEmpty)
        #expect(diff.outcome == .unchanged)

        let (inventory2, guesses2) = freshRead(fixture) { lines in
            for id in silentIDs { silence(&lines, id: id) }
            rename(&lines, id: edits.nameStrip, to: edits.newName)
        }
        let diff2 = ChannelSetupDiff.compare(saved: saved, inventory: inventory2, guesses: guesses2)

        guard case .needsReview(let changed, _, let merged) = diff2.outcome else {
            Issue.record("expected .needsReview, got \(diff2.outcome)")
            return
        }
        #expect(!changed.contains(where: silentIDs.contains))
        #expect(changed == [edits.nameStrip])
        #expect(diff2.missing == silentIDs)
        for id in silentIDs {
            let mergedStrip = try #require(merged.strips.first { $0.id == id })
            let savedStrip = try #require(saved.strips.first { $0.id == id })
            #expect(mergedStrip == savedStrip)
        }
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func stripNewToTheSetupIsChanged(_ fixture: ChannelSetupFixture) throws {
        let fullSaved = try confirmedSetup(fixture)
        let edits = fixture.diffEdits
        let missingFromSavedID = edits.nameStrip
        let reducedStrips = fullSaved.strips.filter { $0.id != missingFromSavedID }
        let saved = ConfirmedChannelSetup(console: fullSaved.console, strips: reducedStrips, roomMic: fullSaved.roomMic, confirmedAt: fullSaved.confirmedAt)

        let (inventory, guesses) = freshRead(fixture)
        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

        #expect(diff.changed.contains(missingFromSavedID))
        #expect(diff.missing.isEmpty)
        guard case .needsReview(_, let reguessed, let merged) = diff.outcome else {
            Issue.record("expected .needsReview, got \(diff.outcome)")
            return
        }
        #expect(reguessed.contains { $0.id == missingFromSavedID.configPath })
        let mergedStrip = try #require(merged.strips.first { $0.id == missingFromSavedID })
        let freshStrip = try #require(inventory.strips[missingFromSavedID])
        #expect(mergedStrip.name == freshStrip.name)
        #expect(mergedStrip.origin == .guessed)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func changedStripWithNoFreshGuessFallsBackToUnknown(_ fixture: ChannelSetupFixture) throws {
        let saved = try confirmedSetup(fixture)
        let edits = fixture.diffEdits
        let (inventory, _) = freshRead(fixture) { lines in
            rename(&lines, id: edits.nameStrip, to: edits.newName)
        }
        let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: [])

        guard case .needsReview(let changed, let reguessed, let merged) = diff.outcome else {
            Issue.record("expected .needsReview, got \(diff.outcome)")
            return
        }
        #expect(changed == [edits.nameStrip])
        #expect(reguessed.isEmpty)
        let mergedStrip = try #require(merged.strips.first { $0.id == edits.nameStrip })
        #expect(mergedStrip.role == .unknown)
        #expect(mergedStrip.origin == .guessed)
    }

    @Test func sameEditsAtDifferentChannelsGiveEquivalentResults() throws {
        var bannerTexts: [String?] = []
        for fixture in ChannelSetupFixture.allCases {
            let saved = try confirmedSetup(fixture)
            let edits = fixture.diffEdits

            let (inventory, guesses) = freshRead(fixture) { lines in
                rename(&lines, id: edits.nameStrip, to: edits.newName)
                resource(&lines, id: edits.sourceStrip, to: edits.newSourceRaw)
            }
            let diff = ChannelSetupDiff.compare(saved: saved, inventory: inventory, guesses: guesses)

            guard case .needsReview(let changed, let reguessed, let merged) = diff.outcome else {
                Issue.record("expected .needsReview for \(fixture), got \(diff.outcome)")
                return
            }
            #expect(changed.count == 2, "\(fixture)")
            #expect(Set(changed) == Set([edits.nameStrip, edits.sourceStrip]), "\(fixture)")
            #expect(reguessed.count == 2, "\(fixture)")
            bannerTexts.append(diff.bannerText)

            let untouchedIDs = Set(saved.strips.map(\.id)).subtracting([edits.nameStrip, edits.sourceStrip])
            for id in untouchedIDs {
                let mergedStrip = try #require(merged.strips.first { $0.id == id })
                let savedStrip = try #require(saved.strips.first { $0.id == id })
                #expect(mergedStrip.role == savedStrip.role, "\(fixture) \(id.configPath)")
                #expect(mergedStrip.origin == savedStrip.origin, "\(fixture) \(id.configPath)")
            }
        }
        #expect(bannerTexts.count == 2)
        #expect(Set(bannerTexts.compactMap { $0 }).count == 1)
    }

    @Test func bannerTextPluralises() {
        #expect(ChannelSetupDiff.bannerText(changedCount: 0) == nil)
        #expect(ChannelSetupDiff.bannerText(changedCount: -1) == nil)
        #expect(ChannelSetupDiff.bannerText(changedCount: 1) == "1 channel changed on the desk since your setup — Review")
        #expect(ChannelSetupDiff.bannerText(changedCount: 2) == "2 channels changed on the desk since your setup — Review")
    }
}
