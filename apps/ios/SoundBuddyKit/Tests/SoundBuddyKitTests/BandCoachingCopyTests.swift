import Testing
@testable import SoundBuddyKit

@Suite struct BandCoachingCopyTests {
    @Test func rangeLabelsMatchTheMacDialectForEveryBand() {
        let expected: [Band: String] = [
            .subBass: "20–60 Hz",
            .bass: "60–250 Hz",
            .lowMid: "250–500 Hz",
            .mid: "500 Hz–2 kHz",
            .highMid: "2–4 kHz",
            .presence: "4–6 kHz",
            .brilliance: "6–20 kHz",
        ]
        for band in Band.allCases {
            let label = BandCoachingCopy.rangeLabel(lowHz: band.lowHz, highHz: band.highHz)
            #expect(label == expected[band])
            #expect(label.contains("\u{2013}"), "must use an en dash, not a hyphen")
        }
    }

    @Test func overMessageMatchesTheMacGentleCutDialect() {
        let message = BandCoachingCopy.message(band: .mid, amountDb: 4.2, over: true)
        #expect(message == "Mid (500 Hz–2 kHz) is 4.2 dB above the target. A gentle cut there is what Sound Buddy would try first.")
    }

    @Test func underMessageMatchesTheMacSmallBoostDialect() {
        let message = BandCoachingCopy.message(band: .bass, amountDb: 3.0, over: false)
        #expect(message == "Bass (60–250 Hz) is 3.0 dB below the target. A small boost there is what Sound Buddy would try first.")
    }

    @Test func noMessageAsksForAnAppAction() {
        for (band, over) in [(Band.subBass, true), (.brilliance, false)] {
            let message = BandCoachingCopy.message(band: band, amountDb: 5.0, over: over)
            #expect(!message.contains("Start"))
            #expect(!message.contains("Stop"))
            #expect(!message.contains("Tap"))
        }
    }
}
