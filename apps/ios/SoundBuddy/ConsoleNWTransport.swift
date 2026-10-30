import Foundation
import Network
import SoundBuddyKit

/// The real `ConsoleTransport` (#1666): one Wi-Fi-only UDP `NWConnection`,
/// reused while the host:port is unchanged, cancelled and replaced
/// otherwise. A Local Network denial drops the cached connection after the
/// exchange resumes so a later retry after Settings gets a fresh connection.
/// Untestable Network.framework adapter wiring — `ConsoleLink`'s probe logic
/// is covered against a fake in SoundBuddyKit's `ConsoleLinkTests`.
private extension ConsoleIPv4 {
    /// Byte-based bridge to `IPv4Address`, safe by construction since
    /// `ConsoleIPv4` guarantees `octets.count == 4`.
    var ipv4Address: IPv4Address {
        IPv4Address(Data(octets))!
    }
}

final class ConsoleNWTransport: ConsoleTransport, @unchecked Sendable {
    private final class ExchangeState: @unchecked Sendable {
        private var resumed = false
        private let continuation: CheckedContinuation<Result<Data?, ConsoleTransportError>, Never>

        init(continuation: CheckedContinuation<Result<Data?, ConsoleTransportError>, Never>) {
            self.continuation = continuation
        }

        /// Only ever called on `ConsoleNWTransport`'s serial queue, so this
        /// needs no lock of its own.
        func resume(_ result: Result<Data?, ConsoleTransportError>) {
            guard !resumed else { return }
            resumed = true
            continuation.resume(returning: result)
        }
    }

    private let queue = DispatchQueue(label: "com.soundbuddy.ios.consoleTransport")
    private var connection: NWConnection?
    private var connectedHost: ConsoleIPv4?
    private var connectedPort: UInt16?

    func exchange(_ datagram: Data, with host: ConsoleIPv4, port: UInt16, timeout: TimeInterval) async throws(ConsoleTransportError) -> Data? {
        let result = await withCheckedContinuation { continuation in
            queue.async {
                self.exchangeOnQueue(datagram, host: host, port: port, timeout: timeout, continuation: continuation)
            }
        }
        return try result.get()
    }

    private func exchangeOnQueue(
        _ datagram: Data,
        host: ConsoleIPv4,
        port: UInt16,
        timeout: TimeInterval,
        continuation: CheckedContinuation<Result<Data?, ConsoleTransportError>, Never>
    ) {
        let connection = connectionFor(host: host, port: port)
        let state = ExchangeState(continuation: continuation)

        let sendAndReceive: @Sendable () -> Void = { [weak self] in
            connection.send(content: datagram, completion: .contentProcessed { error in
                guard let self else { return }
                if let error {
                    self.resume(
                        state,
                        .failure(self.transportError(for: connection, error: error)),
                        connection: connection,
                        dropIfDenied: true
                    )
                    return
                }
                connection.receiveMessage { data, _, _, error in
                    if let error {
                        self.resume(
                            state,
                            .failure(self.transportError(for: connection, error: error)),
                            connection: connection,
                            dropIfDenied: true
                        )
                        return
                    }
                    state.resume(.success(data))
                }
            })
        }

        connection.stateUpdateHandler = { [weak self] newState in
            guard let self else { return }
            switch newState {
            case .ready:
                sendAndReceive()
            case let .failed(error):
                let result = Result<Data?, ConsoleTransportError>.failure(self.transportError(for: connection, error: error))
                self.resume(state, result, connection: connection, dropIfDenied: true)
                if case .failure(.localNetworkDenied) = result {} else {
                    self.resetConnection()
                }
            case let .waiting(error):
                self.resume(
                    state,
                    .failure(self.transportError(for: connection, error: error)),
                    connection: connection,
                    dropIfDenied: true
                )
            default:
                break
            }
        }

        queue.asyncAfter(deadline: .now() + timeout) {
            state.resume(.success(nil))
        }

        switch connection.state {
        case .ready:
            sendAndReceive()
        case .setup:
            connection.start(queue: queue)
        default:
            break
        }
    }

    private func resume(
        _ state: ExchangeState,
        _ result: Result<Data?, ConsoleTransportError>,
        connection: NWConnection,
        dropIfDenied: Bool
    ) {
        state.resume(result)
        guard dropIfDenied else { return }
        guard case .failure(.localNetworkDenied) = result else { return }
        connection.cancel()
        resetConnection()
    }

    private func transportError(for connection: NWConnection, error: NWError) -> ConsoleTransportError {
        if connection.currentPath?.unsatisfiedReason == .localNetworkDenied {
            return .localNetworkDenied
        }
        if let path = connection.currentPath, path.status != .satisfied, !path.usesInterfaceType(.wifi) {
            return .noWiFi
        }
        return .failed(error.localizedDescription)
    }

    private func connectionFor(host: ConsoleIPv4, port: UInt16) -> NWConnection {
        if let connection, connectedHost == host, connectedPort == port {
            return connection
        }
        connection?.cancel()
        let parameters = NWParameters.udp
        parameters.requiredInterfaceType = .wifi
        let endpoint = NWEndpoint.hostPort(
            host: .ipv4(host.ipv4Address),
            port: NWEndpoint.Port(integerLiteral: port)
        )
        let newConnection = NWConnection(to: endpoint, using: parameters)
        connection = newConnection
        connectedHost = host
        connectedPort = port
        return newConnection
    }

    private func resetConnection() {
        connection = nil
        connectedHost = nil
        connectedPort = nil
    }

    func cancel() {
        queue.async {
            self.connection?.cancel()
            self.resetConnection()
        }
    }
}

/// `getifaddrs` -> the first `en0` `AF_INET` entry that's up. Untestable
/// POSIX adapter wiring; `ConsoleAddressTests` covers the subnet math this
/// feeds into `ConsoleStore`.
enum WiFiInterfaceReader {
    static func current() -> ConsoleWiFiNetwork? {
        var firstAddress: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&firstAddress) == 0, let firstAddress else { return nil }
        defer { freeifaddrs(firstAddress) }

        var cursor: UnsafeMutablePointer<ifaddrs>? = firstAddress
        while let interface = cursor?.pointee {
            defer { cursor = interface.ifa_next }
            guard interface.ifa_addr?.pointee.sa_family == UInt8(AF_INET),
                  interface.ifa_flags & UInt32(IFF_UP) != 0,
                  String(cString: interface.ifa_name) == "en0",
                  let address = ipv4(from: interface.ifa_addr),
                  let netmask = ipv4(from: interface.ifa_netmask)
            else { continue }
            return ConsoleWiFiNetwork(address: address, netmask: netmask)
        }
        return nil
    }

    private static func ipv4(from sockaddrPointer: UnsafeMutablePointer<sockaddr>?) -> ConsoleIPv4? {
        guard let sockaddrPointer else { return nil }
        var addrIn = sockaddr_in()
        memcpy(&addrIn, sockaddrPointer, MemoryLayout<sockaddr_in>.size)
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        guard inet_ntop(AF_INET, &addrIn.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil,
              let nullIndex = buffer.firstIndex(of: 0)
        else { return nil }
        let bytes = buffer[..<nullIndex].map(UInt8.init(bitPattern:))
        return ConsoleIPv4(String(decoding: bytes, as: UTF8.self))
    }
}
