import Foundation
import Testing
@testable import SoundBuddyKit

private struct ChannelSetupReviewFixture: Decodable {
    let provenance: String
    let model: String
    let nodeLines: [String]

    static func load(_ name: String) throws -> ChannelSetupReviewFixture {
        try JSONDecoder().decode(Self.self, from: Data(contentsOf: TestPaths.fixture(name)))
    }
}

/// A rotation (always a bijection, unlike a strided map whose stride may
/// share a factor with the count) used to prove grouping doesn't depend on
/// guess order.
private func rotated(_ guesses: [ChannelRoleGuess], by offset: Int) -> [ChannelRoleGuess] {
    let count = guesses.count
    guard count > 0 else { return guesses }
    let shift = offset % count
    return Array(guesses[shift...] + guesses[..<shift])
}

@Suite struct ChannelSetupReviewTests {
    private static let spikeFixtureName = "console-channel-inventory.tpc-m32r-spike.json"
    private static let syntheticFixtureName = "console-channel-inventory.synthetic.json"
    private static let testConsole = ConsoleIdentity(name: "Test Console", model: "M32R")

    // test data: TPC M32R spike 2026-10-29 — same shape as the on-disk spike
    // fixture, but ch01...04 carry person names (as in ChannelRoleGuesserTests
    // .spike) instead of the real capture's "Vox 1".."Vox 3".
    private static let spikePeopleNamesLines: [String] = [
        "/ch/01/config \"Ryan\" 1 MG 1",
        "/ch/02/config \"Lily\" 1 MG 2",
        "/ch/03/config \"Clarissa\" 1 MG 3",
        "/ch/04/config \"Sofia\" 1 MG 4",
        "/ch/05/config \"MC\" 1 WH 5",
        "/ch/06/config \"Headset\" 1 CY 6",
        "/ch/07/config \"Keys L\" 1 RD 7",
        "/ch/08/config \"Keys R\" 1 RD 8",
        "/ch/09/config \"EG L\" 1 CY 9",
        "/ch/10/config \"EG R\" 1 CY 10",
        "/ch/11/config \"AG\" 1 BL 11",
        "/ch/12/config \"Bass\" 1 YE 12",
        "/ch/13/config \"\" 1 OFF 13",
        "/ch/14/config \"\" 1 OFF 14",
        "/ch/15/config \"\" 1 OFF 15",
        "/ch/16/config \"Crowd\" 1 WH 16",
        "/ch/17/config \"TPerc\" 1 RD 17",
        "/ch/18/config \"TBass\" 1 YE 18",
        "/ch/19/config \"TEG L\" 1 BL 19",
        "/ch/20/config \"TEG R\" 1 BL 20",
        "/ch/21/config \"TKeys L\" 1 GN 21",
        "/ch/22/config \"TKeys R\" 1 GN 22",
        "/ch/23/config \"Click\" 1 WH 23",
        "/ch/24/config \"Guide\" 1 RD 24",
        "/ch/25/config \"Kick\" 1 RD 25",
        "/ch/26/config \"Snare\" 1 RD 26",
        "/ch/27/config \"F Tom\" 1 RD 27",
        "/ch/28/config \"Tom\" 1 RD 28",
        "/ch/29/config \"HiHat\" 1 RD 29",
        "/ch/30/config \"Cymbals\" 1 RD 30",
        "/ch/31/config \"MD 1\" 1 WH 31",
        "/ch/32/config \"MD 2\" 1 WH 32",
        "/auxin/01/config \"ProP L\" 55 YE 33",
        "/auxin/02/config \"ProP R\" 55 YE 34",
        "/auxin/03/config \"Spotify L\" 55 GN 35",
        "/auxin/04/config \"Spotify R\" 55 GN 36",
        "/auxin/05/config \"\" 55 GN 37",
        "/auxin/06/config \"\" 55 GN 38",
        "/auxin/07/config \"USB L\" 60 YE 39",
        "/auxin/08/config \"USB R\" 60 YE 40",
        "/bus/01/config \"IEM1\" 71 CY",
        "/bus/02/config \"IEM1\" 71 CY",
        "/bus/03/config \"IEM2\" 71 CY",
        "/bus/04/config \"IEM2\" 71 CY",
        "/bus/05/config \"IEM3\" 71 CY",
        "/bus/06/config \"IEM3\" 71 CY",
        "/bus/07/config \"IEM4\" 71 CY",
        "/bus/08/config \"IEM4\" 71 CY",
        "/bus/09/config \"IEM5\" 71 CY",
        "/bus/10/config \"IEM6\" 71 CY",
        "/bus/11/config \"IEM7\" 71 CY",
        "/bus/12/config \"IEM8\" 71 CY",
        "/bus/13/config \"D-Verb\" 71 MG",
        "/bus/14/config \"B-Verb\" 71 MG",
        "/bus/15/config \"Vox Verb\" 71 MG",
        "/bus/16/config \"Vox Delay\" 71 MG",
    ]

