import Foundation
import Testing
@testable import SoundBuddyKit

@Suite struct LiveInputFormatTests {
    @Test func acceptsARealMicFormat() throws {
        try LiveInputFormat.validate(sampleRate: 48_000, channelCount: 1)
        try LiveInputFormat.validate(sampleRate: 44_100, channelCount: 2)
    }

    /// The Simulator reports 0 Hz when the host input is unavailable.
    @Test(arguments: [0.0, -44_100.0, .nan, .infinity, -.infinity])
    func rejectsAnUnusableSampleRate(_ rate: Double) {
        let error = #expect(throws: LiveInputFormat.Error.self) {
            try LiveInputFormat.validate(sampleRate: rate, channelCount: 1)
        }
        guard case .unusableSampleRate = error else {
            Issue.record("expected unusableSampleRate, got \(String(describing: error))")
            return
        }
    }

    @Test func rejectsAFormatWithNoChannels() {
        #expect(throws: LiveInputFormat.Error.noInputChannels) {
            try LiveInputFormat.validate(sampleRate: 48_000, channelCount: 0)
        }
    }

    @Test func errorsTellTheUserWhatToDo() {
        let rate = LiveInputFormat.Error.unusableSampleRate(0).errorDescription ?? ""
        #expect(rate.contains("0 Hz"))
        #expect(rate.contains("microphone"))
        let channels = LiveInputFormat.Error.noInputChannels.errorDescription ?? ""
        #expect(channels.contains("no input channels"))
        #expect(channels.contains("microphone"))
    }
}
