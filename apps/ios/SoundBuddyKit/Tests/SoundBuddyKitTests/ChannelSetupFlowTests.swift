import Foundation
import Testing
@testable import SoundBuddyKit

/// Same scripted-per-call fake as `ConsoleStoreTests`, plus a datagram
/// recorder so the read-only-guard test can inspect exactly what left the
/// device.
private final class FakeTransport: ConsoleTransport, @unchecked Sendable {
    enum Script {
        case reply(Data)
        case timeout
        case throwing(ConsoleTransportError)
    }

    struct Call: Equatable {
        let host: ConsoleIPv4
        let port: UInt16
        let timeout: TimeInterval
    }

    private var script: [Script]
    private(set) var calls: [Call] = []
    private(set) var datagrams: [Data] = []
    private(set) var cancelCount = 0

    init(_ script: [Script] = []) {
        self.script = script
    }

    func queue(_ entries: [Script]) {
        script.append(contentsOf: entries)
    }

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data? {
        calls.append(Call(host: host, port: port, timeout: timeout))
        datagrams.append(datagram)
        guard !script.isEmpty else { return nil }
        switch script.removeFirst() {
        case let .reply(data): return data
        case .timeout: return nil
        case let .throwing(error): throw error
        }
    }

    func cancel() {
        cancelCount += 1
    }
}

/// Same path-keyed shape as `ConsoleChannelReaderTests`'s
/// `RecordingNodeTransport`, plus a scripted `/xinfo` reply so the existing
/// connect flow still works: the one transport the whole flow (connect, then
/// read) shares.
private final class FakeChannelTransport: ConsoleTransport, @unchecked Sendable {
    struct Call: Equatable {
        let host: ConsoleIPv4
        let port: UInt16
        let timeout: TimeInterval
    }

    private let xInfoDatagram: Data
    private var nodeLines: [String: String]
    private var silent: Set<String>
    private let onExchange: @Sendable (Int) -> Void

    private(set) var calls: [Call] = []
    private(set) var datagrams: [Data] = []
    private(set) var cancelCount = 0

    init(
        xInfoDatagram: Data,
        nodeLines: [String: String],
        silent: Set<String> = [],
        onExchange: @escaping @Sendable (Int) -> Void = { _ in }
    ) {
        self.xInfoDatagram = xInfoDatagram
        self.nodeLines = nodeLines
        self.silent = silent
        self.onExchange = onExchange
    }

    func unsilence(_ path: String, reply line: String) {
        silent.remove(path)
        nodeLines[path] = line
    }

    func resetRecording() {
        calls = []
        datagrams = []
    }

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data? {
        calls.append(Call(host: host, port: port, timeout: timeout))
        datagrams.append(datagram)
        onExchange(calls.count)

        guard let message = try? OSCCodec.decode(datagram) else { return nil }
        if message.address == "/xinfo" {
            return xInfoDatagram
        }
        guard message.address == "/node", message.arguments.count == 1, case let .string(value) = message.arguments[0] else {
            return nil
        }
        let path = "/" + value
        if silent.contains(path) { return nil }
        guard let line = nodeLines[path] else { return nil }
        return try? OSCCodec.encode(OSCMessage("/node", [.string(line + "\n")]))
    }

    func cancel() {
        cancelCount += 1
    }
}

private struct SyntheticInventoryFixture: Decodable {
    let model: String
    let nodeLines: [String]
}

private func syntheticNodeLines() throws -> [String: String] {
    let data = try Data(contentsOf: TestPaths.fixture("console-channel-inventory.synthetic.json"))
    let fixture = try JSONDecoder().decode(SyntheticInventoryFixture.self, from: data)
    var dict: [String: String] = [:]
    for line in fixture.nodeLines {
        guard let configLine = ConsoleConfigLine(nodeLine: line) else { continue }
        dict[configLine.path] = line
    }
    return dict
}

