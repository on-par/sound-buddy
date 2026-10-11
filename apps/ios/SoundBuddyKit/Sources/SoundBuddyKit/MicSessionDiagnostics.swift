import Foundation

/// A snapshot of the live audio session and input node (#1708), read by the
/// app right after capture starts, so Sound Buddy can prove it hears the raw
/// mic: measurement mode, no voice processing, no AGC. Pure value: the app
/// fills it from AVAudioSession / AVAudioInputNode; tests build it directly.
public struct MicSessionDiagnostics: Equatable, Sendable {
    /// `AVAudioSession.Mode.measurement.rawValue`.
    public static let measurementMode = "AVAudioSessionModeMeasurement"

    public let category: String
    public let mode: String
    public let inputPortType: String?
    public let inputPortName: String?
    public let dataSource: String?
    public let polarPattern: String?
    public let sampleRate: Double
    public let isVoiceProcessingEnabled: Bool
    /// nil where the platform doesn't expose it.
    public let isVoiceProcessingAGCEnabled: Bool?
    public let isInputGainSettable: Bool

    public init(
        category: String,
        mode: String,
        inputPortType: String?,
        inputPortName: String?,
        dataSource: String?,
        polarPattern: String?,
        sampleRate: Double,
        isVoiceProcessingEnabled: Bool,
        isVoiceProcessingAGCEnabled: Bool?,
        isInputGainSettable: Bool
    ) {
        self.category = category
        self.mode = mode
        self.inputPortType = inputPortType
        self.inputPortName = inputPortName
        self.dataSource = dataSource
        self.polarPattern = polarPattern
        self.sampleRate = sampleRate
        self.isVoiceProcessingEnabled = isVoiceProcessingEnabled
        self.isVoiceProcessingAGCEnabled = isVoiceProcessingAGCEnabled
        self.isInputGainSettable = isInputGainSettable
    }

    /// Why the path is not a raw measurement, in a fixed order.
    public enum ProcessingReason: Equatable, Sendable {
        /// The short mode name actually active.
        case modeNotMeasurement(String)
        case voiceProcessingOn
        case agcOn

        var text: String {
            switch self {
            case .modeNotMeasurement(let mode): "mode \(mode), not Measurement"
            case .voiceProcessingOn: "voice processing on"
            case .agcOn: "AGC on"
            }
        }
    }

    public var processingReasons: [ProcessingReason] {
        var reasons: [ProcessingReason] = []
        if mode != Self.measurementMode { reasons.append(.modeNotMeasurement(Self.shortName(mode, prefix: "AVAudioSessionMode"))) }
        if isVoiceProcessingEnabled { reasons.append(.voiceProcessingOn) }
        if isVoiceProcessingAGCEnabled == true { reasons.append(.agcOn) }
        return reasons
    }

    /// Measurement mode, voice processing off, AGC off (or unavailable).
    public var isRawMeasurement: Bool { processingReasons.isEmpty }

    /// The settings-sheet headline.
    public var statusLine: String {
        isRawMeasurement
            ? "Mic: Raw measurement ✓"
            : "Mic: Processed ⚠ (" + processingReasons.map(\.text).joined(separator: "; ") + ")"
    }

    public struct Detail: Equatable, Sendable {
        public let label: String
        public let value: String
    }

    /// The readout's detail rows, in display order.
    public var details: [Detail] {
        let dash = "—"
        let port: String = switch (inputPortName, inputPortType) {
        case let (name?, type?): "\(name) (\(type))"
        case let (name?, nil): name
        case let (nil, type?): type
        case (nil, nil): dash
        }
        return [
            Detail(label: "Mode", value: Self.shortName(mode, prefix: "AVAudioSessionMode")),
            Detail(label: "Category", value: Self.shortName(category, prefix: "AVAudioSessionCategory")),
            Detail(label: "Port", value: port),
            Detail(label: "Data source", value: dataSource ?? dash),
            Detail(label: "Polar pattern", value: polarPattern ?? dash),
            Detail(label: "Sample rate", value: Self.formatRate(sampleRate)),
            Detail(label: "Voice processing", value: isVoiceProcessingEnabled ? "On" : "Off"),
            Detail(label: "AGC", value: isVoiceProcessingAGCEnabled.map { $0 ? "On" : "Off" } ?? "Unavailable"),
            Detail(label: "Input gain", value: isInputGainSettable ? "Settable" : "Fixed"),
        ]
    }

