import Foundation
import Testing
@testable import SoundBuddyKit

private struct ChannelSetupFixtureJSON: Decodable {
    let model: String
    let nodeLines: [String]

    static func load(_ name: String) throws -> ChannelSetupFixtureJSON {
        try JSONDecoder().decode(Self.self, from: Data(contentsOf: TestPaths.fixture(name)))
    }
}

@Suite struct ChannelSetupFixtureTests {
    @Test func theFixtureArgumentIsIgnoredOutsideDebugBuilds() {
        #expect(ChannelSetupFixture.requested(by: ["-channelSetupFixture", "spike"], isDebugBuild: false) == nil)
        #expect(ChannelSetupFixture.requested(by: ["-channelSetupFixture", "synthetic"], isDebugBuild: false) == nil)
    }

    @Test func theFixtureArgumentSelectsSpikeOrSyntheticInDebug() {
        #expect(ChannelSetupFixture.requested(by: ["-channelSetupFixture", "spike"], isDebugBuild: true) == .spike)
        #expect(ChannelSetupFixture.requested(by: ["-channelSetupFixture", "synthetic"], isDebugBuild: true) == .synthetic)
        #expect(ChannelSetupFixture.requested(by: ["-channelSetupFixture"], isDebugBuild: true) == nil)
        #expect(ChannelSetupFixture.requested(by: ["-channelSetupFixture", "tpc"], isDebugBuild: true) == nil)
        #expect(ChannelSetupFixture.requested(by: [], isDebugBuild: true) == nil)
    }

    @Test func syntheticFixtureLinesMatchTheOnDiskSyntheticFixture() throws {
        let onDisk = try ChannelSetupFixtureJSON.load("console-channel-inventory.synthetic.json")
        #expect(ChannelSetupFixture.synthetic.nodeLines == onDisk.nodeLines)
        #expect(ChannelSetupFixture.synthetic.model == onDisk.model)
    }

    @Test func spikeFixtureDiffersFromTheOnDiskSpikeOnlyInPersonNames() throws {
        let onDisk = try ChannelSetupFixtureJSON.load("console-channel-inventory.tpc-m32r-spike.json")
        let fixtureLines = ChannelSetupFixture.spike.nodeLines

        #expect(fixtureLines.count == onDisk.nodeLines.count)
        #expect(ChannelSetupFixture.spike.model == onDisk.model)

        let personNamePaths: Set<String> = ["/ch/01/config", "/ch/02/config", "/ch/03/config", "/ch/04/config"]
        for (fixtureLine, onDiskLine) in zip(fixtureLines, onDisk.nodeLines) {
            let path = try #require(ConsoleConfigLine(nodeLine: fixtureLine)?.path)
            if personNamePaths.contains(path) {
                #expect(fixtureLine != onDiskLine, "\(path)")
            } else {
                #expect(fixtureLine == onDiskLine, "\(path)")
            }
        }
    }

    @Test func eachFixtureReadResultIsComplete() {
        for fixture in ChannelSetupFixture.allCases {
            let result = fixture.readResult()
            #expect(result.missing.isEmpty, "\(fixture)")
            #expect(result.readCount == 56, "\(fixture)")
        }
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func renamingReadChangesOnlyThatStrip(_ fixture: ChannelSetupFixture) throws {
        let id = ConsoleStripID(kind: .ch, number: 3)
        let original = fixture.readResult()
        let renamed = fixture.readResult(renaming: id, to: "Guest Vocal")

        let originalStrip = try #require(original.inventory.strips[id])
        let renamedStrip = try #require(renamed.inventory.strips[id])
        #expect(renamedStrip.name == "Guest Vocal")
        #expect(renamedStrip.color == originalStrip.color)
        #expect(renamedStrip.source == originalStrip.source)
        #expect(renamed.missing.isEmpty)

        for otherID in original.inventory.stripIDs where otherID != id {
            #expect(renamed.inventory.strips[otherID] == original.inventory.strips[otherID], "\(otherID.configPath)")
        }
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func renamingAStripWithNoLineLeavesTheReadUnedited(_ fixture: ChannelSetupFixture) {
        let noLineID = ConsoleStripID(kind: .ch, number: 99)
        let original = fixture.readResult()
        let unedited = fixture.readResult(renaming: noLineID, to: "Nope")

        #expect(unedited == original)
    }
}