// Two fixtures per the issue's layout rule: no test may depend on the TPC
// spike console alone.
private let syntheticWiFi = ConsoleWiFiNetwork(address: ConsoleIPv4("10.0.0.20")!, netmask: ConsoleIPv4("255.255.255.0")!)
private let spikeWiFi = ConsoleWiFiNetwork(address: ConsoleIPv4("192.168.1.20")!, netmask: ConsoleIPv4("255.255.255.0")!)

private func syntheticXInfoDatagram() throws -> Data {
    try OSCCodec.encode(OSCMessage("/xinfo", [.string("10.0.0.7"), .string("Grace Chapel FOH"), .string("X32C"), .string("4.13")]))
}

private func spikeXInfoDatagram() throws -> Data {
    try OSCCodec.encode(OSCMessage("/xinfo", [.string("192.168.1.50"), .string("TPC"), .string("M32R"), .string("4.09")]))
}

@MainActor
private func makeConsent(granted: Bool = true) -> ConsoleConsentStore {
    let consent = ConsoleConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
    if granted { consent.grant() }
    return consent
}

@MainActor
private func makeFlow(
    transport: any ConsoleTransport,
    wifi: ConsoleWiFiNetwork?,
    consent: ConsoleConsentStore,
    defaults: UserDefaults = UserDefaults(suiteName: UUID().uuidString)!
) -> ChannelSetupFlow {
    let store = ConsoleStore(transport: transport, currentWiFi: { wifi }, isConsentGranted: { consent.isGranted }, defaults: defaults)
    return ChannelSetupFlow(store: store, consent: consent)
}

@MainActor
private func seedSavedConsole(_ saved: SavedConsole, in defaults: UserDefaults) throws {
    defaults.set(try JSONEncoder().encode(saved), forKey: ConsoleStore.defaultsKey)
}

@MainActor
@Suite struct ChannelSetupFlowTests {
    @Test func withoutConsentTheFlowStartsAtTheConsentStepAndSendsNothing() async {
        let transport = FakeTransport()
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent(granted: false))

        #expect(flow.step == .consent)

        await flow.store.open()
        await flow.store.connect(manualAddress: "10.0.0.7")

