import Foundation
import Testing
@testable import SoundBuddyKit

/// Same fixture shape as `ConsoleChannelInventoryTests`'s private fixture:
/// a `/node` capture plus the strips it should decode to.
private struct ConsoleChannelReaderFixture: Decodable {
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

    static func load(_ name: String) throws -> ConsoleChannelReaderFixture {
        try JSONDecoder().decode(Self.self, from: Data(contentsOf: TestPaths.fixture(name)))
    }

    /// `/node` capture keyed by configPath, for `RecordingNodeTransport`.
    func nodeLinesByPath() -> [String: String] {
        var dict: [String: String] = [:]
        for line in nodeLines {
            guard let configLine = ConsoleConfigLine(nodeLine: line) else { continue }
            dict[configLine.path] = line
        }
        return dict
    }

    /// The inventory you'd get by applying every fixture line directly,
    /// bypassing the reader/transport entirely — the "known good" baseline
    /// the reader's own result is compared against.
    func directInventory() throws -> ConsoleChannelInventory {
        var inventory = try #require(ConsoleChannelInventory(model: model))
        for line in nodeLines {
            #expect(inventory.apply(nodeLine: line) == true, "expected \"\(line)\" to apply")
        }
        return inventory
    }
}

private func makeXInfo(model: String, ip: String = "10.0.0.50") -> ConsoleXInfo {
    let message = OSCMessage("/xinfo", [.string(ip), .string("Test Console"), .string(model), .string("4.09")])
    return ConsoleXInfo(reply: message)!
}

private func decodedNodePath(_ datagram: Data) throws -> String {
    let message = try OSCCodec.decode(datagram)
    guard message.address == "/node", message.arguments.count == 1, case let .string(value) = message.arguments[0] else {
        struct NotANodeQuery: Error {}
        throw NotANodeQuery()
    }
    return "/" + value
}

/// A path-keyed fake: decodes every outgoing datagram, replies with the
/// configured `/node` line for that path unless the path is silenced or
/// still has drops remaining. Serial-only (the reader never issues
/// concurrent exchanges), so `@unchecked Sendable` is safe.
private final class RecordingNodeTransport: ConsoleTransport, @unchecked Sendable {
    struct Call {
        let datagram: Data
        let host: ConsoleIPv4
        let port: UInt16
        let timeout: TimeInterval
    }

    private var nodeLines: [String: String]
    private var dropFirst: [String: Int]
    private var silent: Set<String>
    private let onExchange: @Sendable (Int) -> Void

    private(set) var calls: [Call] = []

    init(
        nodeLines: [String: String],
        dropFirst: [String: Int] = [:],
        silent: Set<String> = [],
        onExchange: @escaping @Sendable (Int) -> Void = { _ in }
    ) {
        self.nodeLines = nodeLines
        self.dropFirst = dropFirst
        self.silent = silent
        self.onExchange = onExchange
    }

    var datagrams: [Data] { calls.map(\.datagram) }

    func reset() {
        calls = []
    }

    /// Serves an always-missing path from now on (used by the retry test to
    /// turn a silent strip into one that answers).
    func unsilence(_ path: String, reply line: String) {
        silent.remove(path)
        nodeLines[path] = line
    }

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data? {
        calls.append(Call(datagram: datagram, host: host, port: port, timeout: timeout))
        onExchange(calls.count)

        guard let message = try? OSCCodec.decode(datagram),
              message.address == "/node", message.arguments.count == 1,
              case let .string(value) = message.arguments[0]
        else { return nil }

        let path = "/" + value
        if silent.contains(path) { return nil }
        if let remaining = dropFirst[path], remaining > 0 {
            dropFirst[path] = remaining - 1
            return nil
        }
        guard let line = nodeLines[path] else { return nil }
        return try? OSCCodec.encode(OSCMessage("/node", [.string(line + "\n")]))
    }

    func cancel() {}
}

/// A transport whose first exchange throws, for the transport-error path.
private final class ThrowingTransport: ConsoleTransport, @unchecked Sendable {
    private let error: ConsoleTransportError
    private(set) var datagrams: [Data] = []

    init(throwing error: ConsoleTransportError) {
        self.error = error
    }

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data? {
        datagrams.append(datagram)
        throw error
    }

    func cancel() {}
}

@Suite struct ConsoleChannelReaderTests {
    private static let spikeFixtureName = "console-channel-inventory.tpc-m32r-spike.json"
    private static let syntheticFixtureName = "console-channel-inventory.synthetic.json"
    private static let timeoutEpsilon = 1e-9
    private static let host = ConsoleIPv4("10.0.0.50")!
    private static let readTimeBudget = Duration.seconds(3)

