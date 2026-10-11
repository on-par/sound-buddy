import Foundation
import Testing
@testable import SoundBuddyKit

private struct FakePermission: MicPermission {
    let granted: Bool
    func request() async -> Bool { granted }
}

/// Lets a test act (e.g. background the app) while the permission prompt is up.
private final class GatedPermission: MicPermission, @unchecked Sendable {
    let onRequest: @MainActor () -> Void
    init(onRequest: @escaping @MainActor () -> Void) { self.onRequest = onRequest }
    func request() async -> Bool {
        await onRequest()
        return true
    }
}

private final class SwitchablePermission: MicPermission, @unchecked Sendable {
    var granted: Bool
    init(granted: Bool) { self.granted = granted }
    func request() async -> Bool { granted }
}

private struct StartFailure: Error, LocalizedError {
    var errorDescription: String? { "input unavailable" }
}

@MainActor
private final class FakeSource: LiveAudioSource {
    var startCount = 0
    var stopCount = 0
    var failStart = false
    var onReading: (@MainActor (SpectrumReading) -> Void)?

    var isRunning: Bool { onReading != nil }

    func start(onReading: @escaping @MainActor (SpectrumReading) -> Void) throws {
        if failStart { throw StartFailure() }
        startCount += 1
        self.onReading = onReading
    }

    func stop() {
        stopCount += 1
        onReading = nil
    }
}

@MainActor
private final class FakeClock {
    var now = Date(timeIntervalSince1970: 1_000)
    func advance(_ seconds: TimeInterval) { now += seconds }
}

private func levels(base: Double = -30, _ overrides: [Band: Double] = [:]) -> BandLevels {
    BandLevels(db: Dictionary(uniqueKeysWithValues: Band.allCases.map { ($0, overrides[$0] ?? base) }))
}

private func reading(
    _ bands: BandLevels,
    rta: [Double] = [-40, -50],
    overallDb: Double = -18.43,
    programFeatures: ProgramFeatures? = nil
) -> SpectrumReading {
    SpectrumReading(bands: bands, rtaDb: rta, overallDb: overallDb, programFeatures: programFeatures)
}

/// Full-band music-shaped features: no speech-band majority, real sub/air
/// energy, a bright centroid — a clear `.music` classification.
private func musicFeatures(levelDb: Double = -20) -> ProgramFeatures {
    ProgramFeatures(speechBandFraction: 0.3, subFraction: 0.12, airFraction: 0.08, centroidHz: 3200, flatness: 0.01, levelDb: levelDb)
}

/// The 2026-10-11 dogfood shape: speech over a quiet instrumental bed —
/// voice-band-heavy, quiet, low centroid — a clear `.speech` classification.
private func speechOverAPadFeatures(levelDb: Double = -47) -> ProgramFeatures {
    ProgramFeatures(speechBandFraction: 0.62, subFraction: 0.03, airFraction: 0.01, centroidHz: 1400, flatness: 0.05, levelDb: levelDb)
}

@MainActor
@Suite struct AnalyzeModelTests {
    fileprivate let source = FakeSource()
    fileprivate let clock = FakeClock()

    func model(granted: Bool = true) -> AnalyzeModel {
        model(permission: FakePermission(granted: granted))
    }

    func model(permission: MicPermission) -> AnalyzeModel {
        AnalyzeModel(permission: permission, source: source, now: { [clock] in clock.now })
    }

    func model(target: IdealCurve, targetIsAuto: Bool = true) -> AnalyzeModel {
        AnalyzeModel(
            permission: FakePermission(granted: true),
            source: source,
            target: target,
            targetIsAuto: targetIsAuto,
            now: { [clock] in clock.now }
        )
    }

    func model(
        target: IdealCurve,
        targetIsAuto: Bool = true,
        presetLoader: @escaping (String) throws -> IdealCurve
    ) -> AnalyzeModel {
        AnalyzeModel(
            permission: FakePermission(granted: true),
            source: source,
            target: target,
            targetIsAuto: targetIsAuto,
            presetLoader: presetLoader,
            now: { [clock] in clock.now }
        )
    }

    func deliver(_ r: SpectrumReading) throws {
        let send = try #require(source.onReading, "source is not running")
        send(r)
    }

    /// Default sustain: past the stabilizer's enter dwell plus one card refresh.
    static let pastTheEnterDwell = CoachingStabilizer.enterDwellSeconds + AnalyzeModel.coachingRefreshSeconds + 0.5

    /// Feeds `bands` at the ~20 Hz meter rate for `seconds`. Since #1715 a tip
    /// only appears after a sustained off-target run (the enter dwell), so a
    /// single reading no longer raises one.
    func sustain(_ bands: BandLevels, seconds: Double = pastTheEnterDwell, rta: [Double] = [-40, -50]) throws {
        for _ in 0..<Int((seconds / 0.05).rounded()) {
            clock.advance(0.05)
            try deliver(reading(bands, rta: rta))
        }
    }

    /// What the stabilized path settles on for a constant `bands`: the bands
    /// at or over the stabilizer's enter threshold, most severe first.
    func settledCoaching(_ coach: BandDeviationCoach, _ bands: BandLevels) -> (events: [CoachingEvent], markers: [ProblemMarkerDescriptor]) {
        let deviations = coach.deviations(for: bands)
        let visible = Set(deviations.filter { abs($0.value) >= CoachingStabilizer.enterThresholdDb }.keys)
        return (
            coach.events(forDeviations: deviations, bands: visible, sessionTime: 0),
            coach.problemMarkers(forDeviations: deviations, bands: visible)
        )
    }

    /// Cards compared without their session time.
    func content(_ events: [CoachingEvent]) -> [CoachingEvent] {
        events.map {
            CoachingEvent(
                id: $0.id, ruleType: $0.ruleType, severity: $0.severity, band: $0.band,
                message: $0.message, data: $0.data, source: $0.source, sessionTime: 0
            )
        }
    }

    @Test func startsIdleWithSilentBandsAndThePhoneMicCue() {
        let m = model()
        #expect(m.state == .idle)
        #expect(m.bandLevels == .silent)
        #expect(m.rta.levels.isEmpty)
        #expect(m.coaching.isEmpty)
        #expect(m.problemMarkers.isEmpty)
        #expect(m.measurementSource == .phoneMicEstimate)
        #expect(AnalyzeModel.honestyCue == "Phone mic estimate")
        #expect(source.startCount == 0, "nothing listens until the screen appears")
        #expect(m.overallDb == nil)
        #expect(m.overallSplDb == nil)
        #expect(m.overallLevelText == "—")
        #expect(m.overallLevelNumberText == "—")
    }

    // MARK: Always listening

    @Test func appearingStartsListeningWithNoTap() async {
        let m = model()
        await m.appear()
        #expect(m.state == .live)
        #expect(source.startCount == 1)
    }

    // MARK: Mic input change (#1594)

