import Foundation
import Observation

/// Asks the OS for microphone access. The app injects an AVAudioApplication
/// implementation; tests inject a fake.
public protocol MicPermission: Sendable {
    func request() async -> Bool
}

/// A live input that periodically reports 7-band levels on the main actor.
/// The app's MicCapture (AVAudioEngine -> SampleRingBuffer ->
/// SpectrumAnalyzer) is the real one.
@MainActor
public protocol LiveAudioSource: AnyObject {
    func start(onLevels: @escaping @MainActor (BandLevels) -> Void) throws
    func stop()
}

/// State behind the Analyze screen: permission, start/stop, the latest band
/// levels, and the short coaching stack. Views only render this.
@MainActor
@Observable
public final class AnalyzeModel {
    public enum State: Equatable {
        case idle
        case requestingPermission
        case micDenied
        case live
        case failed(String)
    }

    /// Always shown while analyzing on the built-in mic: a phone mic is not a
    /// measurement mic, so readings are estimates.
    public static let honestyCue = "Phone mic estimate"

    public private(set) var state: State = .idle
    public private(set) var bandLevels: BandLevels = .silent
    public private(set) var coaching: [CoachingEvent] = []
    public let measurementSource: CoachingEvent.Source = .phoneMicEstimate

    private let permission: MicPermission
    private let source: LiveAudioSource
    private let coach: BandDeviationCoach
    private let now: () -> Date
    private var sessionStart: Date?

    public init(
        permission: MicPermission,
        source: LiveAudioSource,
        coach: BandDeviationCoach = BandDeviationCoach(ideal: .flat),
        now: @escaping () -> Date = Date.init
    ) {
        self.permission = permission
        self.source = source
        self.coach = coach
        self.now = now
    }

    public func start() async {
        guard state != .live, state != .requestingPermission else { return }
        state = .requestingPermission
        guard await permission.request() else {
            state = .micDenied
            return
        }
        do {
            try source.start { [weak self] levels in self?.ingest(levels) }
            sessionStart = now()
            state = .live
        } catch {
            state = .failed("Couldn't start the microphone: \(error.localizedDescription). Tap Start to try again.")
        }
    }

    public func stop() {
        guard state == .live else { return }
        source.stop()
        sessionStart = nil
        state = .idle
    }

    private func ingest(_ levels: BandLevels) {
        bandLevels = levels
        let elapsed = sessionStart.map { now().timeIntervalSince($0) } ?? 0
        coaching = coach.events(for: levels, sessionTime: elapsed)
    }
}