    private func assertStripsMatch(_ inventory: ConsoleChannelInventory, _ fixture: ConsoleChannelReaderFixture) throws {
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

    @Test func readsTheSpikeFixtureInventoryAndGuesses() async throws {
        let fixture = try ConsoleChannelReaderFixture.load(Self.spikeFixtureName)
        let transport = RecordingNodeTransport(nodeLines: fixture.nodeLinesByPath())
        let reader = ConsoleChannelReader(transport: transport)

        let result = try await reader.read(makeXInfo(model: fixture.model), host: Self.host).get()

        #expect(result.inventory.stripIDs.filter { $0.kind == .ch }.count == 32)
        #expect(result.inventory.stripIDs.filter { $0.kind == .auxin }.count == 8)
        #expect(result.inventory.stripIDs.filter { $0.kind == .bus }.count == 16)
        try assertStripsMatch(result.inventory, fixture)
        #expect(result.missing.isEmpty)
        #expect(result.missingSummary == nil)

        let expectedGuesses = ChannelRoleGuesser.bundled().guess(ConsoleChannelReadResult.roleInputs(from: try fixture.directInventory()))
        #expect(result.guesses == expectedGuesses)
        #expect(result.roomMicCandidates == ChannelRoleGuesser.roomMicCandidates(in: expectedGuesses))
    }

    @Test func readsTheSyntheticFixtureOnADifferentModelString() async throws {
        let fixture = try ConsoleChannelReaderFixture.load(Self.syntheticFixtureName)
        let spike = try ConsoleChannelReaderFixture.load(Self.spikeFixtureName)
        let transport = RecordingNodeTransport(nodeLines: fixture.nodeLinesByPath())
        let reader = ConsoleChannelReader(transport: transport)

        let result = try await reader.read(makeXInfo(model: "X32C"), host: Self.host).get()

        try assertStripsMatch(result.inventory, fixture)
        #expect(result.missing.isEmpty)
        #expect(result.missingSummary == nil)

        let expectedGuesses = ChannelRoleGuesser.bundled().guess(ConsoleChannelReadResult.roleInputs(from: try fixture.directInventory()))
        #expect(result.guesses == expectedGuesses)
        #expect(result.roomMicCandidates == ChannelRoleGuesser.roomMicCandidates(in: expectedGuesses))

        let spikeNames = Set(spike.expected.map(\.name))
        #expect(fixture.expected.contains { !spikeNames.contains($0.name) })
    }

    @Test func sweepReAsksOnlyTheTwoStripsWhoseWalkRepliesWereDropped() async throws {
        let fixture = try ConsoleChannelReaderFixture.load(Self.syntheticFixtureName)
        let droppedPaths = ["/ch/04/config", "/bus/02/config"]
        let transport = RecordingNodeTransport(
            nodeLines: fixture.nodeLinesByPath(),
            dropFirst: Dictionary(uniqueKeysWithValues: droppedPaths.map { ($0, ConsoleLinkTiming.probeAttempts) })
        )
        let reader = ConsoleChannelReader(transport: transport)

        let result = try await reader.read(makeXInfo(model: fixture.model), host: Self.host).get()

        #expect(transport.calls.count == 54 * 1 + 2 * ConsoleLinkTiming.probeAttempts + droppedPaths.count)
        let lastTwo = try transport.calls.suffix(droppedPaths.count).map { try decodedNodePath($0.datagram) }
        #expect(lastTwo == droppedPaths)
        #expect(result.missing.isEmpty)
    }

    @Test func twoSilentStripsAreReportedMissingAndRetrySendsOnlyTheirQueries() async throws {
        let fixture = try ConsoleChannelReaderFixture.load(Self.syntheticFixtureName)
        let silentPaths = ["/ch/01/config", "/bus/01/config"]
        let lines = fixture.nodeLinesByPath()
        let transport = RecordingNodeTransport(nodeLines: lines, silent: Set(silentPaths))
        let reader = ConsoleChannelReader(transport: transport)

        let result = try await reader.read(makeXInfo(model: fixture.model), host: Self.host).get()

        #expect(result.missing == [ConsoleStripID(kind: .ch, number: 1), ConsoleStripID(kind: .bus, number: 1)])
        #expect(result.missingSummary == "2 channels didn't answer — Retry")

        transport.reset()
        for path in silentPaths {
            transport.unsilence(path, reply: try #require(lines[path]))
        }

        let retried = try await reader.retryMissing(result, host: Self.host).get()

        #expect(transport.calls.count == silentPaths.count)
        let retriedPaths = try transport.calls.map { try decodedNodePath($0.datagram) }
        #expect(Set(retriedPaths) == Set(silentPaths))
        #expect(retried.missing.isEmpty)
    }

    @Test func everyDatagramOfWalkSweepAndRetryIsAGuardedReadOnlyQuery() async throws {
        let fixture = try ConsoleChannelReaderFixture.load(Self.syntheticFixtureName)
        var lines = fixture.nodeLinesByPath()
        lines["/ch/04/config"] = "/ch/04/config \"X\" 1 PK 4" // unknown color token -> malformed, per-field sweep
        let transport = RecordingNodeTransport(nodeLines: lines)
        let reader = ConsoleChannelReader(transport: transport)

        let result = try await reader.read(makeXInfo(model: fixture.model), host: Self.host).get()
        _ = await reader.retryMissing(result, host: Self.host)

        #expect(!transport.calls.isEmpty)
        for call in transport.calls {
            let message = try OSCCodec.decode(call.datagram)
            #expect(message.arguments.isEmpty || message.address == "/node")
            #expect(throws: Never.self) {
                try ReadOnlyOSCGuard.check(message)
            }
        }
    }

    @Test func theChannelReadPathNeverReferencesConsoleEQWriter() throws {
        let paths = [
            TestPaths.iosRoot.appending(path: "SoundBuddyKit/Sources/SoundBuddyKit/Console/ConsoleChannelReader.swift"),
            TestPaths.iosRoot.appending(path: "SoundBuddyKit/Sources/SoundBuddyKit/Console/ChannelSetupFlow.swift"),
            TestPaths.iosRoot.appending(path: "SoundBuddy/ChannelSetupFlowView.swift"),
        ]
        for path in paths {
            let source = try String(contentsOf: path, encoding: .utf8)
            #expect(!source.contains("ConsoleEQWriter"), "\(path.lastPathComponent) must not reference ConsoleEQWriter")
        }
    }

    @Test func eachQueryIsTriedAtMostThreeTimesAt350ms() async throws {
        let fixture = try ConsoleChannelReaderFixture.load(Self.syntheticFixtureName)
        let silentPath = "/ch/04/config"
        let transport = RecordingNodeTransport(nodeLines: fixture.nodeLinesByPath(), silent: [silentPath])
        let reader = ConsoleChannelReader(transport: transport)

        _ = await reader.read(makeXInfo(model: fixture.model), host: Self.host)

        for call in transport.calls {
            #expect(abs(call.timeout - ConsoleLinkTiming.probeTimeout) < Self.timeoutEpsilon)
            #expect(call.port == ConsoleLinkTiming.port)
            #expect(call.host == Self.host)
        }

        var countsByPath: [String: Int] = [:]
        for call in transport.calls {
            countsByPath[try decodedNodePath(call.datagram), default: 0] += 1
        }
        #expect(countsByPath[silentPath] == 2 * ConsoleLinkTiming.probeAttempts)
        for (path, count) in countsByPath where path != silentPath {
            #expect(count == 1)
        }
    }

    @Test func aQuietFakeNetworkReadFinishesWithinThreeSeconds() async throws {
        let fixture = try ConsoleChannelReaderFixture.load(Self.syntheticFixtureName)
        let transport = RecordingNodeTransport(nodeLines: fixture.nodeLinesByPath())
        let reader = ConsoleChannelReader(transport: transport)

        let clock = ContinuousClock()
        let start = clock.now
        let result = await reader.read(makeXInfo(model: fixture.model), host: Self.host)
        let elapsed = clock.now - start

        #expect(result.isSuccess)
        #expect(elapsed < Self.readTimeBudget)
    }

    @Test func cancellingMidWalkSendsNoFurtherDatagram() async throws {
        let fixture = try ConsoleChannelReaderFixture.load(Self.syntheticFixtureName)
        let cancelAtCall = 5
        let transport = RecordingNodeTransport(nodeLines: fixture.nodeLinesByPath(), onExchange: { count in
            if count == cancelAtCall {
                withUnsafeCurrentTask { $0?.cancel() }
            }
        })
        let reader = ConsoleChannelReader(transport: transport)

        let task = Task { await reader.read(makeXInfo(model: fixture.model), host: Self.host) }
        let result = await task.value

        #expect(result == .failure(.cancelled))
        #expect(transport.datagrams.count == cancelAtCall)
    }

    @Test func aTransportErrorStopsTheRead() async {
        let transport = ThrowingTransport(throwing: .localNetworkDenied)
        let reader = ConsoleChannelReader(transport: transport)

        let result = await reader.read(makeXInfo(model: "X32"), host: Self.host)

        #expect(result == .failure(.transport(.localNetworkDenied)))
        #expect(transport.datagrams.count == 1)
    }

    @Test func anUnsupportedModelSendsNothing() async {
        let transport = RecordingNodeTransport(nodeLines: [:])
        let reader = ConsoleChannelReader(transport: transport)

        let result = await reader.read(makeXInfo(model: "XR18"), host: Self.host)

        #expect(result == .failure(.unsupportedModel("XR18")))
        #expect(transport.calls.isEmpty)
    }

    @Test func roleInputsSkipIncompleteStripsAndKeepWalkOrder() {
        var inventory = ConsoleChannelInventory(stripCounts: [.ch: 3, .auxin: 1])
        #expect(inventory.apply(nodeLine: "/ch/01/config \"A\" 1 RD 1") == true)
        #expect(inventory.apply(nodeLine: "/ch/03/config \"C\" 1 BL 3") == true)
        #expect(inventory.apply(nodeLine: "/auxin/01/config \"D\" 1 GN 5") == true)
        // /ch/02/config is left incomplete.

        let inputs = ConsoleChannelReadResult.roleInputs(from: inventory)

        #expect(inputs.map(\.id) == ["/ch/01/config", "/ch/03/config", "/auxin/01/config"])
        #expect(inputs.map(\.name) == ["A", "C", "D"])
    }
}

private extension Result {
    var isSuccess: Bool {
        switch self {
        case .success: true
        case .failure: false
        }
    }
}
