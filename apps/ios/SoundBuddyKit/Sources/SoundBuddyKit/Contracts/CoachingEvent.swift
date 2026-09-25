import Foundation

/// Codable model of apps/ios/Contracts/schemas/coaching-event.v1.schema.json.
/// One rendered coaching hint; the same shape the Mac will publish over the
/// (parked) LAN companion link.
public struct CoachingEvent: Codable, Equatable, Identifiable, Sendable {
    public static let schemaVersion = 1

    public enum RuleType: String, Codable, Sendable {
        case bandDeviation = "band-deviation"
        case harshness, gate, phase, gain
    }

    /// Matches Insight.severity in packages/shared.
    public enum Severity: String, Codable, Sendable {
        case info, warning, suggestion
    }

    public enum Source: String, Codable, Sendable {
        case phoneMicEstimate = "phone-mic-estimate"
        case macMeasurement = "mac-measurement"
    }

    /// ADR 0028 RuleNarrativeData value: string or number only.
    public enum DataValue: Codable, Equatable, Sendable {
        case string(String)
        case number(Double)

        public init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let number = try? c.decode(Double.self) {
                self = .number(number)
            } else if let string = try? c.decode(String.self) {
                self = .string(string)
            } else {
                throw DecodingError.typeMismatch(
                    DataValue.self,
                    .init(codingPath: decoder.codingPath, debugDescription: "CoachingEvent data values must be a string or a number.")
                )
            }
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case .string(let value): try c.encode(value)
            case .number(let value): try c.encode(value)
            }
        }
    }

    public let schemaVersion: Int
    public let id: String
    public let ruleType: RuleType
    public let severity: Severity
    public let band: Band?
    public let message: String
    public let data: [String: DataValue]?
    public let source: Source
    /// Seconds since the live session started.
    public let sessionTime: Double

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, id, ruleType, severity, band, message, data, source, sessionTime
    }

    public init(
        id: String, ruleType: RuleType, severity: Severity, band: Band?,
        message: String, data: [String: DataValue]?, source: Source, sessionTime: Double
    ) {
        schemaVersion = Self.schemaVersion
        self.id = id
        self.ruleType = ruleType
        self.severity = severity
        self.band = band
        self.message = message
        self.data = data
        self.source = source
        self.sessionTime = sessionTime
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let version = try c.decode(Int.self, forKey: .schemaVersion)
        guard version == Self.schemaVersion else {
            throw ContractError.unsupportedSchemaVersion(contract: "CoachingEvent", found: version, supported: Self.schemaVersion)
        }
        self.init(
            id: try c.decode(String.self, forKey: .id),
            ruleType: try c.decode(RuleType.self, forKey: .ruleType),
            severity: try c.decode(Severity.self, forKey: .severity),
            band: try c.decodeIfPresent(Band.self, forKey: .band),
            message: try c.decode(String.self, forKey: .message),
            data: try c.decodeIfPresent([String: DataValue].self, forKey: .data),
            source: try c.decode(Source.self, forKey: .source),
            sessionTime: try c.decode(Double.self, forKey: .sessionTime)
        )
    }
}