    @Test func restartListeningStopsAndStartsALiveSource() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(levels()))
        #expect(m.overallDb != nil)

        await m.restartListening()

        #expect(source.stopCount == 1)
        #expect(source.startCount == 2)
        #expect(m.state == .live)
        #expect(m.overallDb == nil, "the old input's reading is not carried over")
    }

    @Test func restartListeningOffScreenStartsNothing() async {
        let m = model()
        await m.restartListening()
        #expect(source.startCount == 0)
        #expect(source.stopCount == 0)
        #expect(m.state == .idle)
    }

    @Test func restartListeningRecoversFromAFailedStart() async {
        let m = model()
        source.failStart = true
        await m.appear()
        guard case .failed = m.state else {
            Issue.record("expected a failed start, got \(m.state)")
            return
        }
        source.failStart = false

        await m.restartListening()

        #expect(m.state == .live)
        #expect(source.startCount == 1)
    }

    @Test func deniedPermissionNeverStartsTheMic() async {
        let m = model(granted: false)
        await m.appear()
        #expect(m.state == .micDenied)
        #expect(source.startCount == 0)
        #expect(m.overallLevelText == "—")
    }

    @Test func aSourceFailureIsReportedActionably() async {
        source.failStart = true
        let m = model()
        await m.appear()
        guard case .failed(let message) = m.state else {
            Issue.record("expected .failed, got \(m.state)")
            return
        }
        #expect(message.contains("input unavailable"))
        #expect(message.contains("Try again"))
        #expect(!message.contains("Start"), "there is no Start button to point at")
    }

    @Test func retryAfterAFailureGoesLive() async {
        source.failStart = true
        let m = model()
        await m.appear()
        source.failStart = false
        await m.retry()
        #expect(m.state == .live)
    }

    @Test func appearingTwiceIsANoOp() async {
        let m = model()
        await m.appear()
        await m.appear()
        #expect(source.startCount == 1)
    }

    @Test func backgroundingReleasesTheMicAndClearsStaleReadings() async throws {
        let m = model()
        await m.appear()
        clock.advance(4)
        try deliver(reading(levels([.lowMid: -22])))
        m.enterBackground()
        #expect(m.state == .idle)
        #expect(source.stopCount == 1)
        #expect(m.bandLevels == .silent)
        #expect(m.rta.levels.isEmpty)
        #expect(m.coaching.isEmpty)
        #expect(m.problemMarkers.isEmpty)
        #expect(m.overallDb == nil)
    }

    @Test func returningToTheForegroundResumesListening() async {
        let m = model()
        await m.appear()
        m.enterBackground()
        await m.enterForeground()
        #expect(m.state == .live)
        #expect(source.startCount == 2)
    }

    @Test func foregroundWhileAlreadyLiveDoesNotRestart() async {
        let m = model()
        await m.appear()
        await m.enterForeground()
        #expect(source.startCount == 1)
    }

    @Test func foregroundBeforeTheScreenAppearsDoesNotListen() async {
        let m = model()
        await m.enterForeground()
        #expect(m.state == .idle)
        #expect(source.startCount == 0)
    }

    @Test func foregroundRetriesAfterMicAccessIsGrantedInSettings() async {
        let permission = SwitchablePermission(granted: false)
        let m = model(permission: permission)
        await m.appear()
        #expect(m.state == .micDenied)
        // The user leaves for Settings, turns the mic on, and comes back.
        m.enterBackground()
        permission.granted = true
        await m.enterForeground()
        #expect(m.state == .live)
    }

    @Test func backgroundingDuringThePermissionPromptDoesNotStartTheMic() async {
        var m: AnalyzeModel!
        m = model(permission: GatedPermission { m.enterBackground() })
        await m.appear()
        #expect(m.state == .idle)
        #expect(source.startCount == 0)
    }

    @Test func disappearingStopsListeningAndStaysStoppedOnForeground() async {
        let m = model()
        await m.appear()
        m.disappear()
        #expect(m.state == .idle)
        #expect(source.stopCount == 1)
        m.enterBackground()
        await m.enterForeground()
        #expect(source.startCount == 1)
    }

    @Test func terminateReleasesTheMic() async {
        let m = model()
        await m.appear()
        m.terminate()
        #expect(m.state == .idle)
        #expect(!source.isRunning)
    }

    @Test func haltingWhenIdleDoesNotTouchTheSource() {
        let m = model()
        m.enterBackground()
        m.terminate()
        #expect(source.stopCount == 0)
    }

    // MARK: Readings

    @Test func readingsUpdateBandsRTAAndCoaching() async throws {
        let m = model()
        await m.appear()
        clock.advance(4)
        let bands = levels([.lowMid: -22])
        try deliver(reading(bands, rta: [-40, -50]))
        #expect(m.bandLevels == bands)
        #expect(m.rta.levels == [-40, -50])
        #expect(m.coaching.isEmpty, "one reading is not a sustained problem (#1715)")
        try sustain(bands)
        let event = try #require(m.coaching.first)
        #expect(event.band == .lowMid)
        #expect(event.sessionTime > 4 + CoachingStabilizer.enterDwellSeconds - 0.1)
    }

    /// Coaching text redrawn at the 20 Hz meter rate is unreadable; the stack
    /// refreshes at most once per coachingRefreshSeconds.
    @Test func coachingRefreshesAtAReadablePace() async throws {
        let m = model()
        await m.appear()
        try sustain(levels([.lowMid: -22]))
        let first = m.coaching
        #expect(first.map(\.band) == [.lowMid])
        clock.advance(AnalyzeModel.coachingRefreshSeconds / 2)
        try deliver(reading(levels([.lowMid: -10])))
        #expect(m.coaching == first, "too soon — keep the current stack")
        #expect(m.bandLevels[.lowMid] == -10, "the meter still updates every reading")
        clock.advance(AnalyzeModel.coachingRefreshSeconds)
        try deliver(reading(levels([.lowMid: -10])))
        #expect(m.coaching.map(\.band) == [.lowMid])
        #expect(m.coaching != first, "the card's number updates on the next refresh")
    }

    /// #1700: when a visible tip overtakes another, the coach re-sorts by
    /// magnitude but the stack keeps each card where it was; only its number
    /// changes. Problem markers follow the same card order.
    @Test func coachingCardsKeepTheirOrderAcrossRefreshes() async throws {
        let m = model()
        await m.appear()
        let first = levels([.bass: -18, .presence: -22])
        try sustain(first)
        let shownFirst = m.coaching.compactMap(\.band)
        #expect(shownFirst == [.bass, .presence])

        let second = levels([.bass: -21, .presence: -12])
        let coachOrder = BandDeviationCoach(ideal: m.coachingCurve)
            .events(for: second, sessionTime: 0).compactMap(\.band)
        try #require(coachOrder.prefix(2) == [.presence, .bass], "precondition: the raw coach re-sorts Presence first")
        try sustain(second, seconds: 15)

        let shownSecond = m.coaching.compactMap(\.band)
        #expect(shownSecond == [.bass, .presence], "cards hold position")
        let magnitudes = m.problemMarkers.map(\.severityDb)
        #expect(magnitudes[1] > magnitudes[0], "Presence is now worse, and its number updated in place")
        #expect(m.problemMarkers.map(\.band) == shownSecond, "markers follow the card order")
        #expect(m.coaching.count <= BandDeviationCoach.maxEvents)
    }

    @Test func listeningAgainStartsTheCardOrderFresh() async throws {
        let m = model()
        await m.appear()
        try sustain(levels([.bass: -18, .presence: -22]))
        #expect(!m.coaching.isEmpty)
        m.disappear()
        #expect(m.coaching.isEmpty)
        await m.appear()
        let second = levels([.bass: -21, .presence: -12])
        try sustain(second)
        let coachOrder = BandDeviationCoach(ideal: m.coachingCurve)
            .events(for: second, sessionTime: 0).compactMap(\.band)
        #expect(m.coaching.compactMap(\.band) == [.presence, .bass], "no order remembered from the last session")
        #expect(coachOrder.prefix(2) == [.presence, .bass], "the fresh order is the coach's severity order")
    }

    @Test func theRTADisplayAgesByWallClock() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(.silent, rta: [-20]))
        clock.advance(0.1)
        try deliver(reading(.silent, rta: [-90]))
        // #1707: exponential release in the power domain with tau 0.4 s.
        let tau = RTABallistics.medium.releaseTauSeconds
        let expected = 10 * log10(pow(10, -9.0) + (pow(10, -2.0) - pow(10, -9.0)) * exp(-0.1 / tau))
        // Date arithmetic at epoch 1000 s keeps ~1e-7 s of precision.
        #expect(abs(m.rta.levels[0] - expected) < 1e-4)
    }

    /// AC5 (#1707): coaching never reads display-smoothed values, so the
    /// RTA's ballistics can change without moving a single card or marker.
    @Test func coachingIsUnchangedByTheRTABallistics() async throws {
        let otherSource = FakeSource()
        let medium = model()
        let slow = AnalyzeModel(permission: FakePermission(granted: true), source: otherSource, now: { [clock] in clock.now })
        slow.rtaBallistics = .slow
        await medium.appear()
        await slow.appear()
        let sendToSlow = try #require(otherSource.onReading)
        let offTarget = levels([.bass: -21, .presence: -12])
        let frameCount = Int((Self.pastTheEnterDwell / 0.05).rounded())
        for i in 0..<frameCount {
            clock.advance(0.05)
            let r = reading(offTarget, rta: i.isMultiple(of: 3) ? [-20, -60] : [-60, -20])
            try deliver(r)
            sendToSlow(r)
            #expect(content(medium.coaching) == content(slow.coaching))
            #expect(medium.problemMarkers == slow.problemMarkers)
            #expect(medium.isMixOnTarget == slow.isMixOnTarget)
        }
        #expect(!medium.coaching.isEmpty, "the run really coaches")
        #expect(medium.rta.levels != slow.rta.levels, "while the bars themselves differ")
    }

    @Test func theRTAUsesTheChosenBallistics() async throws {
        let m = model()
        #expect(m.rtaBallistics == .medium, "Medium is the default")
        m.rtaBallistics = .slow
        await m.appear()
        try deliver(reading(.silent, rta: [-60]))
        clock.advance(0.25)
        try deliver(reading(.silent, rta: [-20]))
        let risen = (pow(10, m.rta.levels[0] / 10) - pow(10, -6.0)) / (pow(10, -2.0) - pow(10, -6.0))
        #expect(abs(risen - (1 - exp(-1))) < 1e-4, "slow attack tau 0.25 s")
        #expect(m.rta.ballistics == .slow)
    }

    @Test func theRawRTAFrameAndTargetOffsetsAreExposedForRenderRateStepping() async throws {
        let m = model()
        #expect(m.rtaInput.isEmpty)
        await m.appear()
        try deliver(reading(.silent, rta: [-20, -30]))
        clock.advance(0.05)
        try deliver(reading(.silent, rta: [-70, -30]))
        #expect(m.rtaInput == [-70, -30], "the latest raw frame, unsmoothed")
        #expect(m.rtaTargetOffsets == RTATarget.resample(m.target, onto: m.rtaLayout))
        m.disappear()
        #expect(m.rtaInput.isEmpty, "halt clears the raw frame")
    }

    @Test func readingsPublishTheOverallLevel() async throws {
        let m = model()
        await m.appear()
        try deliver(SpectrumReading(bands: .silent, rtaDb: [-40], overallDb: -18.43))
        #expect(m.overallDb == -18.43, "dBFS is unchanged")
        #expect(abs(m.overallSplDb! - 84.57) < 1e-9)
        #expect(m.overallLevelText == "84.6 dB")
        #expect(m.overallLevelNumberText == "84.6")
        clock.advance(AnalyzeModel.coachingRefreshSeconds / 2)
        try deliver(SpectrumReading(bands: .silent, rtaDb: [-40], overallDb: -30.1))
        #expect(m.overallDb == -30.1, "the meter updates every reading, not just at the coaching cadence")
    }

    @Test func aSilentReadingShowsADash() async throws {
        let m = model()
        await m.appear()
        try deliver(SpectrumReading(bands: .silent, rtaDb: [-40], overallDb: AnalyzeModel.overallLevelFloorDb))
        #expect(m.overallDb == nil)
        #expect(m.overallSplDb == nil)
        #expect(m.overallLevelText == "—")
        #expect(m.overallLevelNumberText == "—")
    }

    @Test func coachingNeverMentionsSplOrDbfs() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: worship)
        await m.appear()
        try sustain(levels(base: -30))
        #expect(!m.coaching.isEmpty)
        for event in m.coaching {
            #expect(!event.message.contains("SPL"))
            #expect(!event.message.contains("dBFS"))
        }
    }

    // MARK: RTA target overlay

    @Test func rtaTargetDbIsNilBeforeListeningAndAfterDisappear() async throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: curve)
        #expect(m.rtaTargetDb == nil)
        await m.appear()
        try deliver(reading(.silent, rta: Array(repeating: -40, count: RTALayout.standard.bands.count)))
        #expect(m.rtaTargetDb != nil)
        m.disappear()
        #expect(m.rtaTargetDb == nil)
    }

    @Test func rtaTargetDbTracksTheMeasuredMeanAndShiftsWithGain() async throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: curve)
        await m.appear()
        let count = RTALayout.standard.bands.count
        let measured = (0..<count).map { -60.0 + Double($0 % 20) }
        try deliver(reading(.silent, rta: measured))
        let target = try #require(m.rtaTargetDb)
        #expect(target.count == count)
        let measuredMean = measured.reduce(0, +) / Double(count)
        let targetMean = target.reduce(0, +) / Double(count)
        #expect(abs(targetMean - measuredMean) < 1e-6)

        // #1707: levels rise with the 0.05 s attack tau, so a uniform +10 dB
        // gain held for 1 s (20 taus) has fully arrived.
        let shifted = measured.map { $0 + 10 }
        for _ in 0..<20 {
            clock.advance(0.05)
            try deliver(reading(.silent, rta: shifted))
        }
        let shiftedTarget = try #require(m.rtaTargetDb)
        for (before, after) in zip(target, shiftedTarget) {
            #expect(abs(after - (before + 10)) < 1e-6)
        }
    }

    /// #1726: the flat target is drawn with the band-sum bandwidth
    /// correction, so it rises 3 dB per octave around the measured mean.
    @Test func defaultFlatTargetIsTheBandwidthCorrectionAroundTheMeasuredMean() async throws {
        let m = model()
        await m.appear()
        let bands = RTALayout.standard.bands
        let count = bands.count
        let measured = (0..<count).map { -50.0 + Double($0 % 15) }
        try deliver(reading(.silent, rta: measured))
        let target = try #require(m.rtaTargetDb)
        let mean = measured.reduce(0, +) / Double(count)
        let corrections = bands.map { RTATarget.bandwidthCorrectionDb(atHz: $0.centerHz) }
        let correctionMean = corrections.reduce(0, +) / Double(count)
        for (value, correction) in zip(target, corrections) {
            #expect(abs(value - (mean + correction - correctionMean)) < 1e-6)
        }
    }

    /// #1726 end to end: pink-noise bars (equal power per 1/6-octave band)
    /// against a pink-PSD target draw a flat, parallel line.
    @Test func aPinkTargetDrawsFlatOverPinkNoiseBars() async throws {
        let pink = IdealCurve(
            id: "pink", label: "Pink", description: "",
            freqs: IdealCurve.gridFreqs,
            dbOffsets: IdealCurve.gridFreqs.map { -10 * log10($0 / 1000) }
        )
        let m = model(target: pink)
        await m.appear()
        let bars = Array(repeating: -45.0, count: RTALayout.standard.bands.count)
        try deliver(reading(.silent, rta: bars))
        let target = try #require(m.rtaTargetDb)
        for (value, bar) in zip(target, bars) {
            #expect(abs(value - bar) <= 0.5)
        }
    }

    @Test func targetLegendTextUsesTheModelsTargetLabelAndAutoFlag() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        #expect(model(target: curve, targetIsAuto: true).targetLegendText == "Target · Worship – Classic (auto)")
        #expect(model(target: curve, targetIsAuto: false).targetLegendText == "Target · Worship – Classic")
    }

    // MARK: Coaching follows the active curve

    @Test func coachUsesTheInjectedTargetNotAHiddenFlat() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        #expect(model(target: worship).coachingCurve == worship)
        #expect(model().coachingCurve == .flat)
    }

    @Test func coachingFollowsTheActiveCurve() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let flatModel = model()
        let worshipModel = model(target: worship)

        await flatModel.appear()
        try deliver(reading(levels(base: -30)))
        #expect(flatModel.coaching.isEmpty)
        #expect(flatModel.isMixOnTarget)
        #expect(flatModel.coachingPlaceholder == CoachingStabilizer.onTargetMessage)

        await worshipModel.appear()
        try sustain(levels(base: -30))
        #expect(worshipModel.coaching.count == BandDeviationCoach.maxEvents)
        #expect(worshipModel.coaching.first?.message.contains("gentle cut") == true)
    }

    // MARK: Program mode (speech/music) (#1690)

    /// Delivers `count` readings carrying `features`, advancing the fake
    /// clock by `step` seconds before each one — the live cadence the
    /// tracker's dwell timing is measured against.
    private func deliverSustained(_ features: ProgramFeatures, bands: BandLevels, count: Int, step: Double = 0.05) throws {
        for _ in 0..<count {
            clock.advance(step)
            try deliver(reading(bands, programFeatures: features))
        }
    }

    @Test func sustainedSpeechOverAPadSwitchesTheAutoTargetToSpeechPodcast() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let speechPodcast = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.speechPodcastId)
        let m = model(target: worship, targetIsAuto: true)
        await m.appear()

        let shiftedTargets = Dictionary(uniqueKeysWithValues: Band.allCases.map { ($0, speechPodcast.bandTargets[$0]! - 40) })
        let bands = levels(shiftedTargets)

        try deliverSustained(speechOverAPadFeatures(), bands: bands, count: 110) // 5.5 s: short of the 6 s evidence
        #expect(m.targetLegendText == "Target · Worship – Classic (auto)")
        #expect(m.programMode == .music)

        try deliverSustained(speechOverAPadFeatures(), bands: bands, count: 20) // 6.5 s total: past the 6 s evidence
        #expect(m.programMode == .speech)
        #expect(m.programModeChipText == "Speech")
        #expect(m.targetLegendText == "Target · Speech – Clear Voice (auto)")
        #expect(m.coachingCurve.id == IdealCurveLibrary.speechPodcastId)
        for marker in m.problemMarkers where marker.band == .presence || marker.band == .brilliance {
            #expect(marker.direction != .underTarget, "bands are level-matched to the speech-podcast target, so no under-target flag")
        }
    }

    @Test func sustainedMusicSwitchesTheAutoTargetBackToWorshipService() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: worship, targetIsAuto: true)
        await m.appear()

        try deliverSustained(speechOverAPadFeatures(), bands: levels(base: -40), count: 130) // 6.5 s of speech
        #expect(m.programMode == .speech)
        #expect(m.target.id == IdealCurveLibrary.speechPodcastId)

        // Music: past the 6 s evidence, and past the 10 s minimum hold since
        // the switch into speech (#1702).
        try deliverSustained(musicFeatures(), bands: levels(base: -30), count: 210) // 10.5 s of music
        #expect(m.programMode == .music)
        #expect(m.programModeChipText == "Music")
        #expect(m.target.id == IdealCurveLibrary.worshipServiceId)
        #expect(m.targetLegendText == "Target · Worship – Classic (auto)")
    }

    /// #1725: the app seeds Analyze with `IdealCurveLibrary.liveDefault()`, so
    /// Music auto is the room-mic reference; Speech auto stays speech-podcast,
    /// and sustained music brings the target back to worship-room.
    @Test func theLiveDefaultMusicTargetIsWorshipRoomAndSpeechStaysSpeechPodcast() async throws {
        let m = model(target: IdealCurveLibrary.liveDefault(), targetIsAuto: true)
        await m.appear()
        #expect(m.target.id == IdealCurveLibrary.worshipRoomId)
        #expect(m.targetLegendText == "Target · Worship – Full Band (auto)")

        try deliverSustained(speechOverAPadFeatures(), bands: levels(base: -40), count: 130) // 6.5 s of speech
        #expect(m.programMode == .speech)
        #expect(m.target.id == IdealCurveLibrary.speechPodcastId)
        #expect(m.targetLegendText == "Target · Speech – Clear Voice (auto)")

        try deliverSustained(musicFeatures(), bands: levels(base: -30), count: 210) // 10.5 s of music
        #expect(m.programMode == .music)
        #expect(m.target.id == IdealCurveLibrary.worshipRoomId)
        #expect(m.targetLegendText == "Target · Worship – Full Band (auto)")
    }

    @Test func aUserChosenTargetIsNeverSwitchedBySpeech() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: worship, targetIsAuto: false)
        await m.appear()

        try deliverSustained(speechOverAPadFeatures(), bands: levels(base: -40), count: 130)
        #expect(m.programMode == .speech, "the chip still shows the detected mode")
        #expect(m.target == worship, "a user-chosen target is never switched")
        #expect(m.coachingCurve == worship)
        #expect(m.targetLegendText == "Target · Worship – Classic")
    }

    @Test func noAutoSwitchWhileEditingTheTarget() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: worship, targetIsAuto: true)
        await m.appear()
        m.beginTargetEdit()

        try deliverSustained(speechOverAPadFeatures(), bands: levels(base: -40), count: 130)
        #expect(m.programMode == .speech, "the chip still shows the detected mode")
        #expect(m.target == worship, "the draft never auto-switches while editing")
        #expect(m.coachingCurve == worship)
        #expect(m.targetLegendText == "Target · Worship – Classic (auto)")

        m.cancelTargetEdit()
        clock.advance(0.05)
        try deliver(reading(levels(base: -40), programFeatures: speechOverAPadFeatures()))
        #expect(m.target.id == IdealCurveLibrary.speechPodcastId, "resolves to the already-detected mode on the next reading")
    }

    @Test func aSpeechCurveLoadFailureKeepsTheMusicTarget() async throws {
        struct LoaderFailure: Error {}
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: worship, targetIsAuto: true, presetLoader: { _ in throw LoaderFailure() })
        await m.appear()

        try deliverSustained(speechOverAPadFeatures(), bands: levels(base: -40), count: 130)
        #expect(m.programMode == .speech)
        #expect(m.target == worship, "a load failure keeps the music target rather than crashing")
        #expect(m.targetLegendText == "Target · Worship – Classic (auto)")
    }

    @Test func readingsWithoutFeaturesNeverChangeTheMode() async throws {
        let m = model()
        await m.appear()
        for _ in 0..<40 {
            clock.advance(0.05)
            try deliver(reading(levels(base: -30)))
        }
        #expect(m.programMode == .music)
        #expect(m.target == .flat)
    }

    @Test func haltResetsTheModeAndAutoTarget() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: worship, targetIsAuto: true)
        await m.appear()

        try deliverSustained(speechOverAPadFeatures(), bands: levels(base: -40), count: 130)
        #expect(m.programMode == .speech)
        #expect(m.target.id == IdealCurveLibrary.speechPodcastId)

        m.disappear()
        #expect(m.programMode == .music)
        #expect(m.target.id == IdealCurveLibrary.worshipServiceId)
        #expect(m.targetLegendText == "Target · Worship – Classic (auto)")
    }

    @Test func programModeAccessibilityLabelReflectsAutoVsUserTargetAndEditing() {
        let auto = model(target: .flat, targetIsAuto: true)
        #expect(auto.programModeAccessibilityLabel == "Program: music, target switched automatically")
        #expect(auto.programModeChipText == "Music")

        let userChosen = model(target: .flat, targetIsAuto: false)
        #expect(userChosen.programModeAccessibilityLabel == "Program: music")

        let editingAuto = model(target: .flat, targetIsAuto: true)
        editingAuto.beginTargetEdit()
        #expect(editingAuto.programModeAccessibilityLabel == "Program: music", "no auto switch while editing, so no claim of one")
    }

    @Test func showsProgramModeChipOnlyWhenLive() async {
        let m = model()
        #expect(!m.showsProgramModeChip)
        await m.appear()
        #expect(m.showsProgramModeChip)
        m.disappear()
        #expect(!m.showsProgramModeChip)
    }

    // MARK: Problem markers

    @Test func problemMarkersMatchTheCoachOnTheSameReading() async throws {
        let m = model()
        await m.appear()
        let bands = levels([.lowMid: -22])
        try sustain(bands)
        let expected = BandDeviationCoach(ideal: m.coachingCurve).problemMarkers(for: bands)
        #expect(m.problemMarkers == expected)
        #expect(m.problemMarkers.map(\.band) == m.coaching.compactMap(\.band))
    }

    @Test func aSilentReadingGivesNoProblemMarkers() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(.silent))
        #expect(m.problemMarkers.isEmpty)
    }

    @Test func problemMarkersDoNotChangeWithinTheCoachingGate() async throws {
        let m = model()
        await m.appear()
        try sustain(levels([.lowMid: -22]))
        let first = m.problemMarkers
        #expect(first.map(\.band) == [.lowMid])
        clock.advance(AnalyzeModel.coachingRefreshSeconds / 2)
        try deliver(reading(levels([.lowMid: -26])))
        #expect(m.problemMarkers == first, "too soon — keep the current markers")
        clock.advance(AnalyzeModel.coachingRefreshSeconds)
        try deliver(reading(levels([.lowMid: -26])))
        #expect(m.problemMarkers.map(\.band) == [.lowMid], "the tip holds its minimum time")
        #expect(m.problemMarkers != first, "its severity updates on the next refresh")
    }

    @Test func disappearingClearsProblemMarkers() async throws {
        let m = model()
        await m.appear()
        try sustain(levels([.lowMid: -22]))
        #expect(!m.problemMarkers.isEmpty)
        m.disappear()
        #expect(m.problemMarkers.isEmpty)
    }

    @Test func backgroundingClearsProblemMarkers() async throws {
        let m = model()
        await m.appear()
        try sustain(levels([.lowMid: -22]))
        #expect(!m.problemMarkers.isEmpty)
        m.enterBackground()
        #expect(m.problemMarkers.isEmpty)
    }

    /// AnalyzeLayout hides the pulses while editing (#1562) — the frozen
    /// markers themselves (ADR-0156) are untouched, so they come back
    /// unchanged on Done/Cancel and the peek re-enables.
    @Test func editModeHidesProblemMarkersViaAnalyzeLayout() async throws {
        let m = model()
        await m.appear()
        try sustain(levels([.lowMid: -22]))
        let before = m.problemMarkers
        #expect(!before.isEmpty)
        #expect(AnalyzeLayout.landscape.showsProblemMarkers(isEditingTarget: m.isEditingTarget))

        m.beginTargetEdit()
        #expect(!AnalyzeLayout.landscape.showsProblemMarkers(isEditingTarget: m.isEditingTarget))
        #expect(m.problemMarkers == before)
        #expect(!AnalyzeLayout.coachingPeekEnabled(isEditingTarget: m.isEditingTarget))

        m.commitTargetEdit()
        #expect(AnalyzeLayout.landscape.showsProblemMarkers(isEditingTarget: m.isEditingTarget))
        #expect(AnalyzeLayout.coachingPeekEnabled(isEditingTarget: m.isEditingTarget))
        #expect(m.problemMarkers == before)

        m.beginTargetEdit()
        #expect(!AnalyzeLayout.landscape.showsProblemMarkers(isEditingTarget: m.isEditingTarget))
        m.cancelTargetEdit()
        #expect(AnalyzeLayout.landscape.showsProblemMarkers(isEditingTarget: m.isEditingTarget))
        #expect(AnalyzeLayout.coachingPeekEnabled(isEditingTarget: m.isEditingTarget))
        #expect(m.problemMarkers == before)
    }

    // MARK: Target curve editing (#1558)

    @Test func beginTargetEditEntersEditModeWithoutChangingTheTarget() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: curve, targetIsAuto: true)
        m.beginTargetEdit()
        #expect(m.isEditingTarget)
        #expect(m.target == curve)
        #expect(m.targetLegendText == "Target · Worship – Classic (auto)")
    }

    @Test func cancelRestoresThePreEditCurveAfterADraftChange() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        m.updateTargetDraft(worship)
        #expect(m.target == worship)
        #expect(m.coachingCurve == .flat)
        m.cancelTargetEdit()
        #expect(!m.isEditingTarget)
        #expect(m.target == .flat)
        #expect(m.coachingCurve == .flat)
        #expect(m.targetLegendText == "Target · Flat (auto)")
    }

    @Test func commitKeepsTheDraftAndClearsAuto() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        m.updateTargetDraft(worship)
        m.commitTargetEdit()
        #expect(!m.isEditingTarget)
        #expect(m.target == worship)
        #expect(!m.targetIsAuto)
        #expect(m.targetLegendText == "Target · Worship – Classic")
    }

    @Test func commitWithNoChangeLeavesTheTargetAndAutoFlagUnchanged() {
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        m.commitTargetEdit()
        #expect(!m.isEditingTarget)
        #expect(m.target == .flat)
        #expect(m.targetIsAuto)
        #expect(m.targetLegendText == "Target · Flat (auto)")
    }

    @Test func editTransitionsAreNoOpsWhenNotEditing() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: .flat, targetIsAuto: true)
        m.updateTargetDraft(worship)
        m.cancelTargetEdit()
        m.commitTargetEdit()
        #expect(m.target == .flat)
        #expect(m.targetIsAuto)
        #expect(!m.isEditingTarget)
    }

    // MARK: Coaching freeze during edits (#1561)

    @Test func coachingFreezesOnEditEntry() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(levels([.lowMid: -22])))
        let coachingBefore = m.coaching
        let markersBefore = m.problemMarkers
        m.beginTargetEdit()
        #expect(m.isCoachingFrozen)
        clock.advance(AnalyzeModel.coachingRefreshSeconds * 2)
        try deliver(reading(levels([.presence: -20])))
        #expect(m.coaching == coachingBefore)
        #expect(m.problemMarkers == markersBefore)
    }

    @Test func draftUpdatesNeverReachTheCoach() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        m.updateTargetDraft(worship)
        #expect(m.target == worship)
        #expect(m.coachingCurve == .flat)

        let live = try await liveModelWithFullReading(target: .flat)
        live.beginTargetEdit()
        live.beginTargetHandleDrag(3)
        live.dragTargetHandle(translationFraction: 0.1)
        #expect(live.coachingCurve == .flat)
    }

    @Test func doneResumesCoachingAgainstTheEditedCurve() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
        m.commitTargetEdit()
        #expect(!m.isCoachingFrozen)
        #expect(m.coachingCurve == m.target)
        #expect(m.target.id == TargetCurveHandles.customId)

        let bands = levels([.presence: -18])
        try sustain(bands)
        let expected = settledCoaching(BandDeviationCoach(ideal: m.target), bands)
        #expect(!expected.events.isEmpty)
        #expect(content(m.coaching) == content(expected.events))
        #expect(m.problemMarkers == expected.markers)
    }

    @Test func cancelResumesCoachingAgainstTheOriginalCurve() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
        m.cancelTargetEdit()
        #expect(!m.isCoachingFrozen)
        #expect(m.coachingCurve == .flat)

        let bands = levels([.presence: -18])
        try sustain(bands)
        let expected = settledCoaching(BandDeviationCoach(ideal: .flat), bands)
        #expect(!expected.events.isEmpty)
        #expect(content(m.coaching) == content(expected.events))
    }

    @Test func doneRecordsTheSessionCustomTarget() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        #expect(m.sessionCustomTarget == nil)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
        m.commitTargetEdit()
        let custom = try #require(m.sessionCustomTarget)
        #expect(custom == m.target)

        m.beginTargetEdit()
        #expect(m.selectTargetPreset(.flat) == true)
        m.commitTargetEdit()
        #expect(m.sessionCustomTarget == custom)
    }

    @Test func cancelNeverRecordsASessionCustomTarget() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
        m.cancelTargetEdit()
        #expect(m.sessionCustomTarget == nil)
    }

    @Test func draftFollowsIntoTheLiveRTATarget() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: .flat, targetIsAuto: true)
        await m.appear()
        let count = RTALayout.standard.bands.count
        let measured = (0..<count).map { -55.0 + Double($0 % 12) }

        m.beginTargetEdit()
        m.updateTargetDraft(worship)
        try deliver(reading(.silent, rta: measured))
        let target = try #require(m.rtaTargetDb)

        let expectedModel = model(target: worship)
        await expectedModel.appear()
        try deliver(reading(.silent, rta: measured))
        let expected = try #require(expectedModel.rtaTargetDb)

        #expect(target.count == expected.count)
        for (actual, want) in zip(target, expected) {
            #expect(abs(actual - want) < 1e-6)
        }
    }

    @Test func editCallsNeverStartOrStopTheSource() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: .flat, targetIsAuto: true)
        await m.appear()
        let startCount = source.startCount
        let stopCount = source.stopCount

        m.beginTargetEdit()
        m.updateTargetDraft(worship)
        #expect(source.startCount == startCount)
        #expect(source.stopCount == stopCount)
        m.commitTargetEdit()
        #expect(source.startCount == startCount)
        #expect(source.stopCount == stopCount)
    }

    @Test func editModeSurvivesDisappear() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: .flat, targetIsAuto: true)
        await m.appear()
        m.beginTargetEdit()
        m.updateTargetDraft(worship)
        m.disappear()
        #expect(m.isEditingTarget)
        #expect(m.target == worship)
    }

    // MARK: Target curve handle drags (#1559)

    private func liveModelWithFullReading(target: IdealCurve = .flat) async throws -> AnalyzeModel {
        let m = model(target: target, targetIsAuto: true)
        await m.appear()
        let count = RTALayout.standard.bands.count
        try deliver(reading(.silent, rta: Array(repeating: -50.0, count: count)))
        return m
    }

    @Test func rtaTargetHandlesIsEmptyWhenNotEditing() async throws {
        let m = try await liveModelWithFullReading()
        #expect(m.rtaTargetHandles.isEmpty)
    }

    @Test func rtaTargetHandlesIsEmptyWhenEditingButNotLive() throws {
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        #expect(m.rtaTargetHandles.isEmpty)
    }

    @Test func rtaTargetHandlesHasTenEntriesMatchingRtaTargetDbWhenEditingAndLive() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = try await liveModelWithFullReading(target: worship)
        m.beginTargetEdit()
        let handles = m.rtaTargetHandles
        #expect(handles.count == TargetCurveHandles.handleCount)
        let shift = try #require(RTATarget.levelShift(offsets: RTATarget.resample(worship, onto: RTALayout.standard), measured: m.rta.levels))
        for entry in handles {
            let corrected = RTATarget.displayOffsetDb(entry.handle.offsetDb, atHz: entry.handle.hz)
            #expect(abs(entry.displayDb - (corrected + shift)) < 1e-6, "handles sit on the bandwidth-corrected line (#1726)")
        }
    }

    @Test func beginTargetHandleDragReturnsFalseWhenNotEditing() async throws {
        let m = try await liveModelWithFullReading()
        #expect(m.beginTargetHandleDrag(0) == false)
        #expect(m.activeTargetHandle == nil)
    }

    @Test func beginTargetHandleDragReturnsFalseForAnOutOfRangeHandle() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        #expect(m.beginTargetHandleDrag(TargetCurveHandles.handleCount) == false)
        #expect(m.beginTargetHandleDrag(-1) == false)
        #expect(m.activeTargetHandle == nil)
    }

    @Test func beginTargetHandleDragReturnsFalseWithNoReadingYet() throws {
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        #expect(m.beginTargetHandleDrag(0) == false)
    }

    @Test func beginTargetHandleDragReturnsTrueAndSetsTheActiveHandleWhenEditingAndLive() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        #expect(m.beginTargetHandleDrag(2) == true)
        #expect(m.activeTargetHandle == 2)
    }

    @Test func aSecondBeginReturnsFalseAndKeepsTheFirstHandle() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        #expect(m.beginTargetHandleDrag(2) == true)
        #expect(m.beginTargetHandleDrag(5) == false)
        #expect(m.activeTargetHandle == 2)
    }

    @Test func dragTargetHandleMovesTheDraft() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        let fraction = 0.1
        m.dragTargetHandle(translationFraction: fraction)
        let gridIndex = TargetCurveHandles.gridIndices[3]
        let expected = 0 + fraction * m.rtaScale.spanDb
        #expect(abs(m.target.dbOffsets[gridIndex] - expected) < 1e-6)
        #expect(m.target.id == TargetCurveHandles.customId)
    }

    @Test func rtaTargetDbUsesTheFrozenShiftDuringADrag() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        let shiftBeforeDrag = try #require(RTATarget.levelShift(offsets: RTATarget.resample(.flat, onto: RTALayout.standard), measured: m.rta.levels))
        let fraction = 0.1
        m.dragTargetHandle(translationFraction: fraction)

        let expectedOffset = fraction * m.rtaScale.spanDb
        let handle3 = try #require(m.rtaTargetHandles.first { $0.handle.ordinal == 3 })
        let handleDisplayDb = handle3.displayDb
        let correction = RTATarget.bandwidthCorrectionDb(atHz: handle3.handle.hz)
        #expect(abs(handleDisplayDb - (expectedOffset + correction + shiftBeforeDrag)) < 1e-6)

        // Delivering a new reading mid-drag does not move the frozen shift.
        let count = RTALayout.standard.bands.count
        try deliver(reading(.silent, rta: Array(repeating: -90.0, count: count)))
        let handleDisplayDbAfterNewReading = try #require(m.rtaTargetHandles.first { $0.handle.ordinal == 3 }?.displayDb)
        #expect(abs(handleDisplayDbAfterNewReading - handleDisplayDb) < 1e-6)
    }

    @Test func aDragFarPastTheTopOrBottomClampsTheDisplayedDb() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 1000)
        let handles = m.rtaTargetHandles
        let entry = try #require(handles.first { $0.handle.ordinal == 3 })
        #expect(abs(entry.displayDb - m.rtaScale.ceilingDb) < 1e-6)

        m.dragTargetHandle(translationFraction: -1000)
        let loweredEntry = try #require(m.rtaTargetHandles.first { $0.handle.ordinal == 3 })
        #expect(abs(loweredEntry.displayDb - m.rtaScale.floorDb) < 1e-6)
    }

    /// #1726 round trip: a +2 dB drag on the handle nearest 4 kHz moves the
    /// drawn handle by 2 dB and stores exactly +2 dB at that grid point, with
    /// no bandwidth term baked into the saved dbOffsets.
    @Test func aPlusTwoDbDragAtFourKilohertzStoresPlusTwoDbUncorrected() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        let handles = m.rtaTargetHandles
        let nearest = try #require(handles.min { abs(log2($0.handle.hz / 4000)) < abs(log2($1.handle.hz / 4000)) })
        #expect(abs(log2(nearest.handle.hz / 4000)) < 0.5, "a handle sits within half an octave of 4 kHz")
        let ordinal = nearest.handle.ordinal
        let gridIndex = TargetCurveHandles.gridIndices[ordinal]
        let storedBefore = m.target.dbOffsets[gridIndex]

        #expect(m.beginTargetHandleDrag(ordinal))
        m.dragTargetHandle(translationFraction: 2 / m.rtaScale.spanDb)
        let moved = try #require(m.rtaTargetHandles.first { $0.handle.ordinal == ordinal })
        #expect(abs(moved.displayDb - (nearest.displayDb + 2)) < 1e-6)
        m.endTargetHandleDrag()
        m.commitTargetEdit()

        #expect(abs(m.target.dbOffsets[gridIndex] - (storedBefore + 2)) < 1e-9)
        #expect(abs(m.target.dbOffsets[gridIndex] - 2) < 1e-9, "flat start: exactly +2 dB stored, no 10*log10(fc/1k) term")
        #expect(m.target.dbOffsets.first == 0 && m.target.dbOffsets.last == 0, "untouched grid points keep their stored offsets")
    }

    @Test func dragTargetHandleWithoutABeginIsANoOp() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        let before = m.target
        m.dragTargetHandle(translationFraction: 0.5)
        #expect(m.target == before)
    }

    @Test func endCancelAndCommitEachClearTheActiveHandle() async throws {
        let m = try await liveModelWithFullReading()
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.endTargetHandleDrag()
        #expect(m.activeTargetHandle == nil)

        m.beginTargetHandleDrag(3)
        m.cancelTargetEdit()
        #expect(m.activeTargetHandle == nil)

        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.commitTargetEdit()
        #expect(m.activeTargetHandle == nil)
    }

    @Test func cancelAfterADragRestoresTheOriginalCurveAndAutoFlag() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
        m.cancelTargetEdit()
        #expect(m.target == .flat)
        #expect(m.targetIsAuto)
        #expect(!m.isEditingTarget)
    }

    @Test func commitAfterADragLeavesANonAutoCustomTarget() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
        m.commitTargetEdit()
        #expect(!m.isEditingTarget)
        #expect(!m.targetIsAuto)
        #expect(m.target.label == TargetCurveHandles.customLabel)
    }

    @Test func coachingCurveHoldsThePreEditCurveDuringADrag() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
        #expect(m.coachingCurve == .flat)
        m.commitTargetEdit()
        #expect(m.coachingCurve == m.target)
    }

    // MARK: presets (#1560)

    @Test(arguments: TargetCurvePreset.all)
    func selectingAPresetResetsTheDraftAfterDrags(preset: TargetCurvePreset) async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)

        #expect(m.selectTargetPreset(preset) == true)

        let expected = try IdealCurveLibrary.builtIn(id: preset.id)
        #expect(m.target == expected)
        #expect(m.coachingCurve == .flat)
        #expect(m.activeTargetPresetId == preset.id)
    }

    @Test func selectTargetPresetIsANoOpWhenNotEditing() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        #expect(m.selectTargetPreset(.worshipService) == false)
        #expect(m.target == .flat)
        #expect(!m.isEditingTarget)
    }

    @Test func selectTargetPresetEndsAnActiveDrag() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        #expect(m.activeTargetHandle == 3)

        #expect(m.selectTargetPreset(.worshipService) == true)
        #expect(m.activeTargetHandle == nil)

        let before = m.target
        m.dragTargetHandle(translationFraction: 0.5)
        #expect(m.target == before, "dragTargetHandle is a no-op without a fresh begin")
    }

    @Test func aDragAfterAPresetStartsFromThePresetShape() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.selectTargetPreset(.worshipService)
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        // The bundled JSON's freqs are rounded decimals, not bit-identical to
        // the computed grid, so moving() resamples through onGrid first —
        // compare against that same resampling, not the raw bundled offsets.
        let worshipGrid = TargetCurveHandles.onGrid(worship)

        m.beginTargetHandleDrag(3)
        let fraction = 0.1
        m.dragTargetHandle(translationFraction: fraction)

        let handleIndex = TargetCurveHandles.gridIndices[3]
        let neighbourSpan = TargetCurveHandles.gridIndices[2]...TargetCurveHandles.gridIndices[4]
        for (index, offset) in m.target.dbOffsets.enumerated() where !neighbourSpan.contains(index) {
            #expect(abs(offset - worshipGrid.dbOffsets[index]) < 1e-9)
        }

        let expectedHandleOffset = worshipGrid.dbOffsets[handleIndex] + fraction * m.rtaScale.spanDb
        #expect(abs(m.target.dbOffsets[handleIndex] - expectedHandleOffset) < 1e-9)
    }

    @Test func selectTargetPresetReturnsFalseWhenTheLoaderThrows() throws {
        struct LoaderFailure: Error {}
        let m = model(target: .flat, targetIsAuto: true, presetLoader: { _ in throw LoaderFailure() })
        m.beginTargetEdit()
        #expect(m.selectTargetPreset(.worshipService) == false)
        #expect(m.target == .flat)
    }

    @Test func cancelAfterAPresetRestoresTheOriginal() throws {
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        m.selectTargetPreset(.worshipService)
        m.cancelTargetEdit()
        #expect(m.target == .flat)
        #expect(m.targetIsAuto)
        #expect(!m.isEditingTarget)
    }

    @Test func activeTargetPresetIdIsNilWhenNotEditingAndAfterADrag() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        #expect(m.activeTargetPresetId == nil, "not editing")

        m.beginTargetEdit()
        #expect(m.activeTargetPresetId == IdealCurveLibrary.flatId)

        m.selectTargetPreset(.worshipService)
        #expect(m.activeTargetPresetId == IdealCurveLibrary.worshipServiceId)

        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
        #expect(m.activeTargetPresetId == nil, "a drag makes the draft custom")

        m.commitTargetEdit()
        #expect(m.activeTargetPresetId == nil, "not editing after commit")
    }

    // MARK: Target tray: pick a target outside edit mode (#1745)

    @Test func selectingABuiltInOutsideEditModeAppliesItAsAUserChoice() async throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: IdealCurveLibrary.liveDefault(), targetIsAuto: true)
        await m.appear()

        #expect(m.selectTarget(id: IdealCurveLibrary.worshipServiceId))
        #expect(m.target == worship)
        #expect(!m.targetIsAuto)
        #expect(m.coachingCurve == worship, "the coach is rebuilt immediately, no edit mode needed")
        #expect(!m.isEditingTarget)
        #expect(m.targetLegendText == "Target · Worship – Classic")
        #expect(m.selectedTargetTrayId == IdealCurveLibrary.worshipServiceId)
    }

    @Test func coachingUsesThePickedCurveOnTheNextReadings() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(levels(base: -30)))
        #expect(m.coaching.isEmpty, "flat levels are on a flat target")

        #expect(m.selectTarget(id: IdealCurveLibrary.worshipServiceId))
        #expect(m.coaching.isEmpty, "the switch clears the cards; the next readings judge the new curve")
        try sustain(levels(base: -30))
        #expect(m.coaching.count == BandDeviationCoach.maxEvents)
        #expect(m.coaching.first?.message.contains("gentle cut") == true)
    }

    @Test func aPickedTargetIsNotSwitchedBySpeech() async throws {
        let m = model(target: IdealCurveLibrary.liveDefault(), targetIsAuto: true)
        await m.appear()
        #expect(m.selectTarget(id: IdealCurveLibrary.worshipServiceId))

        try deliverSustained(speechOverAPadFeatures(), bands: levels(base: -40), count: 130)
        #expect(m.programMode == .speech)
        #expect(m.target.id == IdealCurveLibrary.worshipServiceId)
    }

    @Test func pickingAutoRestoresTheProgramModeTarget() async throws {
        let m = model(target: IdealCurveLibrary.liveDefault(), targetIsAuto: true)
        await m.appear()
        #expect(m.selectTarget(id: IdealCurveLibrary.worshipServiceId))
        try deliverSustained(speechOverAPadFeatures(), bands: levels(base: -40), count: 130)
        #expect(m.programMode == .speech)

        #expect(m.selectAutoTarget())
        #expect(m.targetIsAuto)
        #expect(m.target.id == IdealCurveLibrary.speechPodcastId, "Auto in speech mode is the speech curve, right away")
        #expect(m.coachingCurve.id == IdealCurveLibrary.speechPodcastId)
        #expect(m.targetLegendText == "Target · Speech – Clear Voice (auto)")
        #expect(m.selectedTargetTrayId == AnalyzeModel.autoTargetTrayId)
    }

    @Test func pickingAutoInMusicModeRestoresTheInitialAutoTarget() async throws {
        let m = model(target: IdealCurveLibrary.liveDefault(), targetIsAuto: true)
        await m.appear()
        #expect(m.selectTarget(id: IdealCurveLibrary.flatId))
        #expect(m.target.id == IdealCurveLibrary.flatId)

        #expect(m.selectAutoTarget())
        #expect(m.target.id == IdealCurveLibrary.worshipRoomId)
        #expect(m.targetIsAuto)
    }

    @Test func trayPicksAreIgnoredWhileEditing() async throws {
        let m = model(target: IdealCurveLibrary.liveDefault(), targetIsAuto: true)
        await m.appear()
        m.beginTargetEdit()
        #expect(!m.selectTarget(id: IdealCurveLibrary.worshipServiceId))
        #expect(!m.selectAutoTarget())
        #expect(m.target.id == IdealCurveLibrary.worshipRoomId)
        #expect(m.isEditingTarget)
    }

    @Test func anUnknownOrUnloadableTargetIsANoOp() async throws {
        struct LoaderFailure: Error {}
        let m = model(target: .flat, targetIsAuto: true, presetLoader: { _ in throw LoaderFailure() })
        await m.appear()
        #expect(!m.selectTarget(id: IdealCurveLibrary.worshipServiceId))
        #expect(m.target == .flat)
        #expect(m.targetIsAuto)
    }

    @Test func trayOptionsAreAutoThenTheBuiltIns() {
        let m = model()
        let options = m.targetTrayOptions
        #expect(options.first?.id == AnalyzeModel.autoTargetTrayId)
        #expect(options.first?.title == "Auto")
        #expect(options.dropFirst().map(\.id) == TargetCurvePreset.all.map(\.id))
        #expect(options.dropFirst().map(\.title) == TargetCurvePreset.all.map(\.title))
        #expect(m.selectedTargetTrayId == AnalyzeModel.autoTargetTrayId)
    }

    @Test func theTrayEditButtonEntersTheSameEditModeAsTheLegend() async throws {
        let m = model(target: IdealCurveLibrary.liveDefault(), targetIsAuto: true)
        await m.appear()
        m.beginTargetEdit()
        #expect(m.isEditingTarget)
        m.cancelTargetEdit()
        #expect(!m.isEditingTarget)
        #expect(m.target.id == IdealCurveLibrary.worshipRoomId)
        #expect(m.targetIsAuto)
    }

    // MARK: Copy

    @Test func coachingPlaceholderNeverAsksForATap() async {
        let m = model()
        #expect(m.coachingPlaceholder.contains("automatically"))
        await m.appear()
        #expect(m.coachingPlaceholder.contains("Keep listening"))
        let denied = model(granted: false)
        await denied.appear()
        #expect(denied.coachingPlaceholder.contains("microphone"))
        for text in [m.coachingPlaceholder, denied.coachingPlaceholder] {
            #expect(!text.contains("Tap Start"))
        }
    }
}

