import Foundation
import Testing
@testable import SoundBuddyKit

// #1702: Analyze in the Speech + bed state (talk over a quiet underscore).
// Readings carry ProgramFeatures from the synthetic speech-over-pad material
// (SpeechBedSignals) at the mic's ~20 Hz meter rate, through a fake
// LiveAudioSource and an injected clock.

private struct GrantedPermission: MicPermission {
    func request() async -> Bool { true }
}

private final class ScriptedSource: LiveAudioSource {
    var onReading: (@MainActor (SpectrumReading) -> Void)?
    func start(onReading: @escaping @MainActor (SpectrumReading) -> Void) throws { self.onReading = onReading }
    func stop() { onReading = nil }
}

@MainActor
private final class Clock {
    var now = Date(timeIntervalSince1970: 80_000)
}

private let musicLike = ProgramFeatures(
    speechBandFraction: 0.3, subFraction: 0.12, airFraction: 0.08, centroidHz: 3200, flatness: 0.01, levelDb: -20
)
private let speechLike = ProgramFeatures(
    speechBandFraction: 0.62, subFraction: 0.03, airFraction: 0.01, centroidHz: 1400, flatness: 0.05, levelDb: -47
)

/// The FOH report's shape, judged against the speech curve: the underscore's
/// low end and air read hot (+10 to +14 dB), and the voice itself is a little
/// thin in the mids (-7 dB).
private let bedHeavyOffsets: [Band: Double] = [.subBass: 14, .bass: 12, .brilliance: 10, .mid: -7]

@MainActor
@Suite struct AnalyzeSpeechBedTests {
    private let source = ScriptedSource()
    private let clock = Clock()
    private let signals = SpeechBedSignals()
    static let frame: TimeInterval = 0.05

    private func liveModel(targetIsAuto: Bool = true) async throws -> AnalyzeModel {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = AnalyzeModel(
            permission: GrantedPermission(), source: source, target: worship, targetIsAuto: targetIsAuto,
            now: { [clock] in clock.now }
        )
        await m.appear()
        return m
    }

    private func levels(_ offsets: [Band: Double]) throws -> BandLevels {
        let speech = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.speechPodcastId)
        return BandLevels(db: Dictionary(uniqueKeysWithValues: Band.allCases.map {
            ($0, -40 + (speech.bandTargets[$0] ?? 0) + (offsets[$0] ?? 0))
        }))
    }

    /// Delivers `seconds` of readings starting `from` seconds into the
    /// program, with features from `features(t)`; `check(t)` runs after each.
    private func run(
        _ seconds: TimeInterval,
        from start: TimeInterval = 0,
        bands: BandLevels,
        features: (TimeInterval) -> ProgramFeatures,
        check: (TimeInterval) -> Void = { _ in }
    ) throws {
        let frames = Int((seconds / Self.frame).rounded())
        for i in 0..<frames {
            let t = start + Double(i) * Self.frame
            clock.now += Self.frame
            let send = try #require(source.onReading, "source is not running")
            send(SpectrumReading(bands: bands, rtaDb: [-40, -50], overallDb: -30, programFeatures: features(t)))
            check(t)
        }
    }

    private func speechOverPad(_ t: TimeInterval) -> ProgramFeatures {
        signals.features(.speechOverPad, at: t)
    }

    @Test func talkOverAnUnderscoreShowsASteadySpeechPlusBedChipWithVoiceBandTipsOnly() async throws {
        let m = try await liveModel()
        var switchedAt: TimeInterval?
        var chips: [String] = []
        try run(60, bands: levels(bedHeavyOffsets), features: speechOverPad) { t in
            if chips.last != m.programModeChipText { chips.append(m.programModeChipText) }
            if switchedAt == nil, m.programMode == .speechOverBed { switchedAt = t }
            if switchedAt != nil {
                let tipBands = Set(m.coaching.compactMap(\.band))
                #expect(tipBands.isSubset(of: ProgramMode.voiceBands), "only voice-band tips in Speech + bed, got \(tipBands)")
                #expect(Set(m.problemMarkers.map(\.band)).isSubset(of: ProgramMode.voiceBands))
            }
        }
        #expect(switchedAt != nil)
        #expect(chips == ["Music", "Speech + bed"], "one change, then a steady chip for the rest of the minute")
        #expect(m.programModeChipText == "Speech + bed")
        #expect(m.coaching.map(\.band) == [.mid], "the thin voice still gets its tip; the bed's lows and air do not")
        #expect(m.target.id == IdealCurveLibrary.speechPodcastId, "judged against the speech curve")
        #expect(m.targetLegendText == "Target · Speech / podcast (auto)")
        #expect(m.programModeAccessibilityLabel == "Program: speech over a music bed, target switched automatically")
    }

    @Test func pureSpeechStillCoachesEveryBand() async throws {
        let m = try await liveModel()
        try run(20, bands: levels(bedHeavyOffsets), features: { _ in speechLike })
        #expect(m.programMode == .speech)
        #expect(m.programModeChipText == "Speech")
        #expect(m.coaching.contains { $0.band == .subBass || $0.band == .bass }, "without a bed, the low end is the voice's own")
    }

    @Test func switchingIntoSpeechPlusBedResetsTheCoaching() async throws {
        let m = try await liveModel()
        try run(14, bands: levels(bedHeavyOffsets), features: { _ in speechLike })
        #expect(m.programMode == .speech)
        #expect(!m.coaching.isEmpty, "tips are showing under Speech")

        var switchedAt: TimeInterval?
        var reappearedAfter: TimeInterval?
        try run(30, from: 14, bands: levels(bedHeavyOffsets), features: { t in
            Int((t / Self.frame).rounded()).isMultiple(of: 2) ? speechLike : musicLike
        }) { t in
            if switchedAt == nil, m.programMode == .speechOverBed {
                switchedAt = t
                #expect(m.coaching.isEmpty, "the switch drops every tip at once")
                #expect(m.problemMarkers.isEmpty)
            }
            if let switchedAt, reappearedAfter == nil, !m.coaching.isEmpty { reappearedAfter = t - switchedAt }
        }
        #expect(switchedAt != nil)
        let wait = try #require(reappearedAfter, "the voice-band tip earns its way back")
        #expect(wait >= CoachingStabilizer.enterDwellSeconds - Self.frame, "full enter dwell after the switch")
        #expect(m.coaching.map(\.band) == [.mid])
    }

    @Test func aUserChosenTargetIsNeverSwitchedInSpeechPlusBed() async throws {
        let m = try await liveModel(targetIsAuto: false)
        try run(30, bands: levels(bedHeavyOffsets), features: speechOverPad)
        #expect(m.programMode == .speechOverBed, "the chip still shows the detected state")
        #expect(m.programModeChipText == "Speech + bed")
        #expect(m.target.id == IdealCurveLibrary.worshipServiceId, "a user-chosen target is never switched")
        #expect(m.targetLegendText == "Target · Worship service")
        #expect(m.programModeAccessibilityLabel == "Program: speech over a music bed")
    }

    @Test func voiceBandsAreTheMidrangeBands() {
        #expect(ProgramMode.voiceBands == [.lowMid, .mid, .highMid])
        #expect(ProgramMode.speechOverBed.coachedBands == ProgramMode.voiceBands)
        #expect(ProgramMode.speech.coachedBands == Set(Band.allCases))
        #expect(ProgramMode.music.coachedBands == Set(Band.allCases))
    }
}
