import Foundation
import Testing
@testable import SoundBuddyKit

private final class FakeTransport: ConsoleTransport, @unchecked Sendable {
    enum Script {
        case reply(Data)
        case timeout
        case throwing(ConsoleTransportError)
    }

    struct Call: Equatable {
        let datagram: Data
        let host: ConsoleIPv4
        let port: UInt16
        let timeout: TimeInterval
    }

    private var script: [Script]
    private(set) var calls: [Call] = []

    init(_ script: [Script] = []) {
        self.script = script
    }

    func exchange(
        _ datagram: Data,
        with host: ConsoleIPv4,
        port: UInt16,
        timeout: TimeInterval
    ) async throws(ConsoleTransportError) -> Data? {
        calls.append(Call(datagram: datagram, host: host, port: port, timeout: timeout))
        guard !script.isEmpty else { return nil }
        switch script.removeFirst() {
        case let .reply(data): return data
        case .timeout: return nil
        case let .throwing(error): throw error
        }
    }

    func cancel() {}

    func queue(_ entries: [Script]) {
        script.append(contentsOf: entries)
    }
}

private func xinfoReplyDatagram(ip: String, name: String, model: String, firmware: String) throws -> Data {
    try OSCCodec.encode(OSCMessage("/xinfo", [
        .string(ip), .string(name), .string(model), .string(firmware),
    ]))
}

private func xinfo(ip: String, name: String, model: String, firmware: String) -> ConsoleXInfo {
    ConsoleXInfo(reply: OSCMessage("/xinfo", [
        .string(ip), .string(name), .string(model), .string(firmware),
    ]))!
}

private let m32WiFi = ConsoleWiFiNetwork(
    address: ConsoleIPv4("192.168.1.20")!,
    netmask: ConsoleIPv4("255.255.255.0")!
)

private let x32WiFi = ConsoleWiFiNetwork(
    address: ConsoleIPv4("10.0.4.7")!,
    netmask: ConsoleIPv4("255.255.255.0")!
)

@MainActor
private func makeFlow(
    transport: FakeTransport,
    defaults: UserDefaults = UserDefaults(suiteName: UUID().uuidString)!,
    wifi: ConsoleWiFiNetwork? = m32WiFi,
    consentGranted: Bool = true
) -> ChannelSetupFlow {
    let consent = consentGranted
    let store = ConsoleStore(
        transport: transport,
        currentWiFi: { wifi },
        isConsentGranted: { consent },
        defaults: defaults
    )
    return ChannelSetupFlow(store: store, isConsentGranted: { consent })
}

@MainActor
@Suite struct ChannelSetupFlowTests {
    @Test func withoutConsentTheFirstStepIsConsentAndNothingIsSent() async {
        let transport = FakeTransport()
        let flow = makeFlow(transport: transport, consentGranted: false)

        #expect(flow.step == .consent)
        await flow.store.open()
        await flow.store.connect(manualAddress: "192.168.1.50")

        #expect(transport.calls.isEmpty)
        #expect(flow.step == .consent)
    }

    @Test func aReachableConsoleAtATypedIPIsIdentifiedOnTheFirstProbe() async throws {
        let transport = FakeTransport([
            .reply(try xinfoReplyDatagram(ip: "192.168.1.50", name: "Grace Main", model: "M32R", firmware: "2.10")),
        ])
        let flow = makeFlow(transport: transport)

        await flow.store.connect(manualAddress: "192.168.1.50")

        let expected = xinfo(ip: "192.168.1.50", name: "Grace Main", model: "M32R", firmware: "2.10")
        #expect(flow.step == .identified(expected))
        #expect(transport.calls.count == 1)
        #expect(transport.calls[0].timeout == ConsoleLinkTiming.probeTimeout)
        #expect(transport.calls[0].timeout <= 1.0)
    }

    @Test func continueHandsTheIdentifiedConsoleToStepTwo() async throws {
        let info = xinfo(ip: "192.168.1.50", name: "Grace Main", model: "M32R", firmware: "2.10")
        let transport = FakeTransport([
            .reply(try xinfoReplyDatagram(ip: info.ip, name: info.name, model: info.model, firmware: info.firmware)),
        ])
        let flow = makeFlow(transport: transport)

        await flow.store.connect(manualAddress: info.ip)
        flow.continueToChannels()

        #expect(flow.step == .channels(info))
        #expect(flow.handedOff == info)
    }

    @Test func aSyntheticNonTPCConsoleIsIdentifiedAndHandedOff() async throws {
        let transport = FakeTransport([
            .reply(try xinfoReplyDatagram(ip: "10.0.4.200", name: "Grace Main", model: "X32C", firmware: "2.10")),
        ])
        let flow = makeFlow(transport: transport, wifi: x32WiFi)

        await flow.store.connect(manualAddress: "10.0.4.200")
        flow.continueToChannels()

        let expected = xinfo(ip: "10.0.4.200", name: "Grace Main", model: "X32C", firmware: "2.10")
        #expect(flow.step == .channels(expected))
        #expect(flow.handedOff == expected)
    }

    @Test func continueIsANoOpUnlessIdentified() async throws {
        let flow = makeFlow(transport: FakeTransport())
        flow.continueToChannels()
        #expect(flow.handedOff == nil)

        let unsupported = xinfo(ip: "192.168.1.50", name: "Grace Main", model: "XR18", firmware: "2.10")
        let unsupportedTransport = FakeTransport([
            .reply(try xinfoReplyDatagram(ip: unsupported.ip, name: unsupported.name, model: unsupported.model, firmware: unsupported.firmware)),
        ])
        let unsupportedFlow = makeFlow(transport: unsupportedTransport)
        await unsupportedFlow.store.connect(manualAddress: unsupported.ip)
        unsupportedFlow.continueToChannels()
        #expect(unsupportedFlow.step == .unsupported(unsupported))
        #expect(unsupportedFlow.handedOff == nil)
    }

