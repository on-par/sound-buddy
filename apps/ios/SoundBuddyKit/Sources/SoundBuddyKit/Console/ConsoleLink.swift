import Foundation

/// ADR-0060's unicast `/xinfo` probe timing: 350 ms per attempt, 3 attempts.
/// Equal to `ConsoleSessionTiming.connectTimeout` (see `ConsoleLinkTests`).
public enum ConsoleLinkTiming {
    public static let port: UInt16 = 10_023
    public static let probeTimeout: TimeInterval = 0.35
    public static let probeAttempts = 3
}

/// Why a probe's transport call itself failed — distinct from `.noReply`,
/// which is a normal (if unwanted) network outcome and gets retried.
public enum ConsoleTransportError: Error, Equatable, Sendable {
    case localNetworkDenied
    case noWiFi
    case failed(String)
}

/// One Wi-Fi-only UDP exchange: send `datagram` to `host:port`, return the
/// first datagram received within `timeout`, or `nil` on timeout.
public protocol ConsoleTransport: Sendable {
    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data?
    func cancel()
}

/// What one `/xinfo` probe found.
public enum ConsoleProbeResult: Equatable, Sendable {
    case found(ConsoleXInfo)
    case noReply
    case localNetworkDenied
    case noWiFi
    case failed(String)
}

/// Unicast console discovery (#1666): one guarded `/xinfo` datagram, up to
/// `ConsoleLinkTiming.probeAttempts` times, never retrying a denial.
public enum ConsoleLink {
    public static func probeXInfo(_ host: ConsoleIPv4, via transport: any ConsoleTransport) async -> ConsoleProbeResult {
        let datagram: Data
        do {
            // OSCCodec.encode is the only public encoder and always runs the
            // read-only guard (ADR-0161 item 2); "/xinfo" with no arguments
            // can never fail it, but the throw is handled anyway rather than
            // force-tried.
            datagram = try OSCCodec.encode(OSCMessage("/xinfo"))
        } catch {
            return .failed(error.description)
        }

        for _ in 0..<ConsoleLinkTiming.probeAttempts {
            do {
                let reply = try await transport.exchange(
                    datagram, with: host, port: ConsoleLinkTiming.port, timeout: ConsoleLinkTiming.probeTimeout
                )
                guard let reply, let message = try? OSCCodec.decode(reply), let info = ConsoleXInfo(reply: message) else {
                    continue
                }
                return .found(info)
            } catch {
                switch error {
                case .localNetworkDenied: return .localNetworkDenied
                case .noWiFi: return .noWiFi
                case let .failed(message): return .failed(message)
                }
            }
        }
        return .noReply
    }
}
