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

/// Seeds `defaults` with a persisted envelope whose single curve is the real
/// built-in curve for `id`, so the built-in id genuinely appears in `all`
/// (follows `mismatchedCurveLengthIsDroppedLoggedAndStartsEmpty`'s pattern).
private func seedBuiltIn(
    into defaults: UserDefaults,
    id: String = IdealCurveLibrary.worshipRoomId
) throws -> (defaults: UserDefaults, builtIn: IdealCurve) {
    let builtIn = try IdealCurveLibrary.builtIn(id: id)
    let curveData = try JSONEncoder().encode(builtIn)
    let curveObject = try JSONSerialization.jsonObject(with: curveData)
    let envelope: [String: Any] = ["schemaVersion": 1, "curves": [curveObject]]
    let data = try JSONSerialization.data(withJSONObject: envelope)
    defaults.set(data, forKey: CustomTargetStore.defaultsKey)
    return (defaults, builtIn)
}

@Suite struct CustomTargetStoreTests {
    @Test func addThenUpdateReplacesOffsetsKeepingIdAndLabel() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let ids = IdGenerator()
        let store = CustomTargetStore(defaults: defaults, makeId: ids.makeId)

        let added = store.add(from: .flat, label: "Room A")
        let updated = try store.update(id: added.id, curve: revised)

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

    @Test func updateUnknownIdIsANoOp() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        store.add(from: .flat, label: "Room A")

