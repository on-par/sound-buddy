import Testing
@testable import SoundBuddyKit

/// Build levels where every band sits at `base` except the overrides.
private func levels(base: Double = -30, _ overrides: [Band: Double] = [:]) -> BandLevels {
    BandLevels(db: Dictionary(uniqueKeysWithValues: Band.allCases.map { ($0, overrides[$0] ?? base) }))
}

@Suite struct BandDeviationCoachTests {
    let coach = BandDeviationCoach(ideal: .flat)

    @Test func matchingShapeAtAnyGainIsSilent() {
        #expect(coach.events(for: levels(base: -30), sessionTime: 1).isEmpty)
        #expect(coach.events(for: levels(base: -10), sessionTime: 1).isEmpty, "level-invariant: gain alone never coaches")
    }

    @Test func aBandOverTargetSuggestsACut() throws {
        let events = coach.events(for: levels([.lowMid: -22]), sessionTime: 12.5)
        let event = try #require(events.first)
        #expect(events.count == 1)
        #expect(event.ruleType == .bandDeviation)
        #expect(event.severity == .suggestion)
        #expect(event.band == .lowMid)
        #expect(event.source == .phoneMicEstimate)
        #expect(event.sessionTime == 12.5)
        #expect(event.message.contains("Low-mid (250\u{2013}500 Hz)"))
        #expect(event.message.contains("gentle cut"))
        #expect(event.message.contains("what Sound Buddy would try first"))
        #expect(event.data?["range"] == .string("250\u{2013}500 Hz"))
        // 8 dB over, level-matched against the 7-band mean (8/7 dB) -> 6.9 dB.
        #expect(event.data?["deviationDb"] == .number(6.9))
    }

    @Test func aBandUnderTargetSuggestsABoost() throws {
        let event = try #require(coach.events(for: levels([.presence: -38]), sessionTime: 0).first)
        #expect(event.band == .presence)
        #expect(event.message.contains("small boost"))
        #expect(event.message.contains("4\u{2013}6 kHz"))
    }

    @Test func deviationsInsideTheThresholdAreIgnored() {
        #expect(coach.events(for: levels([.mid: -28]), sessionTime: 0).isEmpty)
    }

    @Test func keepsOnlyTheLargestDeviationsForAShortStack() {
        let busy = levels([.subBass: -20, .bass: -22, .lowMid: -24, .highMid: -40, .brilliance: -45])
        let events = coach.events(for: busy, sessionTime: 0)
        #expect(events.count == BandDeviationCoach.maxEvents)
        #expect(events.map(\.band) == [.brilliance, .subBass, .highMid])
    }

    @Test func tooQuietToCoach() {
        let quiet = levels(base: SpectrumAnalyzer.silenceFloorDb, [.mid: BandDeviationCoach.minimumSignalDb - 1])
        #expect(coach.events(for: quiet, sessionTime: 0).isEmpty)
    }

    @Test func eventIdsAreDeterministicPerBand() throws {
        let event = try #require(coach.events(for: levels([.bass: -20]), sessionTime: 3).first)
        #expect(event.id == "band-deviation-bass")
    }

    /// The Oct 11 2026 FOH reference (#1725): median level-normalized 7-band
    /// levels of a mix Patrick called good-sounding, measured on the iPad mic.
    static var oct11ReferenceMix: BandLevels { levels(base: 0, [
        .subBass: 9.8, .bass: 17.5, .lowMid: 12.4, .mid: 8.0,
        .highMid: -7.9, .presence: -16.6, .brilliance: -23.6,
    ]) }

    @Test func worshipRoomStaysCalmOnTheOct11ReferenceMix() throws {
        let room = BandDeviationCoach(ideal: try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipRoomId))
        let deviations = room.deviations(for: Self.oct11ReferenceMix)
        #expect(deviations.count == Band.allCases.count)
        for band in Band.allCases {
            let d = try #require(deviations[band])
            #expect(abs(d) <= 2.0, "\(band.rawValue) is \(d) dB off worship-room on the good mix")
        }
        #expect(room.events(for: Self.oct11ReferenceMix, sessionTime: 0).isEmpty, "no band reaches the 3 dB tip threshold")
    }

    @Test func worshipServiceFalselyCoachesTheOct11ReferenceMix() throws {
        let service = BandDeviationCoach(ideal: try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId))
        let deviations = service.deviations(for: Self.oct11ReferenceMix)
        let tipped = Band.allCases.filter { abs(deviations[$0] ?? 0) >= BandDeviationCoach.thresholdDb }
        #expect(tipped.count >= 4, "worship-service tips \(tipped.map(\.rawValue)) on a mix that sounded right")
    }

    @Test func worshipServiceCurveCoachesAFlatRoom() throws {
        let worship = BandDeviationCoach(ideal: try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId))
        let room = levels(base: -30)
        #expect(coach.events(for: room, sessionTime: 0).isEmpty, "a flat target hears a flat room as balanced")
        let events = worship.events(for: room, sessionTime: 0)
        #expect(events.count == 3)
        // Uniform-Hz power-mean targets (#1724): worship-service's sub-bass
        // target is about 16.1 dB (the old grid-point mean read 11.6 dB), so
        // sub-bass, not bass, is now the second-largest gap on a flat room.
        #expect(events.map(\.band) == [.brilliance, .subBass, .presence])
        #expect(events[0].message.contains("gentle cut"), "brilliance sits above the tilted target")
        #expect(events[1].message.contains("small boost"), "sub-bass sits below the tilted target")
        #expect(events[2].message.contains("gentle cut"), "presence sits above the tilted target")
    }

    @Test func musicFullRangeCurveDiffersFromFlat() throws {
        let room = levels(base: -30, [.subBass: -33, .presence: -33])
        #expect(coach.events(for: room, sessionTime: 0).isEmpty, "flat target: centred deviation stays under threshold")
        let musicFullRange = BandDeviationCoach(ideal: try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.musicFullRangeId))
        let events = musicFullRange.events(for: room, sessionTime: 0)
        #expect(events.map(\.band) == [.subBass, .presence])
        for event in events {
            #expect(event.message.contains("small boost"), "music-fullrange lifts both the sub-bass and presence dips")
        }
    }

    @Test func nonFlatCurveIsGainInvariant() throws {
        let worship = BandDeviationCoach(ideal: try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId))
        let quiet = worship.events(for: levels(base: -30), sessionTime: 0)
        let loud = worship.events(for: levels(base: -10), sessionTime: 0)
        #expect(quiet.map(\.band) == loud.map(\.band))
        #expect(quiet.map { $0.data?["deviationDb"] } == loud.map { $0.data?["deviationDb"] })
        #expect(quiet.map(\.message) == loud.map(\.message))
    }

    @Test func nonFlatCurveStillHonoursTheSilenceGate() throws {
        let worship = BandDeviationCoach(ideal: try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId))
        let quiet = levels(base: SpectrumAnalyzer.silenceFloorDb, [.mid: BandDeviationCoach.minimumSignalDb - 1])
        #expect(worship.events(for: quiet, sessionTime: 0).isEmpty)
    }
}
