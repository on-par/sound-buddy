import Foundation
import Testing
@testable import SoundBuddyKit

/// Scripted per call, like `ConsoleLinkTests`' fake, plus a cancel counter
/// for `ConsoleStore.disconnect()`.
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
    private(set) var cancelCount = 0

    init(_ script: [Script] = []) {
        self.script = script
    }

    func queue(_ entries: [Script]) {
        script.append(contentsOf: entries)
    }

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data? {
        calls.append(Call(host: host, port: port, timeout: timeout))
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

private func xinfoReplyDatagram(ip: String, name: String, model: String, firmware: String = "4.06") throws -> Data {
    try OSCCodec.encode(OSCMessage("/xinfo", [.string(ip), .string(name), .string(model), .string(firmware)]))
}

private let wifi = ConsoleWiFiNetwork(address: ConsoleIPv4("192.168.1.20")!, netmask: ConsoleIPv4("255.255.255.0")!)

@MainActor
private func makeStore(
    transport: FakeTransport,
    defaults: UserDefaults,
    wifi: ConsoleWiFiNetwork? = wifi,
    consentGranted: Bool = true
) -> ConsoleStore {
    ConsoleStore(transport: transport, currentWiFi: { wifi }, isConsentGranted: { consentGranted }, defaults: defaults)
}

@MainActor
private func seedSavedConsole(_ saved: SavedConsole, in defaults: UserDefaults) throws {
    defaults.set(try JSONEncoder().encode(saved), forKey: ConsoleStore.defaultsKey)
}

@MainActor
@Suite struct ConsoleStoreTests {
    @Test func connectingToAValidIPShowsTheConsoleCardFromTheXInfoReply() async throws {
        let transport = FakeTransport([.reply(try xinfoReplyDatagram(ip: "192.168.1.50", name: "FOH", model: "M32R"))])
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.connect(manualAddress: "192.168.1.50")

        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }
        #expect(info.model == "M32R")
        #expect(info.name == "FOH")
        #expect(info.firmware == "4.06")
    }

    @Test func aReplyOnTheFirstAttemptConnectsWithinTheProbeBudget() async throws {
        let transport = FakeTransport([.reply(try xinfoReplyDatagram(ip: "192.168.1.50", name: "FOH", model: "M32R"))])
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.connect(manualAddress: "192.168.1.50")

        #expect(transport.calls.count == 1)
        #expect(transport.calls.map(\.timeout).reduce(0, +) <= 1.0)
    }

    @Test func aPublicIPIsRefusedAndNothingIsSent() async {
        let transport = FakeTransport()
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.connect(manualAddress: "8.8.8.8")

        #expect(store.phase == .invalidAddress(.notPrivate("8.8.8.8")))
        #expect(transport.calls.isEmpty)
    }

    @Test func anOffSubnetIPIsRefusedAndNothingIsSent() async {
        let transport = FakeTransport()
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.connect(manualAddress: "192.168.2.5")

        #expect(store.phase == .invalidAddress(.offSubnet("192.168.2.5", wifi)))
        #expect(transport.calls.isEmpty)
    }

    @Test func aSuccessfulConnectPersistsTheLastConsole() async throws {
        let transport = FakeTransport([.reply(try xinfoReplyDatagram(ip: "192.168.1.50", name: "FOH", model: "M32R"))])
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = makeStore(transport: transport, defaults: defaults)

        await store.connect(manualAddress: "192.168.1.50")

        let reopened = makeStore(transport: FakeTransport(), defaults: defaults)
        #expect(reopened.savedConsole == SavedConsole(ip: "192.168.1.50", name: "FOH", model: "M32R"))
    }

    @Test func openAutoConnectsToTheSavedConsoleWhenIdentityMatches() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        try seedSavedConsole(SavedConsole(ip: "192.168.1.50", name: "FOH", model: "M32R"), in: defaults)
        let transport = FakeTransport([.reply(try xinfoReplyDatagram(ip: "192.168.1.50", name: "FOH", model: "M32R"))])
        let store = makeStore(transport: transport, defaults: defaults)

        await store.open()

        guard case let .connected(info) = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }
        #expect(info.name == "FOH")
        #expect(transport.calls.count == 1)
    }

    @Test func openDoesNotAutoConnectWhenADifferentConsoleAnswers() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let saved = SavedConsole(ip: "192.168.1.50", name: "FOH", model: "M32R")
        try seedSavedConsole(saved, in: defaults)
        let transport = FakeTransport([.reply(try xinfoReplyDatagram(ip: "192.168.1.50", name: "Monitor", model: "X32"))])
        let store = makeStore(transport: transport, defaults: defaults)

        await store.open()

        guard case let .manual(notice) = store.phase else {
            Issue.record("expected .manual, got \(store.phase)")
            return
        }
        #expect(notice != nil)
        #expect(store.savedConsole == saved)
    }

    @Test func openWithNoSavedConsoleShowsManualEntryAndSendsNothing() async {
        let transport = FakeTransport()
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.open()

        #expect(store.phase == .manual(notice: nil))
        #expect(transport.calls.isEmpty)
    }

    @Test func openWithASavedConsoleOffThisWiFiSendsNothing() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        try seedSavedConsole(SavedConsole(ip: "192.168.2.50", name: "FOH", model: "M32R"), in: defaults)
        let transport = FakeTransport()
        let store = makeStore(transport: transport, defaults: defaults)

        await store.open()

        guard case let .manual(notice) = store.phase else {
            Issue.record("expected .manual, got \(store.phase)")
            return
        }
        #expect(notice != nil)
        #expect(transport.calls.isEmpty)
    }

    @Test func noReplyShowsNoConsoleAtThatAddressWithRetryAndManual() async {
        #expect(ConsoleConnectCopy.noReply == "No console at that address")
        let transport = FakeTransport([.timeout, .timeout, .timeout, .timeout, .timeout, .timeout])
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.connect(manualAddress: "192.168.1.77")

        #expect(transport.calls.count == 3)
        #expect(transport.calls.allSatisfy { $0.timeout == 0.35 })
        #expect(store.phase == .noReply(ConsoleIPv4("192.168.1.77")!))

        await store.retry()

        #expect(transport.calls.count == 6)
        #expect(store.phase == .noReply(ConsoleIPv4("192.168.1.77")!))

        store.showManualEntry()
        #expect(store.phase == .manual(notice: nil))
    }

    @Test func localNetworkDeniedShowsOpenSettingsAndDoesNotRetry() async {
        #expect(ConsoleConnectCopy.openSettings == "Open Settings")
        let transport = FakeTransport([.throwing(.localNetworkDenied)])
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.connect(manualAddress: "192.168.1.77")

        #expect(transport.calls.count == 1)
        #expect(store.phase == .permissionDenied)
    }

    @Test func returningToTheForegroundAfterADenialShowsManualEntryAndSendsNothing() async {
        let transport = FakeTransport([.throwing(.localNetworkDenied)])
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)

        await store.connect(manualAddress: "192.168.1.77")
        let callsAfterDenial = transport.calls.count
        store.returnedToForeground()

        #expect(store.phase == .manual(notice: nil))
        #expect(transport.calls.count == callsAfterDenial)
    }

    @Test func afterADenialAndReturnConnectSucceedsWithoutARelaunch() async throws {
        let info = ConsoleXInfo(reply: OSCMessage("/xinfo", [
            .string("10.0.4.200"), .string("Grace Main"), .string("X32C"), .string("2.10"),
        ]))!
        let transport = FakeTransport([
            .throwing(.localNetworkDenied),
            .reply(try xinfoReplyDatagram(ip: info.ip, name: info.name, model: info.model, firmware: info.firmware)),
        ])
        let store = makeStore(
            transport: transport,
            defaults: UserDefaults(suiteName: UUID().uuidString)!,
            wifi: ConsoleWiFiNetwork(address: ConsoleIPv4("10.0.4.7")!, netmask: ConsoleIPv4("255.255.255.0")!)
        )

        await store.connect(manualAddress: info.ip)
        store.returnedToForeground()
        await store.connect(manualAddress: info.ip)

        #expect(store.phase == .connected(info))
        #expect(transport.calls.count == 2)
    }

    @Test func returningToTheForegroundLeavesOtherPhasesAlone() async {
        let manualTransport = FakeTransport()
        let manualStore = makeStore(transport: manualTransport, defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let manualCalls = manualTransport.calls.count
        manualStore.returnedToForeground()
        #expect(manualStore.phase == .manual(notice: nil))
        #expect(manualTransport.calls.count == manualCalls)

        let connectedInfo = ConsoleXInfo(reply: OSCMessage("/xinfo", [
            .string("192.168.1.50"), .string("Grace Main"), .string("M32R"), .string("2.10"),
        ]))!
        let connectedTransport = FakeTransport([.reply(try! xinfoReplyDatagram(ip: connectedInfo.ip, name: connectedInfo.name, model: connectedInfo.model, firmware: connectedInfo.firmware))])
        let connectedStore = makeStore(transport: connectedTransport, defaults: UserDefaults(suiteName: UUID().uuidString)!)
        await connectedStore.connect(manualAddress: connectedInfo.ip)
        let connectedCalls = connectedTransport.calls.count
        connectedStore.returnedToForeground()
        #expect(connectedStore.phase == .connected(connectedInfo))
        #expect(connectedTransport.calls.count == connectedCalls)

        let noReplyTransport = FakeTransport([.timeout, .timeout, .timeout])
        let noReplyStore = makeStore(transport: noReplyTransport, defaults: UserDefaults(suiteName: UUID().uuidString)!)
        await noReplyStore.connect(manualAddress: "192.168.1.50")
        let noReplyCalls = noReplyTransport.calls.count
        noReplyStore.returnedToForeground()
        #expect(noReplyStore.phase == .noReply(ConsoleIPv4("192.168.1.50")!))
        #expect(noReplyTransport.calls.count == noReplyCalls)

        let invalidTransport = FakeTransport()
        let invalidStore = makeStore(transport: invalidTransport, defaults: UserDefaults(suiteName: UUID().uuidString)!)
        await invalidStore.connect(manualAddress: "8.8.8.8")
        let invalidCalls = invalidTransport.calls.count
        invalidStore.returnedToForeground()
        #expect(invalidStore.phase == .invalidAddress(.notPrivate("8.8.8.8")))
        #expect(invalidTransport.calls.count == invalidCalls)
    }

    @Test func withoutConsentNothingIsSent() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        try seedSavedConsole(SavedConsole(ip: "192.168.1.50", name: "FOH", model: "M32R"), in: defaults)
        let transport = FakeTransport()
        let store = makeStore(transport: transport, defaults: defaults, consentGranted: false)
        let before = store.phase

        await store.open()
        await store.connect(manualAddress: "192.168.1.50")
        await store.rescan()

        #expect(transport.calls.isEmpty)
        #expect(store.phase == before)
    }

    @Test func disconnectReturnsToManualAndKeepsTheSavedConsole() async throws {
        let transport = FakeTransport([.reply(try xinfoReplyDatagram(ip: "192.168.1.50", name: "FOH", model: "M32R"))])
        let store = makeStore(transport: transport, defaults: UserDefaults(suiteName: UUID().uuidString)!)
        await store.connect(manualAddress: "192.168.1.50")
        let savedBeforeDisconnect = store.savedConsole

        store.disconnect()

        #expect(store.phase == .manual(notice: nil))
        #expect(store.savedConsole == savedBeforeDisconnect)
        #expect(store.savedConsole != nil)
        #expect(transport.cancelCount == 1)
    }

    @Test func rescanReprobesTheLastKnownConsole() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        try seedSavedConsole(SavedConsole(ip: "192.168.1.50", name: "FOH", model: "M32R"), in: defaults)
        let transport = FakeTransport([.reply(try xinfoReplyDatagram(ip: "192.168.1.50", name: "FOH", model: "M32R"))])
        let store = makeStore(transport: transport, defaults: defaults)

        await store.rescan()

        guard case .connected = store.phase else {
            Issue.record("expected .connected, got \(store.phase)")
            return
        }
        #expect(transport.calls.count == 1)
    }

    @Test func anUndecodableSavedConsoleIsIgnored() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        defaults.set(Data([0xFF, 0x00, 0x01]), forKey: ConsoleStore.defaultsKey)
        let store = makeStore(transport: FakeTransport(), defaults: defaults)

        #expect(store.savedConsole == nil)
    }
}
