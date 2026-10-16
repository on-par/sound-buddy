import Foundation
import Testing
@testable import SoundBuddyKit

// #1715: the Analyze coaching cards run through the same path the live screen
// uses — level-matched deltas -> CoachingDeltaSmoother -> CoachingStabilizer
// (dwell, hysteresis, calm state, Speech/Music reset) -> AnalyzeCoachingViewModel.
// These tests drive AnalyzeModel with synthetic spectra at the mic's ~20 Hz
// meter rate through a fake LiveAudioSource and an injected clock.

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
    var now = Date(timeIntervalSince1970: 50_000)
}

/// Flat target, so a band's level-matched deviation is just its offset from
/// the others. Base -30 dBFS keeps every reading above the signal gate.
private func spectrum(_ offsets: [Band: Double]) -> BandLevels {
    BandLevels(db: Dictionary(uniqueKeysWithValues: Band.allCases.map { ($0, -30 + (offsets[$0] ?? 0)) }))
}

private let musicFeatures = ProgramFeatures(
    speechBandFraction: 0.3, subFraction: 0.12, airFraction: 0.08, centroidHz: 3200, flatness: 0.01, levelDb: -20
)
private let speechFeatures = ProgramFeatures(
    speechBandFraction: 0.62, subFraction: 0.03, airFraction: 0.01, centroidHz: 1400, flatness: 0.05, levelDb: -47
)

@MainActor
@Suite struct AnalyzeStabilizedCoachingTests {
    private let source = ScriptedSource()
    private let clock = Clock()
    static let frame: TimeInterval = 0.05

    private func liveModel(target: IdealCurve = .flat, presetLoader: @escaping (String) throws -> IdealCurve = { _ in .flat })
        async -> AnalyzeModel
    {
        let m = AnalyzeModel(
            permission: GrantedPermission(), source: source, target: target, targetIsAuto: true,
            presetLoader: presetLoader, now: { [clock] in clock.now }
        )
        await m.appear()
        return m
    }

    /// Delivers `seconds` of readings at the meter rate, calling `check`
    /// after each with the elapsed time since this call started.
    private func run(
        _ seconds: TimeInterval,
        features: ProgramFeatures? = musicFeatures,
        _ offsets: (TimeInterval) -> [Band: Double],
        check: (TimeInterval) -> Void = { _ in }
    ) throws {
        let frames = Int((seconds / Self.frame).rounded())
        for i in 0..<frames {
            let t = Double(i) * Self.frame
            clock.now += Self.frame
            let send = try #require(source.onReading, "source is not running")
            send(SpectrumReading(bands: spectrum(offsets(t)), rtaDb: [-40, -50], overallDb: -18, programFeatures: features))
            check(t)
        }
    }

    // MARK: Dwell

    @Test func aTipWaitsForTheEnterDwellInsteadOfAppearingOnTheFirstReading() async throws {
        let m = await liveModel()
        var firstShownAt: TimeInterval?
        try run(8, { _ in [.bass: 9] }) { t in
            if firstShownAt == nil, !m.coaching.isEmpty { firstShownAt = t }
        }
        let shown = try #require(firstShownAt, "a sustained 9 dB bass excess must eventually show a tip")
        #expect(shown >= CoachingStabilizer.enterDwellSeconds - Self.frame, "not before the enter dwell")
        #expect(shown <= CoachingStabilizer.enterDwellSeconds + AnalyzeModel.coachingRefreshSeconds + Self.frame)
        #expect(m.coaching.map(\.band) == [.bass])
        #expect(m.problemMarkers.map(\.band) == [.bass])
    }

