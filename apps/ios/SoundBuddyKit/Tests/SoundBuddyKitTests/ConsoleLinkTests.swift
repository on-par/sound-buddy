import Foundation
import Testing
@testable import SoundBuddyKit

private let foh = ConsoleIPv4("192.168.1.50")!

/// Scripted per call: one entry consumed per `exchange`. Records every call
/// so tests can assert what was sent and how it was timed.
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
    private(set) var cancelCount = 0

    init(_ script: [Script]) {
        self.script = script
    }

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws -> Data? {
        calls.append(Call(datagram: datagram, host: host, port: port, timeout: timeout))
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

private func xinfoReplyMessage(ip: String = "192.168.1.50", name: String = "FOH", model: String = "M32R", firmware: String = "4.06") -> OSCMessage {
    OSCMessage("/xinfo", [.string(ip), .string(name), .string(model), .string(firmware)])
}

private func xinfoReplyDatagram(ip: String = "192.168.1.50", name: String = "FOH", model: String = "M32R", firmware: String = "4.06") throws -> Data {
    try OSCCodec.encode(xinfoReplyMessage(ip: ip, name: name, model: model, firmware: firmware))
}

@Suite struct ConsoleLinkTests {
    @Test func probeSendsTheGuardedXInfoDatagramToPort10023() async throws {
        let transport = FakeTransport([.timeout, .timeout, .timeout])

        _ = await ConsoleLink.probeXInfo(foh, via: transport)

        #expect(transport.calls.count == 3)
        let call = try #require(transport.calls.first)
        let decoded = try OSCCodec.decode(call.datagram)
        #expect(decoded.address == "/xinfo")
        #expect(decoded.arguments.isEmpty)
        #expect(call.host == foh)
        #expect(call.port == ConsoleLinkTiming.port)
        #expect(call.timeout == ConsoleLinkTiming.probeTimeout)
    }

    @Test func probeReturnsFoundOnAValidXInfoReply() async throws {
        let reply = try xinfoReplyDatagram()
        let transport = FakeTransport([.reply(reply)])

        let result = await ConsoleLink.probeXInfo(foh, via: transport)

        #expect(result == .found(ConsoleXInfo(reply: xinfoReplyMessage())!))
    }

    @Test func probeGivesUpAfterThreeAttemptsOf350ms() async {
        let transport = FakeTransport([.timeout, .timeout, .timeout])

        let result = await ConsoleLink.probeXInfo(foh, via: transport)

        #expect(result == .noReply)
        #expect(transport.calls.count == 3)
        #expect(transport.calls.allSatisfy { $0.timeout == 0.35 })
    }

    @Test func probeIgnoresANonXInfoReplyAndKeepsTrying() async throws {
        let wrongReply = try OSCCodec.encode(OSCMessage("/info", [.string("hello")]))
        let reply = try xinfoReplyDatagram()
        let transport = FakeTransport([.reply(wrongReply), .reply(reply)])

        let result = await ConsoleLink.probeXInfo(foh, via: transport)

        #expect(result == .found(ConsoleXInfo(reply: xinfoReplyMessage())!))
        #expect(transport.calls.count == 2)
    }

    @Test func probeStopsImmediatelyOnLocalNetworkDenied() async {
        let transport = FakeTransport([.throwing(.localNetworkDenied)])

        let result = await ConsoleLink.probeXInfo(foh, via: transport)

        #expect(result == .localNetworkDenied)
        #expect(transport.calls.count == 1)
    }

    @Test func probeStopsImmediatelyOnNoWiFi() async {
        let transport = FakeTransport([.throwing(.noWiFi)])

        let result = await ConsoleLink.probeXInfo(foh, via: transport)

        #expect(result == .noWiFi)
        #expect(transport.calls.count == 1)
    }

    @Test func probeStopsImmediatelyOnTransportFailure() async {
        let transport = FakeTransport([.throwing(.failed("network down"))])

        let result = await ConsoleLink.probeXInfo(foh, via: transport)

        #expect(result == .failed("network down"))
        #expect(transport.calls.count == 1)
    }

    @Test func probeTimingMatchesTheSessionConnectTimeout() {
        let total = ConsoleLinkTiming.probeTimeout * Double(ConsoleLinkTiming.probeAttempts)
        #expect(abs(total - ConsoleSessionTiming.connectTimeout) < 1e-9)
    }
}
