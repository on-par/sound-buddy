import AVFAudio
import SoundBuddyKit

/// Record-permission prompt via AVAudioApplication (iOS 17+).
struct SystemMicPermission: MicPermission {
    func request() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }
}

/// The real MicInputSession (#1594): AVAudioSession's available inputs, with
/// the built-in mic split into its data sources (bottom / front / back) when
/// the OS exposes more than one. MicInputController holds the rules.
@MainActor
final class SystemMicInputSession: MicInputSession {
    private struct InputUnavailable: Error {}

    private var session: AVAudioSession { .sharedInstance() }

    func availableOptions() -> [MicInputOption] {
        // availableInputs is only filled in for a record-capable category;
        // MicCapture sets the same one, so this is a no-op while live.
        if session.category != .record {
            try? session.setCategory(.record, mode: .measurement)
        }
        return (session.availableInputs ?? []).flatMap(Self.options(for:))
    }

    func activeOptionID() -> String? {
        guard let input = session.currentRoute.inputs.first else { return nil }
        let options = Self.options(for: input)
        guard options.count > 1 else { return options.first?.id }
        let selected = input.selectedDataSource?.dataSourceID.intValue
        return options.first { $0.dataSourceID == selected }?.id
    }

    func apply(_ option: MicInputOption?) throws {
        guard let option else {
            try session.setPreferredInput(nil)
            return
        }
        guard let port = session.availableInputs?.first(where: { $0.uid == option.portUID }) else {
            throw InputUnavailable()
        }
        if let id = option.dataSourceID,
           let source = port.dataSources?.first(where: { $0.dataSourceID.intValue == id }) {
            try port.setPreferredDataSource(source)
        }
        try session.setPreferredInput(port)
    }

    private static func options(for port: AVAudioSessionPortDescription) -> [MicInputOption] {
        guard port.portType == .builtInMic, let sources = port.dataSources, sources.count > 1 else {
            return [MicInputOption(portUID: port.uid, dataSourceID: nil, name: port.portName)]
        }
        return sources.map {
            MicInputOption(portUID: port.uid, dataSourceID: $0.dataSourceID.intValue, name: "\(port.portName) (\($0.dataSourceName))")
        }
    }
}

extension MicRouteChange {
    /// Reads AVAudioSession.routeChangeNotification's reason (#1601).
    init(notification: Notification) {
        let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        switch raw.flatMap(AVAudioSession.RouteChangeReason.init(rawValue:)) {
        case .oldDeviceUnavailable: self = .deviceRemoved
        case .newDeviceAvailable: self = .deviceAdded
        default: self = .other
        }
    }
}

/// Preferred mic (#1594, else the system default) -> AVAudioEngine input tap -> SampleRingBuffer; a main-actor
/// meter loop pulls the newest FFT frame and runs SpectrumAnalyzer (coaching
/// bands + the display RTA from one FFT).
///
/// A device coming or going restarts capture on the new route (#1601; see
/// AnalyzeView). TODO(session): handle AVAudioSession interruptions (calls,
/// Siri) — pause with a visible state and resume per the architecture plan.
/// TODO(perf): run the FFT on a background queue if the meter loop ever shows
/// up in Instruments; a 4096-point vDSP FFT at 20 Hz is well under 1% today.
/// The input is whatever MicInputController routes before the engine starts;
/// every input shares the same analysis and the same uncalibrated estimate.
@MainActor
final class MicCapture: LiveAudioSource {
    /// UI meter refresh rate (the plan targets 15-30 Hz).
    static let meterRefreshHz = 20.0
    /// Tap buffer size requested from the input node (frames).
    static let tapBufferFrames: AVAudioFrameCount = 1024
    /// Ring holds this many FFT frames of history.
    static let ringFrames = 4

    /// Rebuilt on every start: after a route change the old engine's input
    /// node can keep the unplugged device's format.
    private var engine = AVAudioEngine()
    private let inputs: MicInputController
    private var ring: SampleRingBuffer?
    private var meterTask: Task<Void, Never>?

    init(inputs: MicInputController) {
        self.inputs = inputs
    }

    func start(onReading: @escaping @MainActor (SpectrumReading) -> Void) throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        // .measurement turns off the system's voice processing and AGC so the
        // spectrum reflects the room, not the phone's speech enhancement.
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true)
        // Route the user's mic (or the system default) before the input
        // node's format is read, so the tap matches the chosen input.
        inputs.applyPreferred()
        #endif

        let analyzer: SpectrumAnalyzer
        let ring: SampleRingBuffer
        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        do {
            // The Simulator can report a 0 Hz / 0-channel input; refuse it
            // before a tap is installed or the engine starts.
            try LiveInputFormat.validate(sampleRate: format.sampleRate, channelCount: Int(format.channelCount))
            analyzer = try SpectrumAnalyzer(sampleRate: format.sampleRate)
            ring = SampleRingBuffer(capacity: analyzer.fftSize * Self.ringFrames)
            input.installTap(onBus: 0, bufferSize: Self.tapBufferFrames, format: format, block: Self.tapBlock(writingTo: ring))
            engine.prepare()
            do {
                try engine.start()
            } catch {
                input.removeTap(onBus: 0)
                throw error
            }
        } catch {
            engine.stop()
            Self.releaseSession()
            throw error
        }
        self.ring = ring

        let interval = Duration.seconds(1 / Self.meterRefreshHz)
        meterTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard let frame = ring.latest(analyzer.fftSize),
                      let reading = try? analyzer.analyze(frame) else { continue }
                onReading(reading)
            }
        }
    }

    /// Built outside the main actor on purpose: a closure formed inside the
    /// @MainActor `start` would inherit main-actor isolation under Swift 6 and
    /// trap when AVAudioEngine calls it on the render thread.
    /// Channel 0 only: the built-in mic is mono for analysis purposes.
    private nonisolated static func tapBlock(writingTo ring: SampleRingBuffer) -> AVAudioNodeTapBlock {
        { buffer, _ in
            guard let channel = buffer.floatChannelData?[0] else { return }
            ring.write(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
        }
    }

    func stop() {
        meterTask?.cancel()
        meterTask = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        ring?.reset()
        ring = nil
        Self.releaseSession()
    }

    private static func releaseSession() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}