    private static let crowdID = ConsoleStripID(kind: .ch, number: 16)
    private static let kickID = ConsoleStripID(kind: .ch, number: 25)
    private static let snareID = ConsoleStripID(kind: .ch, number: 26)
    private static let bassID = ConsoleStripID(kind: .ch, number: 12)
    private static let ryanID = ConsoleStripID(kind: .ch, number: 1)
    private static let lilyID = ConsoleStripID(kind: .ch, number: 2)
    private static let clarissaID = ConsoleStripID(kind: .ch, number: 3)
    private static let sofiaID = ConsoleStripID(kind: .ch, number: 4)
    private static let md1ID = ConsoleStripID(kind: .ch, number: 31)
    private static let md2ID = ConsoleStripID(kind: .ch, number: 32)
    private static let blankOffID = ConsoleStripID(kind: .ch, number: 13)
    private static let blankColoredID = ConsoleStripID(kind: .auxin, number: 5)

    private func inventory(model: String, lines: [String]) throws -> ConsoleChannelInventory {
        var inventory = try #require(ConsoleChannelInventory(model: model))
        for line in lines {
            #expect(inventory.apply(nodeLine: line) == true, "expected \"\(line)\" to apply")
        }
        return inventory
    }

    private func review(
        _ inventory: ConsoleChannelInventory,
        candidates: [ChannelRoleGuess]? = nil,
        restricting: [ConsoleStripID]? = nil
    ) -> ChannelSetupReview {
        let guesses = ChannelRoleGuesser.bundled().guess(ConsoleChannelReadResult.roleInputs(from: inventory))
        let roomMicCandidates = candidates ?? ChannelRoleGuesser.roomMicCandidates(in: guesses)
        return ChannelSetupReview(
            console: Self.testConsole, inventory: inventory, guesses: guesses,
            roomMicCandidates: roomMicCandidates, restricting: restricting
        )
    }

    private func spikePeopleNamesReview() throws -> ChannelSetupReview {
        review(try inventory(model: "M32R", lines: Self.spikePeopleNamesLines))
    }

    @Test func spikeHighRowsLookRightPeopleNamesAndMDNeedChecking() throws {
        let subject = try spikePeopleNamesReview()

        let checkTheseIDs = Set(subject.checkThese.map(\.id))
        let looksRightIDs = Set(subject.looksRight.map(\.id))

        for id in [Self.kickID, Self.snareID, Self.bassID] {
            #expect(looksRightIDs.contains(id), "\(id.configPath)")
            #expect(!checkTheseIDs.contains(id), "\(id.configPath)")
        }

        for id in [Self.ryanID, Self.lilyID, Self.clarissaID, Self.sofiaID, Self.md1ID, Self.md2ID] {
            #expect(checkTheseIDs.contains(id), "\(id.configPath)")
            #expect(!looksRightIDs.contains(id), "\(id.configPath)")
        }

        #expect(subject.looksRightCount == subject.looksRight.count)
    }