    /// One Logger line at capture start.
    public var logLine: String {
        "mic raw=\(isRawMeasurement) mode=\(Self.shortName(mode, prefix: "AVAudioSessionMode"))"
            + " category=\(Self.shortName(category, prefix: "AVAudioSessionCategory"))"
            + " port=\(inputPortType ?? "-") source=\(dataSource ?? "-") polar=\(polarPattern ?? "-")"
            + " rate=\(Int(sampleRate.rounded())) vp=\(isVoiceProcessingEnabled)"
            + " agc=\(isVoiceProcessingAGCEnabled.map(String.init) ?? "n/a") gainSettable=\(isInputGainSettable)"
    }

    static func shortName(_ raw: String, prefix: String) -> String {
        raw.hasPrefix(prefix) ? String(raw.dropFirst(prefix.count)) : raw
    }

    static func formatRate(_ hz: Double) -> String {
        let khz = hz / 1000
        return khz == khz.rounded() ? "\(Int(khz)) kHz" : String(format: "%.1f kHz", khz)
    }
}

/// A built-in mic polar pattern, by `AVAudioSession.PolarPattern.rawValue`.
public struct MicPolarPattern: RawRepresentable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let omnidirectional = MicPolarPattern(rawValue: "Omnidirectional")
    public static let cardioid = MicPolarPattern(rawValue: "Cardioid")
    public static let subcardioid = MicPolarPattern(rawValue: "Subcardioid")
    public static let stereo = MicPolarPattern(rawValue: "Stereo")
}

/// One data source of the routed built-in mic (bottom / front / back).
public struct MicDataSource: Equatable, Sendable {
    public let id: Int
    public let name: String
    public let supportedPolarPatterns: [MicPolarPattern]
    public let selectedPolarPattern: MicPolarPattern?

    public init(id: Int, name: String, supportedPolarPatterns: [MicPolarPattern], selectedPolarPattern: MicPolarPattern?) {
        self.id = id
        self.name = name
        self.supportedPolarPatterns = supportedPolarPatterns
        self.selectedPolarPattern = selectedPolarPattern
    }
}

/// A data source plus the pattern to select on it.
public struct MicPolarChoice: Equatable, Sendable {
    public let dataSourceID: Int
    public let pattern: MicPolarPattern

    public init(dataSourceID: Int, pattern: MicPolarPattern) {
        self.dataSourceID = dataSourceID
        self.pattern = pattern
    }
}

/// Prefer the built-in mic's omnidirectional pattern over the speech-tuned
/// cardioid/subcardioid ones (#1708), unless the user picked a data source
/// (#1594).
public enum MicPolarPatternPolicy {
    /// The change to make, or nil to leave the route alone.
    public static func choice(sources: [MicDataSource], selectedID: Int?, userPickedDataSource: Bool) -> MicPolarChoice? {
        guard !userPickedDataSource else { return nil }
        if let selected = sources.first(where: { $0.id == selectedID }),
           selected.supportedPolarPatterns.contains(.omnidirectional) {
            return selected.selectedPolarPattern == .omnidirectional
                ? nil
                : MicPolarChoice(dataSourceID: selected.id, pattern: .omnidirectional)
        }
        return sources.first { $0.supportedPolarPatterns.contains(.omnidirectional) }
            .map { MicPolarChoice(dataSourceID: $0.id, pattern: .omnidirectional) }
    }
}

/// DEBUG launch-argument rules for simulator proofs, kept pure so they're
/// testable; the app only consults them inside `#if DEBUG`.
public enum DebugLaunchOptions {
    /// Demo sources never touch the mic, and `-skipMicPrompt` runs the real
    /// capture path without the system alert covering the screen.
    public static let micPromptSkippingFlags: Set<String> = ["-coachingDemo", "-speechBedDemo", "-skipMicPrompt", "-testNoise"]
    public static let openSettingsFlag = "-openSettings"

    public static func skipsMicPermissionPrompt(_ arguments: [String]) -> Bool {
        arguments.contains(where: micPromptSkippingFlags.contains)
    }

    public static func opensSettings(_ arguments: [String]) -> Bool {
        arguments.contains(openSettingsFlag)
    }
}

/// A permission that reports granted without prompting (DEBUG proofs only).
public struct PreGrantedMicPermission: MicPermission {
    public init() {}
    public func request() async -> Bool { true }
}