@MainActor
@Suite struct FormatOverallLevelTests {
    @Test(arguments: [
        (nil, "—"),
        (89.64, "89.6 dB"),
        (89.66, "89.7 dB"),
        (-0.02, "0.0 dB"),
        (120.0, "120.0 dB"),
        (Double.nan, "—"),
        (-Double.infinity, "—"),
    ] as [(Double?, String)])
    func formatsAsExpected(db: Double?, expected: String) {
        #expect(AnalyzeModel.formatOverallLevel(db) == expected)
    }

    @Test func neverShowsFullScale() {
        for db in [nil, 15.0, 89.6, 120.0] as [Double?] {
            let text = AnalyzeModel.formatOverallLevel(db)
            #expect(!text.contains("dBFS"))
            if db != nil {
                #expect(text.hasSuffix(" dB"))
            }
        }
    }

    @Test func neverClaimsAWeightingOrSpl() {
        #expect(AnalyzeModel.overallLevelUnit == "dB")
        for db in [15.0, 89.6, 120.0] {
            let text = AnalyzeModel.formatOverallLevel(db)
            #expect(!text.contains("dBA"))
            #expect(!text.contains("SPL"))
        }
    }

    @Test(arguments: [
        (nil, "—"),
        (89.64, "89.6"),
        (-0.02, "0.0"),
        (120.0, "120.0"),
        (Double.nan, "—"),
    ] as [(Double?, String)])
    func numberOmitsTheUnit(db: Double?, expected: String) {
        #expect(AnalyzeModel.formatOverallLevelNumber(db) == expected)
    }