    @Test func blankAndUnusedStripsAreHiddenUnlessShowUnused() throws {
        var subject = try spikePeopleNamesReview()

        let checkTheseIDs = Set(subject.checkThese.map(\.id))
        let looksRightIDs = Set(subject.looksRight.map(\.id))
        #expect(!checkTheseIDs.contains(Self.blankOffID))
        #expect(!looksRightIDs.contains(Self.blankOffID))
        #expect(!checkTheseIDs.contains(Self.blankColoredID))
        #expect(!looksRightIDs.contains(Self.blankColoredID))

        #expect(subject.unused.isEmpty)

        subject.showUnused = true
        let unusedIDs = Set(subject.unused.map(\.id))
        #expect(unusedIDs.contains(Self.blankOffID))
        #expect(unusedIDs.contains(Self.blankColoredID))
    }

    @Test func settingARoleConfirmsTheRowAndMovesItOutOfCheckThese() throws {
        var subject = try spikePeopleNamesReview()
        #expect(subject.checkThese.contains { $0.id == Self.ryanID })

        #expect(subject.setRole(.vocal, for: Self.ryanID) == true)

        #expect(!subject.checkThese.contains { $0.id == Self.ryanID })
        let row = try #require(subject.rows.first { $0.id == Self.ryanID })
        #expect(row.role == .vocal)
        #expect(row.origin == .confirmed)
        #expect(subject.looksRight.contains { $0.id == Self.ryanID })
    }

    @Test func settingARoleForAnUnknownStripChangesNothing() throws {
        let before = try spikePeopleNamesReview()
        var after = before
        let unknownID = ConsoleStripID(kind: .ch, number: 99)

        #expect(after.setRole(.vocal, for: unknownID) == false)
        #expect(after == before)
    }

    @Test func doneIsDisabledWhileRowsNeedChecking() throws {
        let subject = try spikePeopleNamesReview()
        #expect(!subject.checkThese.isEmpty)
        #expect(subject.isDoneEnabled == false)
    }

    @Test func doneIsEnabledOnceCheckTheseIsEmpty() throws {
        var subject = try spikePeopleNamesReview()
        for row in subject.checkThese {
            #expect(subject.setRole(row.role, for: row.id) == true)
        }
        #expect(subject.checkThese.isEmpty)
        #expect(subject.isDoneEnabled == true)
    }

    @Test func confirmAllEnablesDoneAndConfirmsEveryVisibleRow() throws {
        var subject = try spikePeopleNamesReview()
        subject.showUnused = true
        let hiddenIDsBefore = Set(subject.rows.filter(\.isHidden).map(\.id))
        #expect(!hiddenIDsBefore.isEmpty)

        subject.confirmAll()

        #expect(subject.isDoneEnabled == true)
        for row in subject.rows where !row.isHidden {
            #expect(row.origin == .confirmed, "\(row.id.configPath)")
        }
        for row in subject.rows where row.isHidden {
            #expect(row.origin == .guessed, "\(row.id.configPath)")
        }
    }

    @Test func crowdCandidateAtMediumOrAbovePrefillsTheRoomMic() throws {
        let subject = try spikePeopleNamesReview()
        #expect(subject.roomMic == .candidate(Self.crowdID))
    }

    @Test func lowConfidenceOrMissingCandidatesLeaveTheRoomMicNone() throws {
        let inv = try inventory(model: "M32R", lines: Self.spikePeopleNamesLines)
        let lowConfidenceCandidate = ChannelRoleGuess(
            id: Self.crowdID.configPath, name: "Crowd", role: .roomMic,
            confidence: 0.1, reason: "hand-built low-confidence candidate", basis: .label
        )

        let lowConfidenceReview = review(inv, candidates: [lowConfidenceCandidate])
        #expect(lowConfidenceReview.roomMic == .none)

        let noCandidatesReview = review(inv, candidates: [])
        #expect(noCandidatesReview.roomMic == .none)
    }