    @Test func resetReturnsTheHandoffToConnect() async throws {
        let info = xinfo(ip: "192.168.1.50", name: "Grace Main", model: "M32R", firmware: "2.10")
        let transport = FakeTransport([
            .reply(try xinfoReplyDatagram(ip: info.ip, name: info.name, model: info.model, firmware: info.firmware)),
        ])
        let flow = makeFlow(transport: transport)

        await flow.store.connect(manualAddress: info.ip)
        flow.continueToChannels()
        flow.reset()

        #expect(flow.step == .identified(info))
        #expect(flow.handedOff == nil)
    }

    @Test func aModelOutsideTheX32M32FamilyIsNotSupportedAndCannotContinue() async throws {
        let info = xinfo(ip: "10.0.4.200", name: "Grace Main", model: "XR18", firmware: "2.10")
        let transport = FakeTransport([
            .reply(try xinfoReplyDatagram(ip: info.ip, name: info.name, model: info.model, firmware: info.firmware)),
        ])
        let flow = makeFlow(transport: transport, wifi: x32WiFi)

        await flow.store.connect(manualAddress: info.ip)
        flow.continueToChannels()

        #expect(flow.step == .unsupported(info))
        #expect(flow.handedOff == nil)
    }

    @Test func everyX32AndM32FamilyModelIsSupported() {
        for model in [
            "X32", "X32C", "X32 Compact", "X32P", "X32-Producer", "X32R", "X32RACK",
            "M32", "M32C", "M32R", " m32r ",
        ] {
            #expect(ConsoleModelFamily.isSupported(model), "expected supported model: \(model)")
        }
    }

    @Test func unknownEmptyAndLookalikeModelsAreNotSupported() {
        for model in ["", "XR18", "XR12", "X18", "WING", "X32CORE", "M32 LIVE", "M3", "X3"] {
            #expect(!ConsoleModelFamily.isSupported(model), "expected unsupported model: \(model)")
        }
    }

    @Test func stepIsPureOverEveryConnectPhase() {
        let info = xinfo(ip: "192.168.1.50", name: "Grace Main", model: "M32R", firmware: "2.10")
        let phases: [ConsoleConnectPhase] = [
            .manual(notice: nil),
            .invalidAddress(.noWiFi),
            .connecting(ConsoleIPv4("192.168.1.50")!),
            .noReply(ConsoleIPv4("192.168.1.50")!),
            .permissionDenied,
            .failed("network down"),
        ]

        for phase in phases {
            #expect(ChannelSetupFlow.step(consentGranted: true, phase: phase, handedOff: nil) == .connect)
        }
        #expect(ChannelSetupFlow.step(consentGranted: true, phase: .connected(info), handedOff: nil) == .identified(info))
        #expect(ChannelSetupFlow.step(consentGranted: false, phase: .connected(info), handedOff: info) == .consent)
        #expect(ChannelSetupFlow.step(consentGranted: true, phase: .manual(notice: nil), handedOff: info) == .channels(info))
    }

    @Test func withoutDiscoveryConnectOffersLastKnownThenManual() {
        let saved = SavedConsole(ip: "192.168.1.50", name: "Grace Main", model: "M32R")

        #expect(ChannelSetupFlow.connectSources(discoveryAvailable: false, savedConsole: saved) == [.lastKnown(saved), .manual])
    }

    @Test func withoutDiscoveryOrASavedConsoleConnectOffersOnlyManual() {
        #expect(ChannelSetupFlow.connectSources(discoveryAvailable: false, savedConsole: nil) == [.manual])
    }

    @Test func withDiscoveryConnectOffersDiscoverFirst() {
        let saved = SavedConsole(ip: "10.0.4.200", name: "Grace Main", model: "X32C")

        #expect(ChannelSetupFlow.connectSources(discoveryAvailable: true, savedConsole: saved) == [.discover, .lastKnown(saved), .manual])
    }

    @Test func everyDatagramTheSetupFlowSendsIsAZeroArgumentGuardedQuery() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let saved = SavedConsole(ip: "10.0.4.200", name: "Grace Main", model: "X32C")
        defaults.set(try JSONEncoder().encode(saved), forKey: ConsoleStore.defaultsKey)
        let info = xinfo(ip: saved.ip, name: saved.name, model: saved.model, firmware: "2.10")
        let reply = try xinfoReplyDatagram(ip: info.ip, name: info.name, model: info.model, firmware: info.firmware)
        let transport = FakeTransport([
            .reply(reply),
            .timeout, .timeout, .timeout,
            .timeout, .timeout, .timeout,
            .reply(reply),
        ])
        let flow = makeFlow(transport: transport, defaults: defaults, wifi: x32WiFi)

        await flow.store.open()
        await flow.store.connect(manualAddress: saved.ip)
        await flow.store.retry()
        await flow.store.rescan()

        #expect(transport.calls.count > 0)
        for call in transport.calls {
            let message = try OSCCodec.decode(call.datagram)
            #expect(message.arguments.isEmpty)
            try ReadOnlyOSCGuard.check(message)
        }
    }
}
