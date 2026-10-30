import Foundation
import Testing
@testable import SoundBuddyKit

private func confirmedSetup(_ fixture: ChannelSetupFixture, at date: Date = Date(timeIntervalSince1970: 1_700_000_000)) throws -> ConfirmedChannelSetup {
    let read = fixture.readResult()
    var review = ChannelSetupReview(console: ConsoleIdentity(fixture.xInfo), inventory: read.inventory, guesses: read.guesses, roomMicCandidates: read.roomMicCandidates)
    review.confirmAll()
    return try #require(review.done(confirmedAt: date))
}

@Suite struct ChannelSetupStoreTests {
    @Test(arguments: ChannelSetupFixture.allCases)
    func savedSetupReadsBackEqualByModelAndName(_ fixture: ChannelSetupFixture) throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let setup = try confirmedSetup(fixture)

        store.save(setup, ipHint: fixture.xInfo.ip)

        let identity = ConsoleIdentity(name: fixture.xInfo.name, model: fixture.model)
        let expected = SavedChannelSetup(setup: setup, ipHint: fixture.xInfo.ip)
        #expect(store.setup(for: identity) == .found(expected))

        let reopened = ChannelSetupStore(defaults: defaults)
        #expect(reopened.setup(for: identity) == .found(expected))
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func sameModelAndNameAtANewIPFindsTheSetup(_ fixture: ChannelSetupFixture) throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let setup = try confirmedSetup(fixture)
        store.save(setup, ipHint: "10.0.0.50")

        let movedReply = OSCMessage("/xinfo", [.string("10.0.0.99"), .string(fixture.xInfo.name), .string(fixture.model), .string(fixture.xInfo.firmware)])
        let movedInfo = try #require(ConsoleXInfo(reply: movedReply))
        let identity = ConsoleIdentity(movedInfo)

        guard case let .found(found) = store.setup(for: identity) else {
            Issue.record("expected .found")
            return
        }
        #expect(found.setup == setup)
        #expect(found.ipHint == "10.0.0.50")