    @Test func roomMicOptionsListCandidatesThenOtherChannelsThenNone() throws {
        let subject = try spikePeopleNamesReview()
        let options = subject.roomMicOptions

        #expect(options.first == .candidate(Self.crowdID))
        let lastOption = try #require(options.last)
        #expect(lastOption == .none)
        #expect(!options.contains(.otherChannel(Self.crowdID)))

        let noneCount = options.filter { $0 == .none }.count
        #expect(noneCount == 1)

        let visibleNonCandidateCount = subject.rows.filter { !$0.isHidden && $0.id != Self.crowdID }.count
        #expect(options.count == 1 + visibleNonCandidateCount + 1)
    }

    @Test func selectRoomMicRejectsIdsOutsideTheReview() throws {
        var subject = try spikePeopleNamesReview()
        let notARow = ConsoleStripID(kind: .ch, number: 99)

        #expect(subject.selectRoomMic(.otherChannel(notARow)) == false)
        #expect(subject.roomMic == .candidate(Self.crowdID))

        #expect(subject.selectRoomMic(.candidate(Self.kickID)) == false)
        #expect(subject.roomMic == .candidate(Self.crowdID))

        #expect(subject.selectRoomMic(.otherChannel(Self.kickID)) == true)
        #expect(subject.roomMic == .otherChannel(Self.kickID))

        #expect(subject.selectRoomMic(.none) == true)
        #expect(subject.roomMic == .none)
    }

    @Test func noneRoomMicGivesASetupWithNoRoomMic() throws {
        var subject = try spikePeopleNamesReview()
        #expect(subject.selectRoomMic(.none) == true)
        subject.confirmAll()

        let setup = try #require(subject.done(confirmedAt: Date(timeIntervalSince1970: 1_700_000_000)))
        #expect(setup.roomMic == nil)
    }

    @Test func doneReturnsNilWhileDisabled() throws {
        let subject = try spikePeopleNamesReview()
        #expect(subject.done(confirmedAt: Date(timeIntervalSince1970: 1_700_000_000)) == nil)
    }

    @Test func doneCarriesConsoleStripsOriginsAndInjectedDate() throws {
        var subject = try spikePeopleNamesReview()
        subject.confirmAll()
        let date = Date(timeIntervalSince1970: 1_700_000_000)

        let setup = try #require(subject.done(confirmedAt: date))

        #expect(setup.console == Self.testConsole)
        #expect(setup.confirmedAt == date)
        #expect(setup.strips.count == subject.rows.count)
        #expect(setup.strips.map(\.id) == subject.rows.map(\.id))
        for (stripEntry, row) in zip(setup.strips, subject.rows) {
            #expect(stripEntry.name == row.strip.name)
            #expect(stripEntry.color == row.strip.color)
            #expect(stripEntry.source == row.strip.source)
            #expect(stripEntry.role == row.role)
            #expect(stripEntry.origin == row.origin)
        }
    }

    @Test func syntheticFixtureGroupsAndPrefillsFromItsOwnLabels() throws {
        let fixture = try ChannelSetupReviewFixture.load(Self.syntheticFixtureName)
        let subject = review(try inventory(model: fixture.model, lines: fixture.nodeLines))

        let crowdMicID = ConsoleStripID(kind: .ch, number: 16)
        #expect(subject.roomMic == .candidate(crowdMicID))

        let looksRightNames = Set(subject.looksRight.map(\.strip.name))
        #expect(looksRightNames.isSuperset(of: ["Kik", "OH L", "Click"]))
    }

    @Test func shuffledGuessOrderLeavesGroupMembershipUnchanged() throws {
        for fixtureName in [Self.spikeFixtureName, Self.syntheticFixtureName] {
            let fixture = try ChannelSetupReviewFixture.load(fixtureName)
            let inv = try inventory(model: fixture.model, lines: fixture.nodeLines)
            let inputs = ConsoleChannelReadResult.roleInputs(from: inv)
            let guesses = ChannelRoleGuesser.bundled().guess(inputs)
            let candidates = ChannelRoleGuesser.roomMicCandidates(in: guesses)

            let original = ChannelSetupReview(console: Self.testConsole, inventory: inv, guesses: guesses, roomMicCandidates: candidates)
            let reversed = ChannelSetupReview(console: Self.testConsole, inventory: inv, guesses: Array(guesses.reversed()), roomMicCandidates: candidates)
            let rotatedGuesses = ChannelSetupReview(console: Self.testConsole, inventory: inv, guesses: rotated(guesses, by: 7), roomMicCandidates: candidates)

            for other in [reversed, rotatedGuesses] {
                #expect(Set(other.checkThese.map(\.id)) == Set(original.checkThese.map(\.id)), "\(fixtureName)")
                #expect(Set(other.looksRight.map(\.id)) == Set(original.looksRight.map(\.id)), "\(fixtureName)")
                #expect(Set(other.unused.map(\.id)) == Set(original.unused.map(\.id)), "\(fixtureName)")
                #expect(other.roomMic == original.roomMic, "\(fixtureName)")
            }
        }
    }

