import Foundation
import Testing
@testable import SoundBuddyKit

private func decode<T: Decodable>(_ type: T.Type, json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

private func roundTrip<T: Codable>(_ value: T) throws -> T {
    try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value))
}

/// The Swift models must decode the checked-in examples in apps/ios/Contracts
/// — the same files validate_contracts.py checks against the JSON Schemas on
/// Linux CI — so the schema and the Codable model can't drift apart silently.
@Suite struct IdealCurveContractTests {
    @Test func decodesTheMacExportedExample() throws {
        let curve = try JSONDecoder().decode(
            IdealCurve.self,
            from: Data(contentsOf: TestPaths.contractExample("ideal-curve.v1.music-fullrange.json"))
        )
        #expect(curve.id == "music-fullrange")
        #expect(curve.freqs.count == IdealCurve.gridPoints)
        #expect(curve.dbOffsets.count == IdealCurve.gridPoints)
        #expect(try roundTrip(curve) == curve)
    }

    @Test func rejectsMismatchedLengths() {
        let json = #"{"schemaVersion":1,"id":"x","label":"X","description":"","freqs":[20,1000,20000],"dbOffsets":[0,0]}"#
        #expect(throws: IdealCurve.ValidationError.lengthMismatch(freqs: 3, dbOffsets: 2)) {
            try decode(IdealCurve.self, json: json)
        }
    }

    @Test func rejectsNonAscendingFreqs() {
        let json = #"{"schemaVersion":1,"id":"x","label":"X","description":"","freqs":[20,20,1000],"dbOffsets":[0,0,0]}"#
        #expect(throws: IdealCurve.ValidationError.freqsNotAscending) {
            try decode(IdealCurve.self, json: json)
        }
    }

    @Test func rejectsAnUnknownSchemaVersion() {
        let json = #"{"schemaVersion":2,"id":"x","label":"X","description":"","freqs":[20,1000],"dbOffsets":[0,0]}"#
        #expect(throws: ContractError.unsupportedSchemaVersion(contract: "IdealCurve", found: 2, supported: 1)) {
            try decode(IdealCurve.self, json: json)
        }
    }

    @Test func flatMirrorsTheMacFlatProfileGrid() {
        let flat = IdealCurve.flat
        #expect(flat.id == "flat")
        #expect(flat.freqs.count == IdealCurve.gridPoints)
        #expect(abs(flat.freqs.first! - 20) < 1e-9)
        #expect(abs(flat.freqs.last! - 20_000) < 1e-6)
        #expect(flat.dbOffsets.allSatisfy { $0 == 0 })
    }

    @Test func bandTargetsAverageTheOffsetsInsideEachBand() {
        let curve = IdealCurve(
            id: "t", label: "T", description: "",
            freqs: [30, 50, 100, 1000],
            dbOffsets: [2, 4, -3, 1]
        )
        let targets = curve.bandTargets
        #expect(targets[.subBass] == 3)
        #expect(targets[.bass] == -3)
        #expect(targets[.mid] == 1)
        #expect(targets[.presence] == 0, "a band with no grid points has a neutral target")
    }
}

@Suite struct CoachingEventContractTests {
    @Test func decodesTheExample() throws {
        let event = try JSONDecoder().decode(
            CoachingEvent.self,
            from: Data(contentsOf: TestPaths.contractExample("coaching-event.v1.band-deviation.json"))
        )
        #expect(event.ruleType == .bandDeviation)
        #expect(event.severity == .suggestion)
        #expect(event.band == .lowMid)
        #expect(event.source == .phoneMicEstimate)
        #expect(event.data?["deviationDb"] == .number(4.5))
        #expect(event.data?["range"] == .string("250-500 Hz"))
        #expect(try roundTrip(event) == event)
    }

    @Test func omitsAbsentOptionalFieldsWhenEncoding() throws {
        let event = CoachingEvent(
            id: "e", ruleType: .gain, severity: .info, band: nil,
            message: "m", data: nil, source: .macMeasurement, sessionTime: 0
        )
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(event)) as? [String: Any])
        #expect(object["band"] == nil)
        #expect(object["data"] == nil)
        #expect(object["schemaVersion"] as? Int == 1)
    }

    @Test func rejectsAnUnknownSchemaVersion() {
        let json = #"{"schemaVersion":9,"id":"e","ruleType":"gain","severity":"info","message":"m","source":"mac-measurement","sessionTime":0}"#
        #expect(throws: ContractError.unsupportedSchemaVersion(contract: "CoachingEvent", found: 9, supported: 1)) {
            try decode(CoachingEvent.self, json: json)
        }
    }

    @Test func dataValuesMustBeStringsOrNumbers() {
        let json = #"{"schemaVersion":1,"id":"e","ruleType":"gain","severity":"info","message":"m","data":{"k":true},"source":"mac-measurement","sessionTime":0}"#
        #expect(throws: DecodingError.self) {
            try decode(CoachingEvent.self, json: json)
        }
    }
}
