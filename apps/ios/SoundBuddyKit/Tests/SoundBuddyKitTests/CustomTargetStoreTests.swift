import Foundation
import Testing
@testable import SoundBuddyKit

/// Records logged lines in order, for asserting the corrupt-blob and
/// encode-failure paths without touching `os.Logger`.
private final class LogRecorder {
    var lines: [String] = []
    func log(_ message: String) { lines.append(message) }
}

/// Deterministic id generator: "id-1", "id-2", ... in call order.
private final class IdGenerator {
    private var next = 0
    func makeId() -> String {
        next += 1
        return "id-\(next)"
    }
}

private let revised = IdealCurve(
    id: "revised-source",
    label: "unused",
    description: "unused",
    freqs: IdealCurve.gridFreqs,
    dbOffsets: (0..<IdealCurve.gridPoints).map { Double($0) * 0.25 - 3 }
)

@Suite struct CustomTargetStoreTests {
    @Test func addThenUpdateReplacesOffsetsKeepingIdAndLabel() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let ids = IdGenerator()
        let store = CustomTargetStore(defaults: defaults, makeId: ids.makeId)

        let added = store.add(from: .flat, label: "Room A")
        let updated = store.update(id: added.id, curve: revised)

        #expect(store.all.count == 1)
        #expect(store.all[0].id == added.id)
        #expect(store.all[0].label == "Room A")
        #expect(store.all[0].dbOffsets == revised.dbOffsets)
        #expect(updated == store.all[0])
    }

    @Test func addUsesInjectedIdAndCopiesCurveShape() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let ids = IdGenerator()
        let store = CustomTargetStore(defaults: defaults, makeId: ids.makeId)

        let first = store.add(from: .flat, label: "Room A")
        #expect(first.id == "id-1")
        #expect(first.description == CustomTargetStore.curveDescription)
        #expect(first.freqs == IdealCurve.flat.freqs)
        #expect(first.dbOffsets == IdealCurve.flat.dbOffsets)

        let second = store.add(from: .flat, label: "Room B")
        #expect(second.id == "id-2")
        #expect(first.id != second.id)
    }

    @Test func updateUnknownIdIsANoOp() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        store.add(from: .flat, label: "Room A")

        let result = store.update(id: "does-not-exist", curve: revised)
        #expect(result == nil)
        #expect(store.all.count == 1)

        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all == store.all)
    }

    @Test func deleteRemovesTheCurve() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let first = store.add(from: .flat, label: "Room A")
        let second = store.add(from: .flat, label: "Room B")

        store.delete(id: first.id)

        #expect(!store.all.contains { $0.id == first.id })
        #expect(store.all.contains { $0.id == second.id })

        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all == store.all)
    }

    @Test func deleteUnknownIdIsANoOp() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        store.add(from: .flat, label: "Room A")
        let before = store.all

        store.delete(id: "does-not-exist")

        #expect(store.all == before)
    }

    @Test func roundTripSurvivesReinitialization() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let a = store.add(from: .flat, label: "Room A")
        store.add(from: .flat, label: "Room B")
        store.update(id: a.id, curve: revised)

        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all == store.all)
    }

    @Test func persistedBlobCarriesSchemaVersion() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        store.add(from: .flat, label: "Room A")
        store.add(from: .flat, label: "Room B")

        let data = defaults.data(forKey: CustomTargetStore.defaultsKey)
        #expect(data != nil)
        let json = try JSONSerialization.jsonObject(with: data!) as? [String: Any]
        #expect(json?["schemaVersion"] as? Int == 1)
        #expect((json?["curves"] as? [[String: Any]])?.count == 2)
    }

    @Test func missingKeyStartsEmptyWithoutLogging() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let recorder = LogRecorder()
        let store = CustomTargetStore(defaults: defaults, log: recorder.log)

        #expect(store.all.isEmpty)
        #expect(recorder.lines.isEmpty)
    }

    @Test(arguments: [
        Data("not json".utf8),
        Data("{\"schemaVersion\": 99, \"curves\": []}".utf8),
    ])
    func corruptBlobIsDroppedLoggedAndStartsEmpty(blob: Data) {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        defaults.set(blob, forKey: CustomTargetStore.defaultsKey)
        let recorder = LogRecorder()

        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId, log: recorder.log)

        #expect(store.all.isEmpty)
        #expect(recorder.lines.count == 1)
        #expect(defaults.object(forKey: CustomTargetStore.defaultsKey) == nil)

        store.add(from: .flat, label: "Room A")
        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all == store.all)
    }

    @Test func nonDataValueIsDroppedLoggedAndStartsEmpty() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        defaults.set("oops", forKey: CustomTargetStore.defaultsKey)
        let recorder = LogRecorder()

        let store = CustomTargetStore(defaults: defaults, log: recorder.log)

        #expect(store.all.isEmpty)
        #expect(recorder.lines.count == 1)
        #expect(defaults.object(forKey: CustomTargetStore.defaultsKey) == nil)
    }

    @Test func mismatchedCurveLengthIsDroppedLoggedAndStartsEmpty() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let badEnvelope: [String: Any] = [
            "schemaVersion": 1,
            "curves": [[
                "schemaVersion": 1,
                "id": "bad",
                "label": "Bad",
                "description": "Bad",
                "freqs": [20.0, 40.0],
                "dbOffsets": [0.0],
            ]],
        ]
        let data = try! JSONSerialization.data(withJSONObject: badEnvelope)
        defaults.set(data, forKey: CustomTargetStore.defaultsKey)
        let recorder = LogRecorder()

        let store = CustomTargetStore(defaults: defaults, log: recorder.log)

        #expect(store.all.isEmpty)
        #expect(recorder.lines.count == 1)
        #expect(defaults.object(forKey: CustomTargetStore.defaultsKey) == nil)
    }

    @Test func encodeFailureIsLoggedAndNotPersisted() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let recorder = LogRecorder()
        let store = CustomTargetStore(defaults: defaults, log: recorder.log)

        let nanCurve = IdealCurve(
            id: "nan",
            label: "NaN",
            description: "NaN",
            freqs: IdealCurve.gridFreqs,
            dbOffsets: Array(repeating: Double.nan, count: IdealCurve.gridPoints)
        )
        store.add(from: nanCurve, label: "Room A")

        #expect(recorder.lines.count == 1)
        #expect(defaults.object(forKey: CustomTargetStore.defaultsKey) == nil)
    }
}
