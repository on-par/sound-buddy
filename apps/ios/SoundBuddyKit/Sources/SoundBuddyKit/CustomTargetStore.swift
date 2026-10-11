import Foundation
import Observation
import os

/// Persisted CRUD for user-shaped target curves (#1756). Custom curves live
/// only in `AnalyzeModel.sessionCustomTarget` today and are lost on relaunch;
/// this store gives them a durable, injected-UserDefaults-backed home behind
/// a schema-versioned envelope, independent of `IdealCurve`'s own contract
/// version. Same injected-dependencies idiom as `ConsoleConsentStore`.
@Observable
public final class CustomTargetStore {
    public static let defaultsKey = "customTargetCurves"
    /// Version of the persisted envelope — not IdealCurve's own contract version.
    public static let schemaVersion = 1
    /// Description stamped on every stored custom curve.
    public static let curveDescription = "Custom target shaped on this device."

    public private(set) var all: [IdealCurve]

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let makeId: () -> String
    @ObservationIgnored private let log: (String) -> Void

    public static func makeDefaultId() -> String { "custom-" + UUID().uuidString }

    public static func defaultLog(_ message: String) {
        logger.error("\(message, privacy: .public)")
    }

    private static let logger = Logger(subsystem: "com.soundbuddy.ios", category: "custom-targets")

    private struct Envelope: Codable {
        let schemaVersion: Int
        let curves: [IdealCurve]
    }

    private enum DecodeError: Error {
        case notData
        case unsupportedSchemaVersion(Int)
    }

    public init(
        defaults: UserDefaults = .standard,
        makeId: @escaping () -> String = CustomTargetStore.makeDefaultId,
        log: @escaping (String) -> Void = CustomTargetStore.defaultLog
    ) {
        self.defaults = defaults
        self.makeId = makeId
        self.log = log

        guard let raw = defaults.object(forKey: Self.defaultsKey) else {
            all = []
            return
        }

        do {
            all = try Self.decode(raw)
        } catch {
            defaults.removeObject(forKey: Self.defaultsKey)
            log("Dropped unreadable custom target curves (\(error)) — starting with an empty list; reshape and save your curves again.")
            all = []
        }
    }

    private static func decode(_ raw: Any) throws -> [IdealCurve] {
        guard let data = raw as? Data else { throw DecodeError.notData }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.schemaVersion == Self.schemaVersion else {
            throw DecodeError.unsupportedSchemaVersion(envelope.schemaVersion)
        }
        return envelope.curves
    }

    @discardableResult
    public func add(from curve: IdealCurve, label: String) -> IdealCurve {
        let added = IdealCurve(
            id: makeId(),
            label: label,
            description: Self.curveDescription,
            freqs: curve.freqs,
            dbOffsets: curve.dbOffsets
        )
        all.append(added)
        persist()
        return added
    }

    @discardableResult
    public func update(id: String, curve: IdealCurve) -> IdealCurve? {
        guard let index = all.firstIndex(where: { $0.id == id }) else { return nil }
        let old = all[index]
        let updated = IdealCurve(
            id: old.id,
            label: old.label,
            description: old.description,
            freqs: curve.freqs,
            dbOffsets: curve.dbOffsets
        )
        all[index] = updated
        persist()
        return updated
    }

    public func delete(id: String) {
        let before = all.count
        all.removeAll { $0.id == id }
        if all.count != before {
            persist()
        }
    }

    private func persist() {
        do {
            let data = try JSONEncoder().encode(Envelope(schemaVersion: Self.schemaVersion, curves: all))
            defaults.set(data, forKey: Self.defaultsKey)
        } catch {
            log("Could not save custom target curves (\(error)) — the change will be lost on relaunch; try reshaping and saving again.")
        }
    }
}
