import Foundation
import Testing
@testable import SoundBuddyKit

/// Fixtures share one shape: a `/node` capture plus the strips it should
/// decode to. The spike fixture is a real desk's capture
/// (packages/console/src/capture-2026-08-16.scn); the synthetic fixture is a
/// different, made-up layout — together they prove nothing in
/// `ConsoleChannelInventory` assumes one church's channel order or names.
private struct ConsoleChannelInventoryFixture: Decodable {
    struct ExpectedStrip: Decodable {
        let kind: String
        let number: Int
        let name: String
        let color: String
        let source: Int?
    }

    let provenance: String
    let model: String
    let nodeLines: [String]
    let expected: [ExpectedStrip]

    static func load(_ name: String) throws -> ConsoleChannelInventoryFixture {
        try JSONDecoder().decode(Self.self, from: Data(contentsOf: TestPaths.fixture(name)))
    }
}

@Suite struct ConsoleChannelInventoryTests {
    private static let spikeFixtureName = "console-channel-inventory.tpc-m32r-spike.json"
    private static let syntheticFixtureName = "console-channel-inventory.synthetic.json"

    private func assertFixtureParses(named name: String) throws {
        let fixture = try ConsoleChannelInventoryFixture.load(name)
        var inventory = try #require(ConsoleChannelInventory(model: fixture.model))

        for line in fixture.nodeLines {
            #expect(inventory.apply(nodeLine: line) == true, "expected \"\(line)\" to apply")
        }
        #expect(inventory.missing.isEmpty)

        for expectedStrip in fixture.expected {
            let kind = try #require(ConsoleStripKind(rawValue: expectedStrip.kind))
            let id = ConsoleStripID(kind: kind, number: expectedStrip.number)
            let strip = try #require(inventory.strips[id], "missing strip for \(id.configPath)")

            #expect(strip.name == expectedStrip.name)
            #expect(strip.color.rawValue == expectedStrip.color)
            if let expectedSource = expectedStrip.source {
                #expect(strip.source == ConsoleInputSource(raw: expectedSource))
            } else {
                #expect(strip.source == nil)
            }
        }
    }

    @Test(arguments: ["X32", "M32R", "X32RACK"])
    func x32FamilyTableYields32Ch8AuxIn16Bus(model: String) {
        let counts = ConsoleChannelInventory.stripCounts(forModel: model)
        #expect(counts?[.ch] == 32)
        #expect(counts?[.auxin] == 8)
        #expect(counts?[.bus] == 16)
    }

    @Test(arguments: ["XR18", ""])
    func unknownModelHasNoTable(model: String) {
        #expect(ConsoleChannelInventory.stripCounts(forModel: model) == nil)
    }

    @Test func walkIsOneNodeReadPerStrip() throws {
        let inventory = try #require(ConsoleChannelInventory(model: "X32"))
        let messages = inventory.walkMessages()
        #expect(messages.count == 56)
        #expect(Set(messages.map(\.address)) == ["/node"])

        var paths: [String] = []
        for message in messages {
            #expect(message.arguments.count == 1)
            guard case let .string(value) = message.arguments[0] else {
                Issue.record("expected a string argument")
                continue
            }
            paths.append(value)
        }
        #expect(Set(paths).count == paths.count)
        #expect(paths == inventory.stripIDs.map { String($0.configPath.dropFirst()) })
        #expect(paths.first == "ch/01/config")
        #expect(paths[32] == "auxin/01/config")
        #expect(paths.last == "bus/16/config")
    }

    @Test func spikeFixtureParsesToItsExpectedStrips() throws {
        try assertFixtureParses(named: Self.spikeFixtureName)
    }

    @Test func syntheticFixtureParsesToItsExpectedStrips() throws {
        try assertFixtureParses(named: Self.syntheticFixtureName)
    }

    @Test func realDeskNodeReplyParses() throws {
        let line = "/auxin/01/config \"ProP L\" 55 YE 33"
        let message = OSCMessage("/node", [.string(line)])
        let parsedLine = try #require(message.nodeReplyLine(expectedPath: "/auxin/01/config"))
        #expect(parsedLine == line)

        var inventory = try #require(ConsoleChannelInventory(model: "X32"))
        #expect(inventory.apply(nodeLine: parsedLine) == true)

        let strip = inventory.strips[ConsoleStripID(kind: .auxin, number: 1)]
        #expect(strip?.name == "ProP L")
        #expect(strip?.color == .yellow)
        #expect(strip?.source == .aux(1))
    }

    @Test func unknownSourceKeepsStripAndRestOfInventory() throws {
        let fixture = try ConsoleChannelInventoryFixture.load(Self.syntheticFixtureName)
        var inventory = try #require(ConsoleChannelInventory(model: fixture.model))
        let mutatedID = ConsoleStripID(kind: .ch, number: 1)

        for line in fixture.nodeLines {
            guard let configLine = ConsoleConfigLine(nodeLine: line), configLine.path == mutatedID.configPath else {
                #expect(inventory.apply(nodeLine: line) == true)
                continue
            }
            let mutatedLine = "\(configLine.path) \"\(configLine.name)\" \(configLine.icon) \(configLine.colorToken) 99"
            #expect(inventory.apply(nodeLine: mutatedLine) == true)
        }

        #expect(inventory.missing.isEmpty)
        #expect(inventory.strips[mutatedID]?.source == .unknown(99))

        for expectedStrip in fixture.expected where !(expectedStrip.kind == "ch" && expectedStrip.number == 1) {
            let kind = try #require(ConsoleStripKind(rawValue: expectedStrip.kind))
            let id = ConsoleStripID(kind: kind, number: expectedStrip.number)
            let strip = try #require(inventory.strips[id])
            #expect(strip.name == expectedStrip.name)
            #expect(strip.color.rawValue == expectedStrip.color)
        }
    }