        let result = try store.update(id: "does-not-exist", curve: revised)
        #expect(result == nil)
        #expect(store.all.count == 1)

        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all == store.all)
    }

    @Test func deleteRemovesTheCurve() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let first = store.add(from: .flat, label: "Room A")
        let second = store.add(from: .flat, label: "Room B")

        try store.delete(id: first.id)

        #expect(!store.all.contains { $0.id == first.id })
        #expect(store.all.contains { $0.id == second.id })

        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all == store.all)
    }

    @Test func deleteUnknownIdIsANoOp() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        store.add(from: .flat, label: "Room A")
        let before = store.all

        try store.delete(id: "does-not-exist")

        #expect(store.all == before)
    }

    @Test func roundTripSurvivesReinitialization() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let a = store.add(from: .flat, label: "Room A")
        store.add(from: .flat, label: "Room B")
        try store.update(id: a.id, curve: revised)

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

    @Test func testBuiltInReadOnlyRenameIsRefused() throws {
        let (defaults, builtIn) = try seedBuiltIn(into: UserDefaults(suiteName: UUID().uuidString)!)
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let before = store.all
        let blobBefore = defaults.data(forKey: CustomTargetStore.defaultsKey)

        #expect(throws: CustomTargetStore.Refusal.builtInReadOnly(id: "worship-room")) {
            try store.rename(id: "worship-room", to: "New Name")
        }

        #expect(store.all.first { $0.id == "worship-room" }?.label == builtIn.label)
        #expect(store.all == before)
        #expect(defaults.data(forKey: CustomTargetStore.defaultsKey) == blobBefore)
    }

    @Test func testBuiltInReadOnlyUpdateIsRefused() throws {
        let (defaults, builtIn) = try seedBuiltIn(into: UserDefaults(suiteName: UUID().uuidString)!)
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let before = store.all
        let blobBefore = defaults.data(forKey: CustomTargetStore.defaultsKey)

        #expect(throws: CustomTargetStore.Refusal.builtInReadOnly(id: "worship-room")) {
            try store.update(id: "worship-room", curve: revised)
        }

        #expect(store.all.first { $0.id == "worship-room" }?.dbOffsets == builtIn.dbOffsets)
        #expect(store.all == before)
        #expect(defaults.data(forKey: CustomTargetStore.defaultsKey) == blobBefore)
    }

    @Test func testBuiltInReadOnlyDeleteIsRefused() throws {
        let (defaults, _) = try seedBuiltIn(into: UserDefaults(suiteName: UUID().uuidString)!)
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let before = store.all
        let blobBefore = defaults.data(forKey: CustomTargetStore.defaultsKey)

        #expect(throws: CustomTargetStore.Refusal.builtInReadOnly(id: "worship-room")) {
            try store.delete(id: "worship-room")
        }

        #expect(store.all.contains { $0.id == "worship-room" })
        #expect(store.all == before)
        #expect(defaults.data(forKey: CustomTargetStore.defaultsKey) == blobBefore)

        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all.contains { $0.id == "worship-room" })
    }

    @Test(arguments: IdealCurveLibrary.builtInIds)
    func testBuiltInReadOnlyEveryBuiltInIdIsRefused(id: String) throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)

        #expect(throws: CustomTargetStore.Refusal.builtInReadOnly(id: id)) {
            try store.rename(id: id, to: "New Name")
        }
        #expect(throws: CustomTargetStore.Refusal.builtInReadOnly(id: id)) {
            try store.update(id: id, curve: revised)
        }
        #expect(throws: CustomTargetStore.Refusal.builtInReadOnly(id: id)) {
            try store.delete(id: id)
        }

        #expect(defaults.object(forKey: CustomTargetStore.defaultsKey) == nil)
    }

    @Test func testBuiltInReadOnlyRefusalMessageIsActionable() {
        let error = CustomTargetStore.Refusal.builtInReadOnly(id: "worship-room")
        #expect(error.errorDescription?.contains("worship-room") == true)
        #expect(error.errorDescription?.contains("duplicate") == true)
    }

    @Test func renameCustomReplacesOnlyLabelAndPersists() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let added = store.add(from: .flat, label: "Room A")

        let renamed = try store.rename(id: added.id, to: "Room A Renamed")

        #expect(renamed?.label == "Room A Renamed")
        #expect(store.all.count == 1)
        #expect(store.all[0].id == added.id)
        #expect(store.all[0].description == added.description)
        #expect(store.all[0].dbOffsets == added.dbOffsets)
        #expect(store.all[0].label == "Room A Renamed")

        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all == store.all)
    }

    @Test func renameUnknownIdIsANoOp() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        store.add(from: .flat, label: "Room A")
        let before = store.all

        let result = try store.rename(id: "does-not-exist", to: "New Name")

        #expect(result == nil)
        #expect(store.all == before)
    }

    @Test func testDuplicateBuiltInCreatesCustomCopy() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults)
        let builtIn = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipRoomId)

        let copy = try store.duplicate(id: IdealCurveLibrary.worshipRoomId)

        #expect(copy != nil)
        #expect(copy!.id.hasPrefix(CustomTargetStore.customIdPrefix))
        #expect(UUID(uuidString: String(copy!.id.dropFirst(CustomTargetStore.customIdPrefix.count))) != nil)
        #expect(copy!.label == "Copy of \(builtIn.label)")
        #expect(copy!.dbOffsets == builtIn.dbOffsets)
        #expect(copy!.freqs == builtIn.freqs)
        #expect(copy!.description == CustomTargetStore.curveDescription)
        #expect(store.all == [copy!])

        let fresh = CustomTargetStore(defaults: defaults)
        #expect(fresh.all == store.all)
    }

    @Test func testDuplicateRepeatedlySuffixesLabels() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let ids = IdGenerator()
        let store = CustomTargetStore(defaults: defaults, makeId: ids.makeId)
        let builtIn = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipRoomId)

        let first = try store.duplicate(id: IdealCurveLibrary.worshipRoomId)
        let second = try store.duplicate(id: IdealCurveLibrary.worshipRoomId)
        let third = try store.duplicate(id: IdealCurveLibrary.worshipRoomId)

        #expect(first?.label == "Copy of \(builtIn.label)")
        #expect(second?.label == "Copy of \(builtIn.label) 2")
        #expect(third?.label == "Copy of \(builtIn.label) 3")
        #expect(first?.id == "id-1")
        #expect(second?.id == "id-2")
        #expect(third?.id == "id-3")
        #expect(Set([first?.label, second?.label, third?.label]).count == 3)
        #expect(first?.dbOffsets == builtIn.dbOffsets)
        #expect(second?.dbOffsets == builtIn.dbOffsets)
        #expect(third?.dbOffsets == builtIn.dbOffsets)
    }

    @Test func testDuplicateCustomCreatesNewCustomCopy() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults)
        let added = store.add(from: revised, label: "Room A")

        let copy = try store.duplicate(id: added.id)

        #expect(copy != nil)
        #expect(copy!.id != added.id)
        #expect(copy!.id.hasPrefix(CustomTargetStore.customIdPrefix))
        #expect(copy!.label == "Copy of Room A")
        #expect(copy!.dbOffsets == revised.dbOffsets)
        #expect(store.all.first { $0.id == added.id } == added)
        #expect(store.all.count == 2)
    }

    @Test func testDuplicateCustomTwiceSuffixesLabel() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)
        let added = store.add(from: .flat, label: "Room A")

        let first = try store.duplicate(id: added.id)
        let second = try store.duplicate(id: added.id)

        #expect(first?.label == "Copy of Room A")
        #expect(second?.label == "Copy of Room A 2")
    }

    @Test func testDuplicateUnknownIdReturnsNilAndDoesNotPersist() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(defaults: defaults, makeId: IdGenerator().makeId)

        let result = try store.duplicate(id: "does-not-exist")

        #expect(result == nil)
        #expect(store.all.isEmpty)
        #expect(defaults.object(forKey: CustomTargetStore.defaultsKey) == nil)
    }

    @Test func testDuplicateBuiltInLoadFailureRethrowsAndDoesNotPersist() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = CustomTargetStore(
            defaults: defaults,
            makeId: IdGenerator().makeId,
            loadBuiltIn: { id in throw IdealCurveLibrary.LoadError.missing(id: id) }
        )

        #expect(throws: IdealCurveLibrary.LoadError.missing(id: "worship-room")) {
            try store.duplicate(id: "worship-room")
        }

        #expect(store.all.isEmpty)
        #expect(defaults.object(forKey: CustomTargetStore.defaultsKey) == nil)
    }

    @Test func testDuplicateDefaultIdUsesCustomColonPrefix() {
        let first = CustomTargetStore.makeDefaultId()
        let second = CustomTargetStore.makeDefaultId()

        #expect(first.hasPrefix("custom:"))
        #expect(second.hasPrefix("custom:"))
        #expect(first != second)
    }
}
