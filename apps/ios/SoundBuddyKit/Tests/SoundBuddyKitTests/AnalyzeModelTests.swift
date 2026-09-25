import Foundation
import Testing
@testable import SoundBuddyKit

private struct FakePermission: MicPermission {
    let granted: Bool
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
    var onLevels: (@MainActor (BandLevels) -> Void)?

    func start(onLevels: @escaping @MainActor (BandLevels) -> Void) throws {
        if failStart { throw StartFailure() }
        startCount += 1
        self.onLevels = onLevels
    }

    func stop() {
        stopCount += 1
        onLevels = nil
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

@MainActor
@Suite struct AnalyzeModelTests {
    let source = FakeSource()
    let clock = FakeClock()

    func model(granted: Bool = true) -> AnalyzeModel {
        AnalyzeModel(permission: FakePermission(granted: granted), source: source, now: { [clock] in clock.now })
    }

    @Test func startsIdleWithSilentBandsAndThePhoneMicCue() {
        let m = model()
        #expect(m.state == .idle)
        #expect(m.bandLevels == .silent)
        #expect(m.coaching.isEmpty)
        #expect(m.measurementSource == .phoneMicEstimate)
        #expect(AnalyzeModel.honestyCue == "Phone mic estimate")
    }

    @Test func grantedPermissionGoesLive() async {
        let m = model()
        await m.start()
        #expect(m.state == .live)
        #expect(source.startCount == 1)
    }

    @Test func deniedPermissionNeverStartsTheMic() async {
        let m = model(granted: false)
        await m.start()
        #expect(m.state == .micDenied)
        #expect(source.startCount == 0)
    }

    @Test func aSourceFailureIsReportedActionably() async {
        source.failStart = true
        let m = model()
        await m.start()
        guard case .failed(let message) = m.state else {
            Issue.record("expected .failed, got \(m.state)")
            return
        }
        #expect(message.contains("input unavailable"))
        #expect(message.contains("Tap Start to try again"))
    }

    @Test func startWhileLiveIsANoOp() async {
        let m = model()
        await m.start()
        await m.start()
        #expect(source.startCount == 1)
    }

    @Test func levelsFromTheSourceUpdateBandsAndCoaching() async throws {
        let m = model()
        await m.start()
        clock.advance(4)
        let reading = levels([.lowMid: -22])
        try #require(source.onLevels)(reading)
        #expect(m.bandLevels == reading)
        let event = try #require(m.coaching.first)
        #expect(event.band == .lowMid)
        #expect(event.sessionTime == 4)
    }

    @Test func stopReturnsToIdleAndReleasesTheMic() async {
        let m = model()
        await m.start()
        m.stop()
        #expect(m.state == .idle)
        #expect(source.stopCount == 1)
    }

    @Test func stopWhenIdleDoesNotTouchTheSource() {
        let m = model()
        m.stop()
        #expect(source.stopCount == 0)
    }
}