    /// The #1715 acceptance test: under fluctuating synthetic spectra the tip
    /// set changes no faster than the dwell — no tip before the enter dwell,
    /// every tip stays at least `minimumVisibleSeconds`, continuing cards
    /// never reorder, and the RTA still follows every reading.
    @Test func underFluctuatingInputTheTipSetChangesNoFasterThanTheDwell() async throws {
        let m = await liveModel()
        var rng = SeededRandom(seed: 1715)
        var shownSince: [Band: TimeInterval] = [:]
        var completedRuns: [(Band, TimeInterval)] = []
        var previousOrder: [Band] = []
        var setChanges = 0
        var everShown = Set<Band>()

        // 90 s of music dynamics: Bass and Presence swing across the enter
        // threshold every ~1.2 s, Low-mid comes and goes, everything jitters.
        try run(90, { t in
            let swing = sin(t * .pi / 1.2)
            var offsets: [Band: Double] = [
                .bass: 6 + 5 * swing + rng.jitter(1.5),
                .presence: -(5 - 4 * swing) + rng.jitter(1.5),
                .mid: rng.jitter(2),
            ]
            if (t / 7).rounded(.down).truncatingRemainder(dividingBy: 2) == 1 { offsets[.lowMid] = 7 + rng.jitter(3) }
            if t > 60 { offsets = [.mid: rng.jitter(0.8)] } // the mix settles on target
            return offsets
        }) { t in
            let order = m.coaching.compactMap(\.band)
            let now = Set(order)
            #expect(m.coaching.count <= AnalyzeCoachingViewModel.maxCards)
            if t < CoachingStabilizer.enterDwellSeconds - Self.frame { #expect(order.isEmpty, "no tip before the enter dwell (t=\(t))") }
            for band in now where shownSince[band] == nil { shownSince[band] = t; everShown.insert(band) }
            for (band, since) in shownSince where !now.contains(band) {
                completedRuns.append((band, t - since))
                shownSince[band] = nil
            }
            let survivors = previousOrder.filter(now.contains)
            #expect(Array(order.prefix(survivors.count)) == survivors, "continuing cards keep their order (t=\(t))")
            if Set(previousOrder) != now { setChanges += 1 }
            previousOrder = order
            #expect(m.rta.levels == [-40, -50], "the RTA keeps its own per-reading timing")
        }

        #expect(!everShown.isEmpty, "the fluctuating input must actually raise tips")
        #expect(!completedRuns.isEmpty, "and the settled tail must clear them")
        for (band, duration) in completedRuns {
            #expect(duration >= CoachingStabilizer.minimumVisibleSeconds - Self.frame, "\(band) held only \(duration) s")
        }
        #expect(setChanges <= 2 * everShown.count, "tips don't flicker in and out")
        #expect(m.coaching.isEmpty)
        #expect(m.isMixOnTarget, "the settled tail ends in the calm state")
    }

    @Test func aVisibleTipThatDipsBrieflyBelowTheThresholdStays() async throws {
        let m = await liveModel()
        try run(7, { _ in [.bass: 9] })
        #expect(m.coaching.map(\.band) == [.bass])
        // 2 s on target, then back: smoothing + the exit dwell keep the card.
        try run(2, { _ in [:] }) { _ in #expect(m.coaching.map(\.band) == [.bass]) }
        try run(3, { _ in [.bass: 9] }) { _ in #expect(m.coaching.map(\.band) == [.bass]) }
    }

    @Test func cardsDoNotReorderWhenVisibleTipsTradeSeverity() async throws {
        let m = await liveModel()
        try run(8, { _ in [.bass: 10, .presence: -7] })
        #expect(m.coaching.map(\.band) == [.bass, .presence])
        try run(20, { _ in [.bass: 6, .presence: -14] }) { _ in
            #expect(m.coaching.map(\.band) == [.bass, .presence])
        }
        let presence = try #require(m.coaching.last?.data?["deviationDb"])
        guard case let .number(value) = presence else { Issue.record("no number"); return }
        #expect(value < -10, "the Presence card's number follows the smoothed delta in place")
    }

    // MARK: Calm state

    @Test func theCalmStateShowsWhenEveryBandIsInTolerance() async throws {
        let m = await liveModel()
        #expect(!m.isMixOnTarget, "nothing measured yet")
        try run(CoachingStabilizer.calmDwellSeconds + 1, { _ in [.mid: 1.5, .bass: -1] })
        #expect(m.isMixOnTarget)
        #expect(m.coaching.isEmpty)
        #expect(m.coachingPlaceholder == CoachingStabilizer.onTargetMessage)
    }

    /// #1773: calm needs the calm dwell, and then shows on that frame rather
    /// than waiting for the next once-a-second card refresh.
    @Test func theCalmStateArrivesWhenTheCalmDwellCompletes() async throws {
        let m = await liveModel()
        var firstCalmAt: TimeInterval?
        try run(4, { _ in [.mid: 1.5, .bass: -1] }) { t in
            if firstCalmAt == nil, m.isMixOnTarget { firstCalmAt = t }
        }
        let calm = try #require(firstCalmAt, "an in-tolerance mix must reach calm")
        #expect(calm >= CoachingStabilizer.calmDwellSeconds - Self.frame, "not before the calm dwell")
        #expect(calm <= CoachingStabilizer.calmDwellSeconds + 2 * Self.frame, "and not a card refresh later (t=\(calm))")
    }

    /// #1773: while a band dwells toward a tip, the coach shows the neutral
    /// listening placeholder, never 'Mix is on target'.
    @Test func aBandDwellingTowardATipShowsListeningNotCalm() async throws {
        let m = await liveModel()
        try run(CoachingStabilizer.enterDwellSeconds - 0.5, { _ in [.lowMid: 13, .highMid: -16.7] }) { t in
            #expect(m.coaching.isEmpty, "still inside the enter dwell (t=\(t))")
            #expect(!m.isMixOnTarget, "a band 13 dB off is not calm (t=\(t))")
            #expect(m.coachingPlaceholder != CoachingStabilizer.onTargetMessage)
            #expect(m.coachingPlaceholder.hasPrefix("Listening"))
        }
    }

    /// Calm drops on the reading where the smoothed delta reaches the enter
    /// threshold — the same reading that starts the enter dwell — not on the
    /// next card refresh, so it is gone a full enter dwell before the tip.
    /// The prelude lengths put that reading at different phases of the
    /// once-a-second card refresh.
    @Test(arguments: [0.0, 0.25, 0.5, 0.75])
    func calmDropsOnTheReadingABandStartsDwelling(refreshPhase: TimeInterval) async throws {
        let m = await liveModel()
        try run(CoachingStabilizer.calmDwellSeconds + 1 + refreshPhase, { _ in [:] })
        #expect(m.isMixOnTarget)
        var droppedAt: TimeInterval?
        var tipAt: TimeInterval?
        try run(10, { _ in [.lowMid: 13] }) { t in
            if droppedAt == nil, !m.isMixOnTarget { droppedAt = t }
            if droppedAt != nil { #expect(!m.isMixOnTarget, "calm must not come back while low-mid is off (t=\(t))") }
            if tipAt == nil, !m.coaching.isEmpty { tipAt = t }
        }
        let dropped = try #require(droppedAt, "a 13 dB low-mid must drop calm")
        let tip = try #require(tipAt, "and eventually raise a tip")
        #expect(tip - dropped >= CoachingStabilizer.enterDwellSeconds - Self.frame, "calm dropped only \(tip - dropped) s before the tip")
    }

    // MARK: Resets

    @Test func aSpeechMusicSwitchClearsTipsAndRestartsTheDwell() async throws {
        let m = await liveModel(target: .flat, presetLoader: { _ in .flat })
        try run(7, { _ in [.bass: 9] })
        #expect(m.coaching.map(\.band) == [.bass])
        #expect(m.programMode == .music)

        var switchedAt: TimeInterval?
        var reappearedAt: TimeInterval?
        try run(16, features: speechFeatures, { _ in [.bass: 9] }) { t in
            if switchedAt == nil, m.programMode == .speech {
                switchedAt = t
                #expect(m.coaching.isEmpty, "the switch clears the visible tip immediately")
                #expect(m.problemMarkers.isEmpty)
            }
            if let switchedAt, reappearedAt == nil, !m.coaching.isEmpty { reappearedAt = t - switchedAt }
        }
        #expect(switchedAt != nil, "speech over a pad switches the mode")
        let wait = try #require(reappearedAt, "the tip earns its way back under the new target")
        #expect(wait >= CoachingStabilizer.enterDwellSeconds - Self.frame, "full enter dwell after the switch, no carryover")
    }

    @Test func stoppingListeningResetsTheCoaching() async throws {
        let m = await liveModel()
        try run(7, { _ in [.bass: 9] })
        #expect(!m.coaching.isEmpty)
        m.disappear()
        #expect(m.coaching.isEmpty)
        #expect(m.problemMarkers.isEmpty)
        #expect(!m.isMixOnTarget)
        await m.appear()
        try run(4, { _ in [.bass: 9] }) { _ in
            #expect(m.coaching.isEmpty, "no carryover: the dwell starts over after a stop")
        }
    }

    @Test func committingADifferentTargetRestartsTheDwell() async throws {
        let m = await liveModel()
        try run(7, { _ in [.bass: 9] })
        #expect(!m.coaching.isEmpty)
        m.beginTargetEdit()
        m.updateTargetDraft(try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId))
        m.commitTargetEdit()
        #expect(m.coaching.isEmpty, "deltas judged against the old curve are dropped")
    }
}

private struct SeededRandom {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
    /// Uniform in [-amplitude, amplitude].
    mutating func jitter(_ amplitude: Double) -> Double {
        (Double(next() % 10_000) / 10_000 * 2 - 1) * amplitude
    }
}