        store.save(setup, ipHint: "10.0.0.99")
        guard case let .found(afterMove) = store.setup(for: identity) else {
            Issue.record("expected .found")
            return
        }
        #expect(afterMove.setup == setup)
        #expect(afterMove.ipHint == "10.0.0.99")
    }

    @Test func bothFixturesSavedAsTwoConsolesEachReturnOnlyTheirOwnSetup() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let spikeSetup = try confirmedSetup(.spike)
        let syntheticSetup = try confirmedSetup(.synthetic)

        store.save(spikeSetup)
        store.save(syntheticSetup)

        let spikeIdentity = ConsoleIdentity(ChannelSetupFixture.spike.xInfo)
        let syntheticIdentity = ConsoleIdentity(ChannelSetupFixture.synthetic.xInfo)

        guard case let .found(spikeFound) = store.setup(for: spikeIdentity) else {
            Issue.record("expected .found")
            return
        }
        guard case let .found(syntheticFound) = store.setup(for: syntheticIdentity) else {
            Issue.record("expected .found")
            return
        }
        #expect(spikeFound.setup == spikeSetup)
        #expect(syntheticFound.setup == syntheticSetup)
        #expect(spikeFound.setup != syntheticFound.setup)

        #expect(store.savedConsoles == [spikeIdentity, syntheticIdentity].sorted { ($0.model, $0.name) < ($1.model, $1.name) })
    }

    @Test func savingAgainForTheSameConsoleReplacesTheSetup() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let firstSetup = try confirmedSetup(.spike, at: Date(timeIntervalSince1970: 1_700_000_000))
        let secondSetup = try confirmedSetup(.spike, at: Date(timeIntervalSince1970: 1_700_000_500))

        store.save(firstSetup)
        store.save(secondSetup)

        let identity = ConsoleIdentity(ChannelSetupFixture.spike.xInfo)
        guard case let .found(found) = store.setup(for: identity) else {
            Issue.record("expected .found")
            return
        }
        #expect(found.setup == secondSetup)
        #expect(store.savedConsoles.count == 1)
    }

    @Test func unknownConsoleReturnsNotFound() throws {
        let emptyDefaults = UserDefaults(suiteName: UUID().uuidString)!
        let emptyStore = ChannelSetupStore(defaults: emptyDefaults)
        let unknown = ConsoleIdentity(name: "Nobody", model: "XR18")
        #expect(emptyStore.setup(for: unknown) == .notFound)

        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        store.save(try confirmedSetup(.spike))
        store.save(try confirmedSetup(.synthetic))
        #expect(store.setup(for: unknown) == .notFound)
    }

    @Test func entryWhoseStoredIdentityDiffersFromTheRequestedOneIsNotReturned() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let setupA = try confirmedSetup(.spike)
        let identityB = ConsoleIdentity(ChannelSetupFixture.synthetic.xInfo)

        store.save(setupA)
        let keyA = ChannelSetupStore.key(for: ConsoleIdentity(ChannelSetupFixture.spike.xInfo))
        let keyB = ChannelSetupStore.key(for: identityB)
        let raw = try #require(defaults.object(forKey: keyA) as? Data)
        defaults.set(raw, forKey: keyB)

        #expect(store.setup(for: identityB) == .notFound)
    }

    @Test func forgetRemovesOnlyThatConsolesSetup() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        store.save(try confirmedSetup(.spike))
        store.save(try confirmedSetup(.synthetic))
        let spikeIdentity = ConsoleIdentity(ChannelSetupFixture.spike.xInfo)
        let syntheticIdentity = ConsoleIdentity(ChannelSetupFixture.synthetic.xInfo)

        store.forget(spikeIdentity)

        #expect(store.setup(for: spikeIdentity) == .notFound)
        guard case .found = store.setup(for: syntheticIdentity) else {
            Issue.record("expected .found")
            return
        }
        #expect(store.savedConsoles == [syntheticIdentity])
    }

    @Test func olderSchemaVersionIsDiscardedWithNeedsRecheck() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let setup = try confirmedSetup(.spike)
        store.save(setup)
        let identity = ConsoleIdentity(ChannelSetupFixture.spike.xInfo)
        let key = ChannelSetupStore.key(for: identity)

        try tamperSchemaVersion(ChannelSetupStore.schemaVersion - 1, forKey: key, in: defaults)

        #expect(store.setup(for: identity) == .needsRecheck)
        #expect(defaults.object(forKey: key) == nil)
        #expect(store.setup(for: identity) == .notFound)
    }

    @Test func newerSchemaVersionIsDiscardedWithNeedsRecheck() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let setup = try confirmedSetup(.spike)
        store.save(setup)
        let identity = ConsoleIdentity(ChannelSetupFixture.spike.xInfo)
        let key = ChannelSetupStore.key(for: identity)

        try tamperSchemaVersion(ChannelSetupStore.schemaVersion + 1, forKey: key, in: defaults)

        #expect(store.setup(for: identity) == .needsRecheck)
        #expect(defaults.object(forKey: key) == nil)
        #expect(store.setup(for: identity) == .notFound)
    }

    @Test func garbageBytesReportNeedsRecheckWithoutCrashing() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let identity = ConsoleIdentity(name: "Nobody", model: "XR18")
        let key = ChannelSetupStore.key(for: identity)

        defaults.set(Data([0xFF, 0x00, 0x13, 0x37]), forKey: key)
        #expect(store.setup(for: identity) == .needsRecheck)
        #expect(defaults.object(forKey: key) == nil)

        defaults.set(Data("{}".utf8), forKey: key)
        #expect(store.setup(for: identity) == .needsRecheck)
        #expect(defaults.object(forKey: key) == nil)
    }

    @Test func nonDataValueReportsNeedsRecheckWithoutCrashing() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let identity = ConsoleIdentity(name: "Nobody", model: "XR18")
        let key = ChannelSetupStore.key(for: identity)

        defaults.set("not data", forKey: key)

        #expect(store.setup(for: identity) == .needsRecheck)
    }

    @Test func unreadableEntriesAreNotListedInSavedConsoles() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ChannelSetupStore(defaults: defaults)
        let setup = try confirmedSetup(.spike)
        store.save(setup)

        let garbageIdentity = ConsoleIdentity(name: "Nobody", model: "XR18")
        defaults.set(Data([0xFF, 0x00, 0x13, 0x37]), forKey: ChannelSetupStore.key(for: garbageIdentity))

        #expect(store.savedConsoles == [ConsoleIdentity(ChannelSetupFixture.spike.xInfo)])
    }

    @Test func storeHoldsOnlyUserDefaultsAndNoTransport() {
        let suite = UserDefaults(suiteName: UUID().uuidString)!
        let children = Mirror(reflecting: ChannelSetupStore(defaults: suite)).children
        #expect(children.count == 1)
        #expect(children.allSatisfy { $0.value is UserDefaults })
        #expect(!children.contains { $0.value is any ConsoleTransport })
        #expect(ChannelSetupStoreCopy.needsRecheck == "Setup needs a quick re-check")
    }
}

private func tamperSchemaVersion(_ version: Int, forKey key: String, in defaults: UserDefaults) throws {
    let data = try #require(defaults.object(forKey: key) as? Data)
    var json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    json["schemaVersion"] = version
    let tampered = try JSONSerialization.data(withJSONObject: json)
    defaults.set(tampered, forKey: key)
}
