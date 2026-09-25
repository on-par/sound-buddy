import AVFAudio
import SoundBuddyKit

/// Record-permission prompt via AVAudioApplication (iOS 17+).
struct SystemMicPermission: MicPermission {
    func request() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }
}

/// Built-in mic -> AVAudioEngine input tap -> SampleRingBuffer; a main-actor
/// meter loop pulls the newest FFT frame and runs SpectrumAnalyzer.
///
/// TODO(session): handle AVAudioSession interruptions (calls, Siri) and route
/// changes — pause with a visible state and resume per the architecture plan.
/// TODO(perf): run the FFT on a background queue if the meter loop ever shows
/// up in Instruments; a 4096-point vDSP FFT at 20 Hz is well under 1% today.
/// TODO(input): P1 input picker for external mics exposed by the OS.
@MainActor
final class MicCapture: LiveAudioSource {
    /// UI meter refresh rate (the plan targets 15-30 Hz).
    static let meterRefreshHz = 20.0
    /// Tap buffer size requested from the input node (frames).
    static let tapBufferFrames: AVAudioFrameCount = 1024
    /// Ring holds this many FFT frames of history.
    static let ringFrames = 4

    private let engine = AVAudioEngine()
    private var ring: SampleRingBuffer?
    private var meterTask: Task<Void, Never>?

    func start(onLevels: @escaping @MainActor (BandLevels) -> Void) throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        // .measurement turns off the system's voice processing and AGC so the
        // spectrum reflects the room, not the phone's speech enhancement.
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true)
        #endif

        let analyzer: SpectrumAnalyzer
        let ring: SampleRingBuffer
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
                      let levels = try? analyzer.bandLevels(frame) else { continue }
                onLevels(levels)
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
