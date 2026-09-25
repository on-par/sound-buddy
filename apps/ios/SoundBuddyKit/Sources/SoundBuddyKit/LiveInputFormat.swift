import Foundation

/// Checks the live input's reported format before any tap is installed or the
/// engine starts. The Simulator can report a 0 Hz, 0-channel input when the
/// host mic is unavailable (AURemoteIO -10851); starting on that format used
/// to trap in SpectrumAnalyzer. MicCapture calls this and surfaces the error.
public enum LiveInputFormat {
    public enum Error: Swift.Error, Equatable, LocalizedError {
        case unusableSampleRate(Double)
        case noInputChannels

        public var errorDescription: String? {
            switch self {
            case .unusableSampleRate(let rate):
                "the audio input reports \(rate.formatted()) Hz, so there is no usable microphone. Check that a microphone is connected and allowed (on the Simulator, pick a Mac input under I/O › Audio Input)"
            case .noInputChannels:
                "the audio input has no input channels. Check that a microphone is connected and allowed"
            }
        }
    }

    public static func validate(sampleRate: Double, channelCount: Int) throws {
        guard sampleRate.isFinite, sampleRate > 0 else {
            throw Error.unusableSampleRate(sampleRate)
        }
        guard channelCount > 0 else { throw Error.noInputChannels }
    }
}
