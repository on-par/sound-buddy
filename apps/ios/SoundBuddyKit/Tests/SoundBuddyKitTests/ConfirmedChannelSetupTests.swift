import Foundation
import Testing
@testable import SoundBuddyKit

private struct ConfirmedChannelSetupFixture: Decodable {
    let provenance: String
    let model: String
    let nodeLines: [String]

    static func load(_ name: String) throws -> ConfirmedChannelSetupFixture {
        try JSONDecoder().decode(Self.self, from: Data(contentsOf: TestPaths.fixture(name)))
    }
}

@Suite struct ConfirmedChannelSetupTests {
    private static let syntheticFixtureName = "console-channel-inventory.synthetic.json"
    private static let testConsole = ConsoleIdentity(name: "Test Console", model: "X32")

    private func inventory(model: String, lines: [String]) throws -> ConsoleChannelInventory {
        var inventory = try #require(ConsoleChannelInventory(model: model))
        for line in lines {
            #expect(inventory.apply(nodeLine: line) == true, "expected \"\(line)\" to apply")
        }
        return inventory
    }

    private func review(_ inventory: ConsoleChannelInventory) -> ChannelSetupReview {
        let guesses = ChannelRoleGuesser.bundled().guess(ConsoleChannelReadResult.roleInputs(from: inventory))
        let candidates = ChannelRoleGuesser.roomMicCandidates(in: guesses)
        return ChannelSetupReview(console: Self.testConsole, inventory: inventory, guesses: guesses, roomMicCandidates: candidates)
    }

    @Test func doneSetupRoundTripsThroughJSON() throws {
        let fixture = try ConfirmedChannelSetupFixture.load(Self.syntheticFixtureName)
        var subject = review(try inventory(model: fixture.model, lines: fixture.nodeLines))
        subject.confirmAll()
        let setup = try #require(subject.done(confirmedAt: Date(timeIntervalSince1970: 1_700_000_000)))

        let encoded = try JSONEncoder().encode(setup)
        let decoded = try JSONDecoder().decode(ConfirmedChannelSetup.self, from: encoded)

        #expect(decoded == setup)
    }

    @Test func doneSetupWithARoomMicRoundTripsThroughJSON() throws {
        let fixture = try ConfirmedChannelSetupFixture.load(Self.syntheticFixtureName)
        var subject = review(try inventory(model: fixture.model, lines: fixture.nodeLines))
        #expect(subject.selectRoomMic(.candidate(ConsoleStripID(kind: .ch, number: 16))) == true)
        subject.confirmAll()
        let setup = try #require(subject.done(confirmedAt: Date(timeIntervalSince1970: 1_700_000_000)))
        #expect(setup.roomMic == ConsoleStripID(kind: .ch, number: 16))

        let encoded = try JSONEncoder().encode(setup)
        let decoded = try JSONDecoder().decode(ConfirmedChannelSetup.self, from: encoded)

        #expect(decoded == setup)
    }

    @Test func everyInputSourceCaseRoundTripsThroughJSON() throws {
        let sources: [ConsoleInputSource?] = [
            .off, .input(3), .aux(2), .usbL, .usbR,
            .fxReturn(unit: 2, isRight: true), .bus(5), .unknown(999), nil,
        ]
        let colors: [ConsoleChannelColor] = [.red, .redInverted, .white, .whiteInverted]
        let origins: [ChannelRoleOrigin] = [.guessed, .confirmed]
        let kinds: [ConsoleStripKind] = [.ch, .auxin, .bus]

        var strips: [ConfirmedChannelSetup.Strip] = []
        for (index, source) in sources.enumerated() {
            let kind = kinds[index % kinds.count]
            let color = colors[index % colors.count]
            let origin = origins[index % origins.count]
            strips.append(ConfirmedChannelSetup.Strip(
                id: ConsoleStripID(kind: kind, number: index + 1),
                name: "Strip \(index)",
                color: color,
                source: kind.hasSource ? source : nil,
                role: ChannelRole.allCases[index % ChannelRole.allCases.count],
                origin: origin
            ))
        }

        let setup = ConfirmedChannelSetup(
            console: Self.testConsole,
            strips: strips,
            roomMic: ConsoleStripID(kind: .ch, number: 1),
            confirmedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        #expect(setup.schemaVersion == ConfirmedChannelSetup.schemaVersion)

        let encoded = try JSONEncoder().encode(setup)
        let decoded = try JSONDecoder().decode(ConfirmedChannelSetup.self, from: encoded)

        #expect(decoded == setup)
    }
}
