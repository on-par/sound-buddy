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

private func reading(_ bands: BandLevels, rta: [Double] = [-40, -50], overallDb: Double = -18.43) -> SpectrumReading {
    SpectrumReading(bands: bands, rtaDb: rta, overallDb: overallDb)
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
        #expect(m.overallLevelText == "—")
    }

    // MARK: Always listening

    @Test func appearingStartsListeningWithNoTap() async {
        let m = model()
        await m.appear()
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
        let event = try #require(m.coaching.first)
        #expect(event.band == .lowMid)
        #expect(event.sessionTime == 4)
    }

    /// Coaching text redrawn at the 20 Hz meter rate is unreadable; the stack
    /// refreshes at most once per coachingRefreshSeconds.
    @Test func coachingRefreshesAtAReadablePace() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(levels([.lowMid: -22])))
        let first = m.coaching
        clock.advance(AnalyzeModel.coachingRefreshSeconds / 2)
        try deliver(reading(levels([.presence: -10])))
        #expect(m.coaching == first, "too soon — keep the current stack")
        #expect(m.bandLevels[.presence] == -10, "the meter still updates every reading")
        clock.advance(AnalyzeModel.coachingRefreshSeconds)
        try deliver(reading(levels([.presence: -10])))
        #expect(m.coaching.first?.band == .presence)
    }

    @Test func theRTAMeterAgesByWallClock() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(.silent, rta: [-20]))
        clock.advance(0.1)
        try deliver(reading(.silent, rta: [-90]))
        // Date arithmetic at epoch 1000 s keeps ~1e-7 s of precision.
        #expect(abs(m.rta.levels[0] - (-20 - RTAMeter.releaseDbPerSecond * 0.1)) < 1e-4)
    }

    @Test func readingsPublishTheOverallLevel() async throws {
        let m = model()
        await m.appear()
        try deliver(SpectrumReading(bands: .silent, rtaDb: [-40], overallDb: -18.43))
        #expect(m.overallDb == -18.43)
        #expect(m.overallLevelText == "-18.4 dBFS")
        clock.advance(AnalyzeModel.coachingRefreshSeconds / 2)
        try deliver(SpectrumReading(bands: .silent, rtaDb: [-40], overallDb: -30.1))
        #expect(m.overallDb == -30.1, "the meter updates every reading, not just at the coaching cadence")
    }

    @Test func aSilentReadingShowsADash() async throws {
        let m = model()
        await m.appear()
        try deliver(SpectrumReading(bands: .silent, rtaDb: [-40], overallDb: AnalyzeModel.overallLevelFloorDb))
        #expect(m.overallDb == nil)
        #expect(m.overallLevelText == "—")
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

        // Levels rise instantly (no release lag), so a uniform +10 dB gain
        // shows up on the very next reading.
        let shifted = measured.map { $0 + 10 }
        try deliver(reading(.silent, rta: shifted))
        let shiftedTarget = try #require(m.rtaTargetDb)
        for (before, after) in zip(target, shiftedTarget) {
            #expect(abs(after - (before + 10)) < 1e-6)
        }
    }

    @Test func defaultFlatTargetIsAConstantLineAtTheMeasuredMean() async throws {
        let m = model()
        await m.appear()
        let count = RTALayout.standard.bands.count
        let measured = (0..<count).map { -50.0 + Double($0 % 15) }
        try deliver(reading(.silent, rta: measured))
        let target = try #require(m.rtaTargetDb)
        let mean = measured.reduce(0, +) / Double(count)
        for value in target {
            #expect(abs(value - mean) < 1e-6)
        }
    }

    @Test func targetLegendTextUsesTheModelsTargetLabelAndAutoFlag() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        #expect(model(target: curve, targetIsAuto: true).targetLegendText == "Target · Worship service (auto)")
        #expect(model(target: curve, targetIsAuto: false).targetLegendText == "Target · Worship service")
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
        #expect(flatModel.coachingPlaceholder.contains("Balance looks close"))

        await worshipModel.appear()
        try deliver(reading(levels(base: -30)))
        #expect(worshipModel.coaching.count == BandDeviationCoach.maxEvents)
        #expect(worshipModel.coaching.first?.message.contains("gentle cut") == true)
    }

    // MARK: Problem markers

    @Test func problemMarkersMatchTheCoachOnTheSameReading() async throws {
        let m = model()
        await m.appear()
        let bands = levels([.lowMid: -22])
        try deliver(reading(bands))
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
        try deliver(reading(levels([.lowMid: -22])))
        let first = m.problemMarkers
        clock.advance(AnalyzeModel.coachingRefreshSeconds / 2)
        try deliver(reading(levels([.presence: -38])))
        #expect(m.problemMarkers == first, "too soon — keep the current markers")
        clock.advance(AnalyzeModel.coachingRefreshSeconds)
        try deliver(reading(levels([.presence: -38])))
        #expect(m.problemMarkers.map(\.band) == [.presence])
    }

    @Test func disappearingClearsProblemMarkers() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(levels([.lowMid: -22])))
        #expect(!m.problemMarkers.isEmpty)
        m.disappear()
        #expect(m.problemMarkers.isEmpty)
    }

    @Test func backgroundingClearsProblemMarkers() async throws {
        let m = model()
        await m.appear()
        try deliver(reading(levels([.lowMid: -22])))
        #expect(!m.problemMarkers.isEmpty)
        m.enterBackground()
        #expect(m.problemMarkers.isEmpty)
    }

    // MARK: Target curve editing (#1558)

    @Test func beginTargetEditEntersEditModeWithoutChangingTheTarget() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: curve, targetIsAuto: true)
        m.beginTargetEdit()
        #expect(m.isEditingTarget)
        #expect(m.target == curve)
        #expect(m.targetLegendText == "Target · Worship service (auto)")
    }

    @Test func cancelRestoresThePreEditCurveAfterADraftChange() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        m.updateTargetDraft(worship)
        #expect(m.target == worship)
        #expect(m.coachingCurve == worship)
        m.cancelTargetEdit()
        #expect(!m.isEditingTarget)
        #expect(m.target == .flat)
        #expect(m.coachingCurve == .flat)
        #expect(m.targetLegendText == "Target · Flat / neutral (auto)")
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
        #expect(m.targetLegendText == "Target · Worship service")
    }

    @Test func commitWithNoChangeLeavesTheTargetAndAutoFlagUnchanged() {
        let m = model(target: .flat, targetIsAuto: true)
        m.beginTargetEdit()
        m.commitTargetEdit()
        #expect(!m.isEditingTarget)
        #expect(m.target == .flat)
        #expect(m.targetIsAuto)
        #expect(m.targetLegendText == "Target · Flat / neutral (auto)")
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
            #expect(abs(entry.displayDb - (entry.handle.offsetDb + shift)) < 1e-6)
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
        let handleDisplayDb = try #require(m.rtaTargetHandles.first { $0.handle.ordinal == 3 }?.displayDb)
        #expect(abs(handleDisplayDb - (expectedOffset + shiftBeforeDrag)) < 1e-6)

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

    @Test func coachingCurveFollowsTheDraftAfterADrag() async throws {
        let m = try await liveModelWithFullReading(target: .flat)
        m.beginTargetEdit()
        m.beginTargetHandleDrag(3)
        m.dragTargetHandle(translationFraction: 0.1)
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
        #expect(m.coachingCurve == m.target)
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
        (-18.44, "-18.4 dBFS"),
        (-18.46, "-18.5 dBFS"),
        (-0.02, "0.0 dBFS"),
        (3.0, "3.0 dBFS"),
        (Double.nan, "—"),
        (-Double.infinity, "—"),
    ] as [(Double?, String)])
    func formatsAsExpected(db: Double?, expected: String) {
        #expect(AnalyzeModel.formatOverallLevel(db) == expected)
    }

    @Test func neverClaimsSpl() {
        for db in [nil, -18.4, 0.0, 3.0] as [Double?] {
            #expect(!AnalyzeModel.formatOverallLevel(db).contains("SPL"))
        }
    }
}

@MainActor
@Suite struct FormatTargetLegendTests {
    @Test func autoSuffixIsAppendedWhenAuto() {
        #expect(AnalyzeModel.formatTargetLegend(label: "Worship service", isAuto: true) == "Target · Worship service (auto)")
    }

    @Test func noSuffixWhenNotAuto() {
        #expect(AnalyzeModel.formatTargetLegend(label: "Worship service", isAuto: false) == "Target · Worship service")
    }
}
