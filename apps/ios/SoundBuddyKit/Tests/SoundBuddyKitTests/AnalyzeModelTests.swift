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

private func reading(_ bands: BandLevels, rta: [Double] = [-40, -50]) -> SpectrumReading {
    SpectrumReading(bands: bands, rtaDb: rta)
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
        #expect(m.measurementSource == .phoneMicEstimate)
        #expect(AnalyzeModel.honestyCue == "Phone mic estimate")
        #expect(source.startCount == 0, "nothing listens until the screen appears")
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