    @Test func restrictingShowsOnlyTheGivenStrips() throws {
        let inv = try inventory(model: "M32R", lines: Self.spikePeopleNamesLines)
        let restriction = [Self.kickID, Self.ryanID, Self.crowdID]
        let walkOrder = [Self.ryanID, Self.crowdID, Self.kickID]

        var subject = review(inv, restricting: restriction)

        #expect(subject.rows.map(\.id) == walkOrder)

        subject.confirmAll()
        let setup = try #require(subject.done(confirmedAt: Date(timeIntervalSince1970: 1_700_000_000)))
        #expect(Set(setup.strips.map(\.id)) == Set(restriction))
        #expect(setup.strips.count == restriction.count)
    }

    @Test func accessibilityLabelReadsKindNumberNameRoleAndConfidence() throws {
        var subject = try spikePeopleNamesReview()

        #expect(subject.accessibilityLabel(for: Self.kickID) == "Channel 25, Kick, kick drum, high confidence")

        #expect(subject.setRole(.kick, for: Self.kickID) == true)
        #expect(subject.accessibilityLabel(for: Self.kickID) == "Channel 25, Kick, kick drum, confirmed")

        let auxLabel = try #require(subject.accessibilityLabel(for: ConsoleStripID(kind: .auxin, number: 1)))
        #expect(auxLabel.hasPrefix("Aux in 1, "))

        let busLabel = try #require(subject.accessibilityLabel(for: ConsoleStripID(kind: .bus, number: 1)))
        #expect(busLabel.hasPrefix("Bus 1, "))

        let blankLabel = try #require(subject.accessibilityLabel(for: Self.blankOffID))
        #expect(blankLabel.hasPrefix("Channel 13, Ch 13, "))

        #expect(subject.accessibilityLabel(for: ConsoleStripID(kind: .ch, number: 99)) == nil)
    }

    @Test func spokenNameCoversEveryRole() {
        var seen = Set<String>()
        for role in ChannelRole.allCases {
            let spoken = ChannelSetupReview.spokenName(for: role)
            #expect(!spoken.isEmpty, "\(role)")
            #expect(!seen.contains(spoken), "\(role) duplicates \(spoken)")
            seen.insert(spoken)
        }
        #expect(ChannelSetupReview.spokenName(for: .kick) == "kick drum")
        #expect(ChannelSetupReview.spokenName(for: .hiHat) == "hi-hat")
        #expect(ChannelSetupReview.spokenName(for: .roomMic) == "room mic")
    }

    @Test func rowWithoutAGuessIsUnknownLowAndNeedsChecking() throws {
        let inv = try inventory(model: "M32R", lines: Self.spikePeopleNamesLines)
        let allGuesses = ChannelRoleGuesser.bundled().guess(ConsoleChannelReadResult.roleInputs(from: inv))
        let guessesMissingKick = allGuesses.filter { $0.id != Self.kickID.configPath }

        let subject = ChannelSetupReview(console: Self.testConsole, inventory: inv, guesses: guessesMissingKick, roomMicCandidates: [])

        let row = try #require(subject.rows.first { $0.id == Self.kickID })
        #expect(row.role == .unknown)
        #expect(row.confidence == .low)
        #expect(row.reason == "No guess for this strip")
        #expect(subject.checkThese.contains { $0.id == Self.kickID })
    }
}
