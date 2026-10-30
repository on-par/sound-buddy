import Foundation
import Testing
@testable import SoundBuddyKit

/// Same path-keyed shape as `ChannelSetupFlowTests`' own `FakeChannelTransport`
/// — copied privately per the suite's no-shared-test-dirs rule. `/xinfo`
/// always answers with the fixed datagram; `/node` answers from `nodeLines`
/// keyed by path, or stays silent for a path with no entry.
private final class FakeChannelTransport: ConsoleTransport, @unchecked Sendable {
    private let xInfoDatagram: Data
    private let nodeLines: [String: String]
    private(set) var datagrams: [Data] = []
    private(set) var cancelCount = 0

    init(xInfoDatagram: Data, nodeLines: [String: String]) {
        self.xInfoDatagram = xInfoDatagram
        self.nodeLines = nodeLines
    }

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data? {
        datagrams.append(datagram)
        guard let message = try? OSCCodec.decode(datagram) else { return nil }
        if message.address == "/xinfo" { return xInfoDatagram }
        guard message.address == "/node", message.arguments.count == 1, case let .string(value) = message.arguments[0] else {
            return nil
        }
        guard let line = nodeLines["/" + value] else { return nil }
        return try? OSCCodec.encode(OSCMessage("/node", [.string(line + "\n")]))
    }

    func cancel() {
        cancelCount += 1
    }
}

/// A connect that always answers `/xinfo`, then throws `error` on every
/// following exchange — simulates the desk going unreachable partway through
/// the channel read that follows a reconnect.
private final class FailingAfterConnectTransport: ConsoleTransport, @unchecked Sendable {
    private let xInfoDatagram: Data
    private let error: ConsoleTransportError
    private(set) var cancelCount = 0

    init(xInfoDatagram: Data, error: ConsoleTransportError) {
        self.xInfoDatagram = xInfoDatagram
        self.error = error
    }

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data? {
        guard let message = try? OSCCodec.decode(datagram) else { return nil }
        if message.address == "/xinfo" { return xInfoDatagram }
        throw error
    }

    func cancel() {
        cancelCount += 1
    }
}

private func confirmedSetup(_ fixture: ChannelSetupFixture, at date: Date = Date(timeIntervalSince1970: 1_700_000_000)) throws -> ConfirmedChannelSetup {
    let read = fixture.readResult()
    var review = ChannelSetupReview(console: ConsoleIdentity(fixture.xInfo), inventory: read.inventory, guesses: read.guesses, roomMicCandidates: read.roomMicCandidates)
    review.confirmAll()
    return try #require(review.done(confirmedAt: date))
}

private func xInfoDatagram(for fixture: ChannelSetupFixture) throws -> Data {
    let info = fixture.xInfo
    return try OSCCodec.encode(OSCMessage("/xinfo", [.string(info.ip), .string(info.name), .string(info.model), .string(info.firmware)]))
}