        #expect(transport.calls.isEmpty)
    }

    @Test func grantingConsentMovesToTheConnectStep() async {
        let transport = FakeTransport()
        let consent = makeConsent(granted: false)
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: consent)

        flow.grantConsent()

        #expect(flow.step == .connect)
        #expect(consent.isGranted)
        #expect(transport.calls.isEmpty)
    }

    @Test func manualConnectToASyntheticX32CompactContinuesWithItsXInfo() async throws {
        let transport = FakeTransport([.reply(try syntheticXInfoDatagram())])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")

        #expect(flow.step == .connect)
        guard case let .connected(info) = flow.store.phase else {
            Issue.record("expected .connected, got \(flow.store.phase)")
            return
        }
        #expect(info.ip == "10.0.0.7")
        #expect(info.name == "Grace Chapel FOH")
        #expect(info.model == "X32C")
        #expect(info.firmware == "4.13")

        let handedOff = flow.continueToChannels()

        #expect(handedOff == info)
        #expect(flow.step == .channels(info))
    }

    @Test func manualConnectToTheSpikeM32RContinuesWithItsXInfo() async throws {
        let transport = FakeTransport([.reply(try spikeXInfoDatagram())])
        let flow = makeFlow(transport: transport, wifi: spikeWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "192.168.1.50")

        #expect(flow.step == .connect)
        guard case let .connected(info) = flow.store.phase else {
            Issue.record("expected .connected, got \(flow.store.phase)")
            return
        }
        #expect(info.ip == "192.168.1.50")
        #expect(info.name == "TPC")
        #expect(info.model == "M32R")
        #expect(info.firmware == "4.09")

        let handedOff = flow.continueToChannels()

        #expect(handedOff == info)
        #expect(flow.step == .channels(info))
    }

    @Test func aFirstAttemptReplyConnectsInOneProbeWithinTheADR0060Budget() async throws {
        let transport = FakeTransport([.reply(try syntheticXInfoDatagram())])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")

        #expect(transport.calls.count == 1)
        #expect(transport.calls[0].timeout == ConsoleLinkTiming.probeTimeout)
        #expect(transport.calls[0].port == ConsoleLinkTiming.port)

        // The 1 s card budget plus the margin a third try needs, epsilon
        // compare against the float timing constants.
        let cardBudgetSeconds = 1.0
        let thirdTryMarginSeconds = 0.05
        let epsilon = 1e-9
        #expect(Double(ConsoleLinkTiming.probeAttempts) * ConsoleLinkTiming.probeTimeout <= cardBudgetSeconds + thirdTryMarginSeconds + epsilon)
    }

    @Test func withoutDiscoveryOpenProbesTheLastKnownConsoleOnce() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        try seedSavedConsole(SavedConsole(ip: "10.0.0.7", name: "Grace Chapel FOH", model: "X32C"), in: defaults)
        let transport = FakeTransport([.reply(try syntheticXInfoDatagram())])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent(), defaults: defaults)

        await flow.store.open()

        #expect(transport.calls.count == 1)
        #expect(transport.calls[0].host == ConsoleIPv4("10.0.0.7")!)
        guard case .connected = flow.store.phase else {
            Issue.record("expected .connected, got \(flow.store.phase)")
            return
        }
    }

    @Test func withoutDiscoveryOrASavedConsoleConnectOffersManualEntryAndSendsNothing() async {
        let transport = FakeTransport()
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.open()

        #expect(flow.store.phase == .manual(notice: nil))
        #expect(transport.calls.isEmpty)
        #expect(flow.step == .connect)
    }

    @Test func anUnreachableLastKnownConsoleFallsBackToManualEntryWithoutRetrying() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        try seedSavedConsole(SavedConsole(ip: "10.0.0.7", name: "Grace Chapel FOH", model: "X32C"), in: defaults)
        let transport = FakeTransport([.timeout, .timeout, .timeout, .timeout, .timeout, .timeout])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent(), defaults: defaults)

        await flow.store.open()

        guard case .noReply = flow.store.phase else {
            Issue.record("expected .noReply, got \(flow.store.phase)")
            return
        }
        #expect(transport.calls.count == ConsoleLinkTiming.probeAttempts)

        let countAfterOpen = transport.calls.count
        #expect(transport.calls.count == countAfterOpen)
    }

    @Test func aLocalNetworkDenialStopsAfterOneSendWithPermissionDenied() async {
        let transport = FakeTransport([.throwing(.localNetworkDenied)])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")

        #expect(flow.store.phase == .permissionDenied)
        #expect(transport.calls.count == 1)
    }

    @Test func foregroundingAfterADenialCancelsTheTransportAndTheNextConnectSucceeds() async throws {
        let transport = FakeTransport([.throwing(.localNetworkDenied)])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")
        #expect(flow.store.phase == .permissionDenied)

        flow.foregrounded()

        #expect(transport.cancelCount == 1)
        #expect(flow.store.phase == .manual(notice: nil))

        transport.queue([.reply(try syntheticXInfoDatagram())])
        await flow.store.connect(manualAddress: "10.0.0.7")

        guard case .connected = flow.store.phase else {
            Issue.record("expected .connected, got \(flow.store.phase)")
            return
        }
        #expect(flow.continueToChannels() != nil)
    }

    @Test func foregroundingWhileConnectedLeavesTheLinkAlone() async throws {
        let transport = FakeTransport([.reply(try syntheticXInfoDatagram())])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")
        guard case .connected = flow.store.phase else {
            Issue.record("expected .connected, got \(flow.store.phase)")
            return
        }

        flow.foregrounded()

        #expect(transport.cancelCount == 0)
        guard case .connected = flow.store.phase else {
            Issue.record("expected still .connected, got \(flow.store.phase)")
            return
        }
    }

    @Test func aNonX32FamilyModelIsUnsupportedAndCannotContinue() async throws {
        let datagram = try OSCCodec.encode(OSCMessage("/xinfo", [.string("10.0.0.9"), .string("Youth Room"), .string("XR18"), .string("1.17")]))
        let transport = FakeTransport([.reply(datagram)])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.9")

        guard case let .unsupported(info) = flow.step else {
            Issue.record("expected .unsupported, got \(flow.step)")
            return
        }
        #expect(info.model == "XR18")
        #expect(info.name == "Youth Room")
        #expect(flow.continueToChannels() == nil)
        #expect(flow.step == .unsupported(info))
    }

    @Test func isSupportedModelAcceptsEveryX32AndM32VariantAndRejectsOthers() {
        for model in ["X32", "X32C", "X32P", "X32RACK", "X32CORE", "M32", "M32C", "M32R"] {
            #expect(ChannelSetupFlow.isSupportedModel(model))
        }
        for model in ["XR18", "XR12", "WING", "", "m32r", " M32R"] {
            #expect(!ChannelSetupFlow.isSupportedModel(model))
        }
    }

    @Test func everyDatagramTheFlowSendsIsAZeroArgumentQueryThatPassesTheReadOnlyGuard() async throws {
        var allDatagrams: [Data] = []

        let savedDefaults = UserDefaults(suiteName: UUID().uuidString)!
        try seedSavedConsole(SavedConsole(ip: "10.0.0.7", name: "Grace Chapel FOH", model: "X32C"), in: savedDefaults)
        let openTransport = FakeTransport([.reply(try syntheticXInfoDatagram())])
        let openFlow = makeFlow(transport: openTransport, wifi: syntheticWiFi, consent: makeConsent(), defaults: savedDefaults)
        await openFlow.store.open()
        allDatagrams += openTransport.datagrams

        let manualTransport = FakeTransport([.reply(try spikeXInfoDatagram())])
        let manualFlow = makeFlow(transport: manualTransport, wifi: spikeWiFi, consent: makeConsent())
        await manualFlow.store.connect(manualAddress: "192.168.1.50")
        allDatagrams += manualTransport.datagrams

        let denialTransport = FakeTransport([.throwing(.localNetworkDenied)])
        let denialFlow = makeFlow(transport: denialTransport, wifi: syntheticWiFi, consent: makeConsent())
        await denialFlow.store.connect(manualAddress: "10.0.0.7")
        denialFlow.foregrounded()
        denialTransport.queue([.reply(try syntheticXInfoDatagram())])
        await denialFlow.store.connect(manualAddress: "10.0.0.7")
        allDatagrams += denialTransport.datagrams

        #expect(!allDatagrams.isEmpty)
        for datagram in allDatagrams {
            let message = try OSCCodec.decode(datagram)
            #expect(message.arguments.isEmpty)
            try ReadOnlyOSCGuard.check(message)
        }
    }

    @Test func channelsStepReadsAllStripsAndSummarises() async throws {
        let transport = FakeChannelTransport(xInfoDatagram: try syntheticXInfoDatagram(), nodeLines: try syntheticNodeLines())
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")
        #expect(flow.continueToChannels() != nil)

        await flow.readChannels()

        guard case let .done(result) = flow.channelRead else {
            Issue.record("expected .done, got \(flow.channelRead)")
            return
        }
        #expect(result.readCount == 56)
        #expect(result.missingSummary == nil)
    }

    @Test func channelsStepSummarisesTwoMissingStripsAndRetrySweepsOnlyThem() async throws {
        let silentPaths = ["/ch/01/config", "/bus/01/config"]
        let lines = try syntheticNodeLines()
        let transport = FakeChannelTransport(
            xInfoDatagram: try syntheticXInfoDatagram(), nodeLines: lines, silent: Set(silentPaths)
        )
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")
        #expect(flow.continueToChannels() != nil)
        await flow.readChannels()

        guard case let .done(result) = flow.channelRead else {
            Issue.record("expected .done, got \(flow.channelRead)")
            return
        }
        #expect(result.missingSummary == "2 channels didn't answer — Retry")

        transport.resetRecording()
        for path in silentPaths {
            transport.unsilence(path, reply: try #require(lines[path]))
        }

        await flow.retryMissingChannels()

        var sentPaths: Set<String> = []
        for datagram in transport.datagrams {
            let message = try OSCCodec.decode(datagram)
            guard message.address == "/node", case let .string(value) = message.arguments[0] else { continue }
            sentPaths.insert("/" + value)
        }
        #expect(sentPaths == Set(silentPaths))

        guard case let .done(retried) = flow.channelRead else {
            Issue.record("expected .done, got \(flow.channelRead)")
            return
        }
        #expect(retried.missing.isEmpty)
    }

    @Test func cancelReadStopsSendingAndReturnsToIdle() async throws {
        let cancelAtCall = 2
        let transport = FakeChannelTransport(
            xInfoDatagram: try syntheticXInfoDatagram(),
            nodeLines: try syntheticNodeLines(),
            onExchange: { count in
                if count == cancelAtCall { withUnsafeCurrentTask { $0?.cancel() } }
            }
        )
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")
        #expect(flow.continueToChannels() != nil)

        await flow.readChannels()

        #expect(flow.channelRead == .idle)
        #expect(transport.calls.count == cancelAtCall)
    }

    @Test func restartCancelsAndResetsTheRead() async throws {
        let transport = FakeChannelTransport(xInfoDatagram: try syntheticXInfoDatagram(), nodeLines: try syntheticNodeLines())
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        await flow.store.connect(manualAddress: "10.0.0.7")
        #expect(flow.continueToChannels() != nil)
        await flow.readChannels()

        guard case .done = flow.channelRead else {
            Issue.record("expected .done, got \(flow.channelRead)")
            return
        }

        flow.restart()

        #expect(flow.channelRead == .idle)
        #expect(flow.step == .connect)
    }

    @Test func readChannelsOutsideTheChannelsStepSendsNothing() async {
        let transport = FakeChannelTransport(xInfoDatagram: Data(), nodeLines: [:])
        let flow = makeFlow(transport: transport, wifi: syntheticWiFi, consent: makeConsent())

        #expect(flow.step == .connect)

        await flow.readChannels()

        #expect(flow.channelRead == .idle)
        #expect(transport.calls.isEmpty)
    }

    @Test func readingCopyShowsTheCount() {
        #expect(ChannelSetupCopy.reading(count: 12) == "Reading 12 channels…")
    }

    @Test func readSummaryCopySingularAndPlural() {
        #expect(ChannelSetupCopy.readSummary(count: 1) == "Read 1 channel")
        #expect(ChannelSetupCopy.readSummary(count: 56) == "Read 56 channels")
    }

    @Test func readFailedCopyIsActionableForEveryCase() {
        #expect(ChannelSetupCopy.readFailed(.transport(.localNetworkDenied)) == ConsoleConnectCopy.permissionDenied)
        #expect(ChannelSetupCopy.readFailed(.transport(.noWiFi)) == "Join the console's Wi-Fi, then tap Retry.")
        #expect(
            ChannelSetupCopy.readFailed(.transport(.failed("timeout")))
                == "Couldn't read the channels (timeout). Check the console is on, then tap Retry."
        )
        #expect(ChannelSetupCopy.readFailed(.unsupportedModel("XR18")) == ChannelSetupCopy.unsupportedDetail(model: "XR18"))
        #expect(ChannelSetupCopy.readFailed(.cancelled) == "Reading stopped. Tap Retry to read again.")
    }
}
