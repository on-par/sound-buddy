import Testing
@testable import SoundBuddyKit

/// Build levels where every band sits at `base` except the overrides.
private func levels(base: Double = -30, _ overrides: [Band: Double] = [:]) -> BandLevels {
    BandLevels(db: Dictionary(uniqueKeysWithValues: Band.allCases.map { ($0, overrides[$0] ?? base) }))
}

@Suite struct ProblemMarkerDescriptorTests {
    let coach = BandDeviationCoach(ideal: .flat)

    @Test func overTargetBandIsAWarmMarker() throws {
        let bandLevels = levels([.lowMid: -22])
        let markers = coach.problemMarkers(for: bandLevels)
        #expect(markers.count == 1)
        let marker = try #require(markers.first)
        #expect(marker.band == .lowMid)
        #expect(marker.direction == .overTarget)
        #expect(marker.lowHz == 250)
        #expect(marker.highHz == 500)
        #expect(abs(marker.severityDb - 6.9) < 1e-9)
        #expect(marker.id == "lowMid")

        let events = coach.events(for: bandLevels, sessionTime: 0)
        let event = try #require(events.first)
        #expect(event.message.contains("gentle cut"))
    }

    @Test func underTargetBandIsACoolMarker() throws {
        let bandLevels = levels([.presence: -38])
        let markers = coach.problemMarkers(for: bandLevels)
        let marker = try #require(markers.first)
        #expect(marker.band == .presence)
        #expect(marker.direction == .underTarget)
        #expect(marker.lowHz == 4000)
        #expect(marker.highHz == 6000)

        let events = coach.events(for: bandLevels, sessionTime: 0)
        let event = try #require(events.first)
        #expect(event.message.contains("small boost"))
    }

    @Test func silenceYieldsNoMarkers() {
        let quiet = levels(base: SpectrumAnalyzer.silenceFloorDb, [.mid: BandDeviationCoach.minimumSignalDb - 1])
        #expect(coach.problemMarkers(for: quiet).isEmpty)
        #expect(coach.problemMarkers(for: levels(base: -10)).isEmpty, "level-invariant: gain alone never coaches")
    }

    @Test func underThresholdYieldsNoMarkers() {
        #expect(coach.problemMarkers(for: levels([.mid: -28])).isEmpty)
    }

    @Test func capBoundary() {
        let busy = levels([.subBass: -20, .bass: -22, .lowMid: -24, .highMid: -40, .brilliance: -45])
        let markers = coach.problemMarkers(for: busy)
        #expect(markers.count == BandDeviationCoach.maxEvents)
        #expect(markers.map(\.band) == [.brilliance, .subBass, .highMid])

        let exactlyThree = levels([.subBass: -20, .bass: -20, .brilliance: -45])
        #expect(coach.problemMarkers(for: exactlyThree).count == 3)

        let fourQualifying = levels([.subBass: -20, .bass: -20, .lowMid: -20, .brilliance: -45])
        #expect(coach.problemMarkers(for: fourQualifying).count == BandDeviationCoach.maxEvents)
    }

    @Test func markersMatchCoachingEvents() throws {
        let curveIds = IdealCurveLibrary.builtInIds
        let rooms: [BandLevels] = [
            levels(base: -30),
            levels(base: -10),
            levels([.subBass: -20, .bass: -22, .lowMid: -24, .highMid: -40, .brilliance: -45]),
        ]
        for curveId in curveIds {
            let curveCoach = BandDeviationCoach(ideal: try IdealCurveLibrary.builtIn(id: curveId))
            for room in rooms {
                let markers = curveCoach.problemMarkers(for: room)
                let events = curveCoach.events(for: room, sessionTime: 0)
                #expect(markers.map(\.band) == events.map(\.band))
                for (marker, event) in zip(markers, events) {
                    let deviationDb = try #require(event.data?["deviationDb"])
                    guard case .number(let value) = deviationDb else {
                        Issue.record("deviationDb should be a number")
                        continue
                    }
                    let expectedDirection: ProblemMarkerDescriptor.Direction = value > 0 ? .overTarget : .underTarget
                    #expect(marker.direction == expectedDirection)
                    #expect(abs(marker.severityDb - abs(value)) < 1e-9)
                }
            }
        }
    }
}