    @Test func emptyNameKeepsBlankAndFallsBackForDisplay() {
        let chStrip = ConsoleChannelStrip(
            id: ConsoleStripID(kind: .ch, number: 13), name: "", icon: 1, color: .off, source: .off
        )
        #expect(chStrip.name == "")
        #expect(chStrip.displayName == "Ch 13")

        let auxStrip = ConsoleChannelStrip(
            id: ConsoleStripID(kind: .auxin, number: 5), name: "", icon: 1, color: .off, source: .off
        )
        #expect(auxStrip.displayName == "Aux 5")
    }

    @Test func malformedKnownLineIsSweptPerField() throws {
        var inventory = try #require(ConsoleChannelInventory(model: "X32"))
        let id = ConsoleStripID(kind: .ch, number: 4)
        #expect(inventory.apply(nodeLine: "/ch/04/config \"X\" 1 PK 4") == false) // unknown color token

        let sweep = inventory.sweepMessages()
        #expect(sweep.contains(OSCMessage("\(id.configPath)/name")))
        #expect(sweep.contains(OSCMessage("\(id.configPath)/color")))
        #expect(sweep.contains(OSCMessage("\(id.configPath)/source")))

        #expect(inventory.apply(fieldReply: OSCMessage("\(id.configPath)/name", [.string("Pastor")])) == true)
        #expect(inventory.apply(fieldReply: OSCMessage("\(id.configPath)/color", [.int(5)])) == true) // 5 == .magenta
        #expect(inventory.apply(fieldReply: OSCMessage("\(id.configPath)/source", [.int(4)])) == true)

        let strip = try #require(inventory.strips[id])
        #expect(strip.name == "Pastor")
        #expect(strip.color == .magenta)
        #expect(strip.source == .input(4))
        #expect(strip.icon == nil)
        #expect(!inventory.missing.contains(id))
    }

    @Test func busMalformedLineGetsNoSourceQuery() throws {
        var inventory = try #require(ConsoleChannelInventory(model: "X32"))
        let id = ConsoleStripID(kind: .bus, number: 3)
        #expect(inventory.apply(nodeLine: "/bus/03/config \"X\" 71 PK") == false) // unknown color token

        let sweep = inventory.sweepMessages()
        #expect(sweep.contains(OSCMessage("\(id.configPath)/name")))
        #expect(sweep.contains(OSCMessage("\(id.configPath)/color")))
        #expect(!sweep.contains(OSCMessage("\(id.configPath)/source")))
    }

    @Test func twoSilentStripsAreMissingAfterSweep() throws {
        let fixture = try ConsoleChannelInventoryFixture.load(Self.syntheticFixtureName)
        var inventory = try #require(ConsoleChannelInventory(model: fixture.model))

        let skipChID = ConsoleStripID(kind: .ch, number: 1)
        let skipBusID = ConsoleStripID(kind: .bus, number: 1)

        for line in fixture.nodeLines {
            guard let configLine = ConsoleConfigLine(nodeLine: line) else {
                Issue.record("fixture line failed to parse: \(line)")
                continue
            }
            if configLine.path == skipChID.configPath || configLine.path == skipBusID.configPath {
                continue
            }
            #expect(inventory.apply(nodeLine: line) == true)
        }

        let sweep = inventory.sweepMessages()
        #expect(sweep.count == 2)
        #expect(sweep.contains(ConsoleTargetCatalog.nodeQuery(forConfigPath: skipChID.configPath)))
        #expect(sweep.contains(ConsoleTargetCatalog.nodeQuery(forConfigPath: skipBusID.configPath)))

        #expect(inventory.missing == [skipChID, skipBusID])
        #expect(inventory.missingSummary == "2 channels didn't answer — Retry")
    }

    @Test func missingSummaryPluralizes() {
        var complete = ConsoleChannelInventory(stripCounts: [.ch: 1])
        #expect(complete.apply(nodeLine: "/ch/01/config \"A\" 1 MG 1") == true)
        #expect(complete.missingSummary == nil)

        let one = ConsoleChannelInventory(stripCounts: [.ch: 1])
        #expect(one.missingSummary == "1 channel didn't answer — Retry")

        let two = ConsoleChannelInventory(stripCounts: [.ch: 2])
        #expect(two.missingSummary == "2 channels didn't answer — Retry")
    }

    @Test func everyWalkAndSweepDatagramIsAGuardedRead() throws {
        var inventory = try #require(ConsoleChannelInventory(model: "X32"))
        #expect(inventory.apply(nodeLine: "/ch/04/config \"X\" 1 PK 4") == false) // induces a malformed, per-field sweep

        let messages = inventory.walkMessages() + inventory.sweepMessages()
        #expect(!messages.isEmpty)
        for message in messages {
            #expect(message.arguments.isEmpty || message.address == "/node")
            #expect(throws: Never.self) {
                try ReadOnlyOSCGuard.check(message)
            }
            #expect(throws: Never.self) {
                _ = try OSCCodec.encode(message)
            }
        }
    }

    @Test func applyIgnoresPathsOutsideTheInventory() {
        var inventory = ConsoleChannelInventory(stripCounts: [.ch: 32, .auxin: 8, .bus: 16])
        let outOfScopeLines = [
            "/ch/33/config \"X\" 1 MG 1",
            "/main/st/config \"X\" 1 MG",
            "/mtx/01/config \"X\" 1 MG",
        ]
        for line in outOfScopeLines {
            let before = inventory
            #expect(inventory.apply(nodeLine: line) == false, "expected \"\(line)\" to be rejected")
            #expect(inventory == before, "expected \"\(line)\" to leave the inventory unchanged")
        }
    }
}
