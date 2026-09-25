import Foundation
import Observation

/// Asks the OS for microphone access. The app injects an AVAudioApplication
/// implementation; tests inject a fake.
public protocol MicPermission: Sendable {
    func request() async -> Bool
}

/// A live input that periodically reports a spectrum reading (7 coaching
/// bands + the display RTA) on the main actor. The app's MicCapture
/// (AVAudioEngine -> SampleRingBuffer -> SpectrumAnalyzer) is the real one.
@MainActor
public protocol LiveAudioSource: AnyObject {
    func start(onReading: @escaping @MainActor (SpectrumReading) -> Void) throws
    func stop()
}

/// State behind the Analyze screen. Analyze is always listening while it is on
/// screen and the app is in the foreground — there is no Start/Stop control.
/// The view reports lifecycle (appear/disappear, background/foreground,
/// terminate); this model owns permission, the mic, the latest readings, and
/// the short coaching stack. Views only render this.
///
/// P0 has no background audio mode, so backgrounding releases the mic and the
/// foreground resumes it.
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
    /// The coaching stack changes at most this often, so its text stays
    /// readable while the meter runs at 20 Hz.
    public static let coachingRefreshSeconds = 1.0
    /// A gap longer than this between readings (e.g. a stalled engine) ages
    /// the RTA meter by this much at most.
    static let maxMeterStepSeconds = 0.5

    public private(set) var state: State = .idle
    public private(set) var bandLevels: BandLevels = .silent
    public private(set) var rta = RTAMeter()
    public private(set) var coaching: [CoachingEvent] = []
    public let rtaLayout = RTALayout.standard
    public let measurementSource: CoachingEvent.Source = .phoneMicEstimate

    private let permission: MicPermission
    private let source: LiveAudioSource
    private let coach: BandDeviationCoach
    private let now: () -> Date
    private var sessionStart: Date?
    private var lastReadingAt: Date?
    private var lastCoachingAt: Date?
    private var isOnScreen = false
    private var isForeground = true

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

    /// Placeholder for an empty coaching stack. Never points at a button:
    /// listening is automatic.
    public var coachingPlaceholder: String {
        switch state {
        case .live:
            "Balance looks close to the target. Keep listening."
        case .idle, .requestingPermission:
            "Listening starts automatically. Play program material through the PA."
        case .micDenied, .failed:
            "Coaching starts once the microphone is on."
        }
    }

    // MARK: Lifecycle

    /// The Analyze screen is on screen: start listening.
    public func appear() async {
        isOnScreen = true
        await listen()
    }

    /// The Analyze screen left the screen: release the mic.
    public func disappear() {
        isOnScreen = false
        halt()
    }

    /// The app went to the background. No background audio in P0.
    public func enterBackground() {
        isForeground = false
        halt()
    }

    /// Back in the foreground: resume if Analyze is on screen. Also re-asks
    /// for the mic, so access granted in Settings takes effect on return.
    public func enterForeground() async {
        isForeground = true
        await listen()
    }

    /// The "Try again" action after a start failure.
    public func retry() async {
        await listen()
    }

    /// The app is terminating: release the mic.
    public func terminate() {
        halt()
    }

    private func listen() async {
        guard isOnScreen, isForeground, state != .live, state != .requestingPermission else { return }
        state = .requestingPermission
        let granted = await permission.request()
        // The app may have left the foreground while the prompt was up.
        guard isOnScreen, isForeground else {
            state = .idle
            return
        }
        guard granted else {
            state = .micDenied
            return
        }
        do {
            try source.start { [weak self] reading in self?.ingest(reading) }
            sessionStart = now()
            state = .live
        } catch {
            state = .failed(
                "Couldn't start the microphone: \(error.localizedDescription). Tap Try again, or close other apps that are using the mic."
            )
        }
    }

    private func halt() {
        guard state == .live else { return }
        source.stop()
        sessionStart = nil
        lastReadingAt = nil
        lastCoachingAt = nil
        bandLevels = .silent
        rta.reset()
        coaching = []
        state = .idle
    }

    private func ingest(_ reading: SpectrumReading) {
        let time = now()
        let step = lastReadingAt.map { min(Self.maxMeterStepSeconds, time.timeIntervalSince($0)) } ?? 0
        lastReadingAt = time
        bandLevels = reading.bands
        rta.ingest(reading.rtaDb, dt: step)

        if let last = lastCoachingAt, time.timeIntervalSince(last) < Self.coachingRefreshSeconds { return }
        lastCoachingAt = time
        let elapsed = sessionStart.map { time.timeIntervalSince($0) } ?? 0
        coaching = coach.events(for: reading.bands, sessionTime: elapsed)
    }
}