    @Test func fullTextIsTheNumberPlusTheUnit() {
        #expect(AnalyzeModel.formatOverallLevel(96.57) == "\(AnalyzeModel.formatOverallLevelNumber(96.57)) \(AnalyzeModel.overallLevelUnit)")
    }
}

@MainActor
@Suite struct EstimatedSplTests {
    @Test func offsetIsTheDocumentedConstant() {
        #expect(AnalyzeModel.phoneMicSplOffsetDb == 103.0)
    }

    @Test func addsTheOffsetToADbfsReading() {
        #expect(abs(AnalyzeModel.estimatedSpl(fromDbfs: -25.4)! - 77.6) < 1e-9)
    }

    @Test(arguments: [nil, Double.nan, -Double.infinity] as [Double?])
    func nonFiniteOrMissingInputStaysNil(dbfs: Double?) {
        #expect(AnalyzeModel.estimatedSpl(fromDbfs: dbfs) == nil)
    }
}

@MainActor
@Suite struct FormatTargetLegendTests {
    @Test func autoSuffixIsAppendedWhenAuto() {
        #expect(AnalyzeModel.formatTargetLegend(label: "Worship – Classic", isAuto: true) == "Target · Worship – Classic (auto)")
    }

    @Test func noSuffixWhenNotAuto() {
        #expect(AnalyzeModel.formatTargetLegend(label: "Worship – Classic", isAuto: false) == "Target · Worship – Classic")
    }
}