private func nodeLinesByPath(_ lines: [String]) -> [String: String] {
    var dict: [String: String] = [:]
    for line in lines {
        guard let configLine = ConsoleConfigLine(nodeLine: line) else { continue }
        dict[configLine.path] = line
    }
    return dict
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

/// Builds a full `ConsoleChannelReadResult` from `fixture`'s own lines after
/// `edit`, mirroring a real `ConsoleChannelReader.read` result with no socket
/// involved — `ChannelSetupDiffTests`' `freshRead`, but returning the whole
/// result `ChannelSetupRecheck.evaluate` takes instead of a bare tuple.
private func freshRead(_ fixture: ChannelSetupFixture, edit: (inout [String]) -> Void = { _ in }) -> ConsoleChannelReadResult {
    var lines = fixture.nodeLines
    edit(&lines)
    guard var inventory = ConsoleChannelInventory(model: fixture.model) else {
        preconditionFailure("ChannelSetupFixture.model (\(fixture.model)) must be in ConsoleChannelInventory's model table")
    }
    for line in lines {
        inventory.apply(nodeLine: line)
    }
    let guesses = ChannelRoleGuesser.bundled().guess(ConsoleChannelReadResult.roleInputs(from: inventory))
    return ConsoleChannelReadResult(inventory: inventory, guesses: guesses, roomMicCandidates: ChannelRoleGuesser.roomMicCandidates(in: guesses))
}

/// Which strips each fixture's multi-field tests edit — different channel
/// numbers per fixture, so no test assumes a specific layout (the
/// `ChannelSetupDiffTests.diffEdits` idiom).
private struct RecheckEdits {
    let nameStrip: ConsoleStripID
    let newName: String
    let sourceStrip: ConsoleStripID
    let newSourceRaw: Int
}

extension ChannelSetupFixture {
    fileprivate var recheckEdits: RecheckEdits {
        switch self {
        case .spike:
            return RecheckEdits(
                nameStrip: ConsoleStripID(kind: .ch, number: 3), newName: "Priya",
                sourceStrip: ConsoleStripID(kind: .ch, number: 9), newSourceRaw: 20
            )
        case .synthetic:
            return RecheckEdits(
                nameStrip: ConsoleStripID(kind: .ch, number: 2), newName: "Choir Lead",
                sourceStrip: ConsoleStripID(kind: .ch, number: 7), newSourceRaw: 20
            )
        }
    }
}

/// Both fixtures' `xInfo.ip`s (10.0.0.7, 10.0.0.8) sit on this one /24, so
/// every test can share it regardless of which fixture it runs under.
private let recheckWiFi = ConsoleWiFiNetwork(address: ConsoleIPv4("10.0.0.20")!, netmask: ConsoleIPv4("255.255.255.0")!)

@MainActor
private func makeConsent(granted: Bool = true) -> ConsoleConsentStore {
    let consent = ConsoleConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
    if granted { consent.grant() }
    return consent
}

@MainActor
private func makeRecheck(
    transport: any ConsoleTransport,
    setupDefaults: UserDefaults,
    isEnabled: @escaping () -> Bool = { true }
) -> (recheck: ChannelSetupRecheck, store: ConsoleStore) {
    let consent = makeConsent()
    let store = ConsoleStore(
        transport: transport, currentWiFi: { recheckWiFi }, isConsentGranted: { consent.isGranted },
        defaults: UserDefaults(suiteName: UUID().uuidString)!
    )
    let setupStore = ChannelSetupStore(defaults: setupDefaults)
    let recheck = ChannelSetupRecheck(store: store, setupStore: setupStore, isEnabled: isEnabled)
    return (recheck, store)
}

private func isStringArgument(_ argument: OSCArgument) -> Bool {
    if case .string = argument { return true }
    return false
}

@MainActor
@Suite struct ChannelSetupRecheckTests {
    @Test(arguments: ChannelSetupFixture.allCases)
    func noSavedSetupAppliesNothingAndOffersDiscover(_ fixture: ChannelSetupFixture) async throws {
        let transport = FakeChannelTransport(xInfoDatagram: try xInfoDatagram(for: fixture), nodeLines: nodeLinesByPath(fixture.nodeLines))
        let (recheck, store) = makeRecheck(transport: transport, setupDefaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.connect(manualAddress: fixture.xInfo.ip)
        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }

        await recheck.connected(info)

        #expect(recheck.state == .offerSetup(ConsoleIdentity(info)))
        #expect(recheck.appliedSetup == nil)
        let banner = try #require(recheck.banner)
        #expect(banner.action == .discover)
        #expect(banner.actionTitle == ChannelSetupCopy.rowTitle)
        for datagram in transport.datagrams {
            let message = try OSCCodec.decode(datagram)
            #expect(message.address != "/node")
        }
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func storeNeedsRecheckShowsQuickRecheckBanner(_ fixture: ChannelSetupFixture) async throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        setupDefaults.set(Data([0xFF, 0x00, 0x13, 0x37]), forKey: ChannelSetupStore.key(for: ConsoleIdentity(fixture.xInfo)))

        let transport = FakeChannelTransport(xInfoDatagram: try xInfoDatagram(for: fixture), nodeLines: nodeLinesByPath(fixture.nodeLines))
        let (recheck, store) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        await store.connect(manualAddress: fixture.xInfo.ip)
        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }

        await recheck.connected(info)

        #expect(recheck.state == .needsRecheck)
        let banner = try #require(recheck.banner)
        #expect(banner.message == ChannelSetupStoreCopy.needsRecheck)
        #expect(banner.action == .discover)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func reconnectWithUnchangedDeskAppliesSilently(_ fixture: ChannelSetupFixture) async throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        let saved = try confirmedSetup(fixture)
        try ChannelSetupStore(defaults: setupDefaults).save(saved, ipHint: fixture.xInfo.ip)

        let transport = FakeChannelTransport(xInfoDatagram: try xInfoDatagram(for: fixture), nodeLines: nodeLinesByPath(fixture.nodeLines))
        let (recheck, store) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        await store.connect(manualAddress: fixture.xInfo.ip)
        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }

        await recheck.connected(info)

        #expect(recheck.state == .applied(saved))
        #expect(recheck.banner == nil)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func colorOnlyChangeAppliesAndSavesNewColors(_ fixture: ChannelSetupFixture) throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        let setupStore = ChannelSetupStore(defaults: setupDefaults)
        let saved = try confirmedSetup(fixture)
        try setupStore.save(saved, ipHint: fixture.xInfo.ip)

        let recoloredID = fixture.recheckEdits.nameStrip
        let savedStrip = try #require(saved.strips.first { $0.id == recoloredID })
        let newColor: ConsoleChannelColor = savedStrip.color == .green ? .blue : .green
        let read = freshRead(fixture) { lines in recolor(&lines, id: recoloredID, to: newColor) }

        let transport = FakeChannelTransport(xInfoDatagram: Data(), nodeLines: [:])
        let (recheck, _) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        recheck.evaluate(SavedChannelSetup(setup: saved, ipHint: fixture.xInfo.ip), info: fixture.xInfo, read: read)

        guard case let .applied(merged) = recheck.state else {
            Issue.record("expected .applied, got \(recheck.state)")
            return
        }
        let mergedStrip = try #require(merged.strips.first { $0.id == recoloredID })
        #expect(mergedStrip.color == newColor)

        guard case let .found(reread) = setupStore.setup(for: ConsoleIdentity(fixture.xInfo)) else {
            Issue.record("expected .found")
            return
        }
        let rereadStrip = try #require(reread.setup.strips.first { $0.id == recoloredID })
        #expect(rereadStrip.color == newColor)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func nameAndSourceChangeShowsTwoChangedBanner(_ fixture: ChannelSetupFixture) throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        let saved = try confirmedSetup(fixture)
        try ChannelSetupStore(defaults: setupDefaults).save(saved, ipHint: fixture.xInfo.ip)

        let edits = fixture.recheckEdits
        let read = freshRead(fixture) { lines in
            rename(&lines, id: edits.nameStrip, to: edits.newName)
            resource(&lines, id: edits.sourceStrip, to: edits.newSourceRaw)
        }

        let transport = FakeChannelTransport(xInfoDatagram: Data(), nodeLines: [:])
        let (recheck, _) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        recheck.evaluate(SavedChannelSetup(setup: saved, ipHint: fixture.xInfo.ip), info: fixture.xInfo, read: read)

        guard case let .needsReview(_, _, diff) = recheck.state else {
            Issue.record("expected .needsReview, got \(recheck.state)")
            return
        }
        #expect(Set(diff.changed) == Set([edits.nameStrip, edits.sourceStrip]))
        let banner = try #require(recheck.banner)
        #expect(banner.message == "2 channels changed on the desk since your setup — Review")
        #expect(banner.action == .review)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func reviewActionOpensOnlyTheChangedStripsWithFreshGuesses(_ fixture: ChannelSetupFixture) throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        let saved = try confirmedSetup(fixture)
        try ChannelSetupStore(defaults: setupDefaults).save(saved, ipHint: fixture.xInfo.ip)

        let edits = fixture.recheckEdits
        let read = freshRead(fixture) { lines in
            rename(&lines, id: edits.nameStrip, to: edits.newName)
            resource(&lines, id: edits.sourceStrip, to: edits.newSourceRaw)
        }

        let transport = FakeChannelTransport(xInfoDatagram: Data(), nodeLines: [:])
        let (recheck, store) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        recheck.evaluate(SavedChannelSetup(setup: saved, ipHint: fixture.xInfo.ip), info: fixture.xInfo, read: read)

        guard case let .needsReview(info, readResult, diff) = recheck.state else {
            Issue.record("expected .needsReview, got \(recheck.state)")
            return
        }

        let flow = ChannelSetupFlow(store: store, consent: makeConsent())
        flow.beginRecheckReview(info: info, read: readResult, diff: diff)

        let review = try #require(flow.review)
        #expect(Set(review.rows.map(\.id)) == Set([edits.nameStrip, edits.sourceStrip]))
        let freshGuessByID = Dictionary(uniqueKeysWithValues: readResult.guesses.map { ($0.id, $0) })
        for row in review.rows {
            let guess = try #require(freshGuessByID[row.id.configPath])
            #expect(row.role == guess.role, "\(row.id.configPath)")
        }
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func renamedRoomMicIsNamedAndWithheldUntilAdopted(_ fixture: ChannelSetupFixture) throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        let setupStore = ChannelSetupStore(defaults: setupDefaults)
        let saved = try confirmedSetup(fixture)
        try setupStore.save(saved, ipHint: fixture.xInfo.ip)
        let roomMicID = try #require(saved.roomMic)

        let read = freshRead(fixture) { lines in rename(&lines, id: roomMicID, to: "Kick 2") }

        let transport = FakeChannelTransport(xInfoDatagram: Data(), nodeLines: [:])
        let (recheck, _) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        recheck.evaluate(SavedChannelSetup(setup: saved, ipHint: fixture.xInfo.ip), info: fixture.xInfo, read: read)

        let banner = try #require(recheck.banner)
        #expect(banner.detail?.contains(roomMicID.fallbackName) == true)
        #expect(recheck.effectiveRoomMic == nil)

        let merged = try #require(recheck.appliedSetup)
        recheck.adopt(merged, ipHint: fixture.xInfo.ip)

        #expect(recheck.effectiveRoomMic == merged.roomMic)
        guard case let .found(reread) = setupStore.setup(for: ConsoleIdentity(fixture.xInfo)) else {
            Issue.record("expected .found")
            return
        }
        #expect(reread.setup == merged)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func consoleAtANewIPWithSameIdentityApplies(_ fixture: ChannelSetupFixture) async throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        let saved = try confirmedSetup(fixture)
        try ChannelSetupStore(defaults: setupDefaults).save(saved, ipHint: "10.0.0.7")

        let movedIP = "10.0.0.123"
        let movedReply = OSCMessage("/xinfo", [.string(movedIP), .string(fixture.xInfo.name), .string(fixture.model), .string(fixture.xInfo.firmware)])
        let transport = FakeChannelTransport(xInfoDatagram: try OSCCodec.encode(movedReply), nodeLines: nodeLinesByPath(fixture.nodeLines))
        let (recheck, store) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        await store.connect(manualAddress: movedIP)
        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }

        await recheck.connected(info)

        #expect(recheck.state == .applied(saved))
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func reconnectPathSendsOnlyReadOnlyQueries(_ fixture: ChannelSetupFixture) async throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        try ChannelSetupStore(defaults: setupDefaults).save(try confirmedSetup(fixture), ipHint: fixture.xInfo.ip)

        let transport = FakeChannelTransport(xInfoDatagram: try xInfoDatagram(for: fixture), nodeLines: nodeLinesByPath(fixture.nodeLines))
        let (recheck, store) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        await store.connect(manualAddress: fixture.xInfo.ip)
        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }

        await recheck.connected(info)

        #expect(!transport.datagrams.isEmpty)
        for datagram in transport.datagrams {
            let message = try OSCCodec.decode(datagram)
            #expect(message.address == "/xinfo" || message.address == "/node", "\(message.address)")
            #expect(message.arguments.isEmpty || (message.arguments.count == 1 && isStringArgument(message.arguments[0])))
            try ReadOnlyOSCGuard.check(message)
        }
    }

    @Test func connectedInfoFiresOnlyOnTransitionIntoConnected() throws {
        let infoA = ChannelSetupFixture.spike.xInfo
        let ipA = try #require(ConsoleIPv4(infoA.ip))

        #expect(ChannelSetupRecheck.connectedInfo(from: .manual(notice: nil), to: .connected(infoA)) == infoA)
        #expect(ChannelSetupRecheck.connectedInfo(from: .connected(infoA), to: .connected(infoA)) == nil)
        #expect(ChannelSetupRecheck.connectedInfo(from: .connecting(ipA), to: .noReply(ipA)) == nil)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func disabledFlagSendsNothing(_ fixture: ChannelSetupFixture) async throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        try ChannelSetupStore(defaults: setupDefaults).save(try confirmedSetup(fixture), ipHint: fixture.xInfo.ip)

        let transport = FakeChannelTransport(xInfoDatagram: try xInfoDatagram(for: fixture), nodeLines: nodeLinesByPath(fixture.nodeLines))
        let (recheck, store) = makeRecheck(transport: transport, setupDefaults: setupDefaults, isEnabled: { false })

        await store.connect(manualAddress: fixture.xInfo.ip)
        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }
        let datagramsAfterConnect = transport.datagrams.count

        await recheck.connected(info)

        #expect(recheck.state == .idle)
        #expect(transport.datagrams.count == datagramsAfterConnect)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func readFailureShowsActionableBanner(_ fixture: ChannelSetupFixture) async throws {
        let setupDefaults = UserDefaults(suiteName: UUID().uuidString)!
        try ChannelSetupStore(defaults: setupDefaults).save(try confirmedSetup(fixture), ipHint: fixture.xInfo.ip)

        let transport = FailingAfterConnectTransport(xInfoDatagram: try xInfoDatagram(for: fixture), error: .failed("down"))
        let (recheck, store) = makeRecheck(transport: transport, setupDefaults: setupDefaults)

        await store.connect(manualAddress: fixture.xInfo.ip)
        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }

        await recheck.connected(info)

        guard case let .readFailed(error) = recheck.state else {
            Issue.record("expected .readFailed, got \(recheck.state)")
            return
        }
        let banner = try #require(recheck.banner)
        #expect(banner.message == ChannelSetupCopy.readFailed(error))
        #expect(banner.action == .discover)
    }
}
