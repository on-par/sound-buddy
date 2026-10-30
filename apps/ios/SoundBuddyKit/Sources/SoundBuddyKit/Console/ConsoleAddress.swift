import Foundation

/// A parsed, validated IPv4 address (#1666). Parsing is strict dotted-quad
/// only: no hex, no octal-looking leading zeros, no sign, exactly four
/// 1-3-digit decimal fields 0...255.
public struct ConsoleIPv4: Equatable, Hashable, Sendable, CustomStringConvertible {
    /// Four octets, most significant first (a.b.c.d -> [a, b, c, d]).
    public let octets: [UInt8]

    public init(octets: [UInt8]) {
        precondition(octets.count == 4, "ConsoleIPv4 requires exactly 4 octets")
        self.octets = octets
    }

    public init(value: UInt32) {
        octets = [
            UInt8((value >> 24) & 0xff),
            UInt8((value >> 16) & 0xff),
            UInt8((value >> 8) & 0xff),
            UInt8(value & 0xff),
        ]
    }

    public var value: UInt32 {
        octets.reduce(0) { ($0 << 8) | UInt32($1) }
    }

    public init?(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let fields = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        guard fields.count == 4 else { return nil }
        var parsed: [UInt8] = []
        for field in fields {
            guard let octet = Self.parseOctet(field) else { return nil }
            parsed.append(octet)
        }
        octets = parsed
    }

    /// Exactly 1-3 ASCII decimal digits, 0...255, no leading zero unless the
    /// field is the single digit "0" (rejects both a sign and octal-looking
    /// input like "007").
    private static func parseOctet(_ field: Substring) -> UInt8? {
        guard (1...3).contains(field.count) else { return nil }
        guard field.allSatisfy({ $0.asciiValue.map { (0x30...0x39).contains($0) } ?? false }) else { return nil }
        if field.count > 1 && field.first == "0" { return nil }
        guard let intValue = Int(field), (0...255).contains(intValue) else { return nil }
        return UInt8(intValue)
    }

    public var description: String {
        octets.map(String.init).joined(separator: ".")
    }
}

/// The phone's current Wi-Fi subnet, read from the active interface.
public struct ConsoleWiFiNetwork: Equatable, Sendable {
    public let address: ConsoleIPv4
    public let netmask: ConsoleIPv4

    public init(address: ConsoleIPv4, netmask: ConsoleIPv4) {
        self.address = address
        self.netmask = netmask
    }

    public func contains(_ ip: ConsoleIPv4) -> Bool {
        (ip.value & netmask.value) == (address.value & netmask.value)
    }

    /// Popcount of the netmask, e.g. 255.255.255.0 -> 24.
    public var prefixLength: Int {
        netmask.value.nonzeroBitCount
    }

    public var networkAddress: ConsoleIPv4 {
        ConsoleIPv4(value: address.value & netmask.value)
    }

    public var broadcastAddress: ConsoleIPv4 {
        ConsoleIPv4(value: address.value | ~netmask.value)
    }

    /// e.g. "Wi-Fi 192.168.1.0/24".
    public var displayName: String {
        "Wi-Fi \(networkAddress)/\(prefixLength)"
    }
}

/// Why a typed-in or saved console address was refused, with actionable
/// copy naming the offending IP and what to do next (threat-model
/// mitigation 3: RFC 1918 and on-subnet only, checked before any packet
/// leaves).
public enum ConsoleAddressError: Error, Equatable, Sendable {
    case empty
    case malformed(String)
    case notPrivate(String)
    case offSubnet(String, ConsoleWiFiNetwork)
    case noWiFi
    /// The phone's own address, or the subnet's network/broadcast address
    /// (all host bits clear/set) — never a console, so never sent to.
    case notConsole(String)

    public var message: String {
        switch self {
        case .empty:
            "Enter the console's IP address, shown on the console under Setup > Network."
        case let .malformed(text):
            "\"\(text)\" isn't an IP address. Enter four numbers separated by dots, like 192.168.1.50."
        case let .notPrivate(ip):
            "\(ip) isn't a local network address. Sound Buddy only connects to consoles on a private network (10.x, 172.16–31.x or 192.168.x). Check the IP on the console under Setup > Network."
        case let .offSubnet(ip, wifi):
            "\(ip) isn't on this Wi-Fi (\(wifi.displayName)). Join the console's Wi-Fi or check the IP on the console."
        case .noWiFi:
            "Join the console's Wi-Fi network, then try again."
        case let .notConsole(ip):
            "\(ip) is this phone or the network's broadcast address, not a console. Enter the console's IP from Setup > Network."
        }
    }
}

/// RFC 1918 + on-subnet validation for a manually-entered or saved console
/// address (#1666, threat-model mitigation 3). Pure: never touches the
/// network. Order: empty -> malformed -> notPrivate -> noWiFi (wifi nil) ->
/// offSubnet -> notConsole.
public enum ConsoleAddressValidator {
    /// 10.0.0.0/8.
    public static let private10 = (ConsoleIPv4(octets: [10, 0, 0, 0]), ConsoleIPv4(octets: [255, 0, 0, 0]))
    /// 172.16.0.0/12.
    public static let private172 = (ConsoleIPv4(octets: [172, 16, 0, 0]), ConsoleIPv4(octets: [255, 240, 0, 0]))
    /// 192.168.0.0/16.
    public static let private192 = (ConsoleIPv4(octets: [192, 168, 0, 0]), ConsoleIPv4(octets: [255, 255, 0, 0]))

    public static func isPrivate(_ ip: ConsoleIPv4) -> Bool {
        [private10, private172, private192].contains { network, mask in
            (ip.value & mask.value) == (network.value & mask.value)
        }
    }

    public static func validate(_ text: String, wifi: ConsoleWiFiNetwork?) -> Result<ConsoleIPv4, ConsoleAddressError> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .failure(.empty) }
        guard let ip = ConsoleIPv4(trimmed) else { return .failure(.malformed(trimmed)) }
        guard isPrivate(ip) else { return .failure(.notPrivate(ip.description)) }
        guard let wifi else { return .failure(.noWiFi) }
        guard wifi.contains(ip) else { return .failure(.offSubnet(ip.description, wifi)) }
        guard ip != wifi.address, ip != wifi.networkAddress, ip != wifi.broadcastAddress else {
            return .failure(.notConsole(ip.description))
        }
        return .success(ip)
    }
}
