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
    /// Mirrors the Mac's `CUSTOM_PREFIX` in `app/renderer/src/ideal-profiles.ts`.
    public static let customIdPrefix = "custom:"
    private static let copyLabelPrefix = "Copy of "
    private static let firstCopySuffix = 2

    public private(set) var all: [IdealCurve]

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let makeId: () -> String
    @ObservationIgnored private let loadBuiltIn: (String) throws -> IdealCurve
    @ObservationIgnored private let log: (String) -> Void

    public static func makeDefaultId() -> String { customIdPrefix + UUID().uuidString }

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

    /// Typed refusal for operations that would change a built-in curve (#1757).
    public enum Refusal: Error, Equatable, LocalizedError {
        case builtInReadOnly(id: String)

        public var errorDescription: String? {
            switch self {
            case .builtInReadOnly(let id):
                "\"\(id)\" is a built-in target and can't be changed — duplicate it to make an editable copy."
            }
        }
    }

    public init(
        defaults: UserDefaults = .standard,
        makeId: @escaping () -> String = CustomTargetStore.makeDefaultId,
        loadBuiltIn: @escaping (String) throws -> IdealCurve = IdealCurveLibrary.builtIn(id:),
        log: @escaping (String) -> Void = CustomTargetStore.defaultLog
    ) {
        self.defaults = defaults
        self.makeId = makeId
        self.loadBuiltIn = loadBuiltIn
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
    public func update(id: String, curve: IdealCurve) throws -> IdealCurve? {
        try refuseIfBuiltIn(id)
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

    public func delete(id: String) throws {
        try refuseIfBuiltIn(id)
        let before = all.count
        all.removeAll { $0.id == id }
        if all.count != before {
            persist()
        }
    }

    /// Renames a custom curve's label, keeping id, description, freqs and
    /// dbOffsets unchanged. Built-in ids are refused before any lookup, so a
    /// refused call never reaches `persist()`. Name validation (trim / empty
    /// / length cap) is not this slice's concern — see #1759.
    @discardableResult
    public func rename(id: String, to name: String) throws -> IdealCurve? {
        try refuseIfBuiltIn(id)
        guard let index = all.firstIndex(where: { $0.id == id }) else { return nil }
        let old = all[index]
        let renamed = IdealCurve(
            id: old.id,
            label: name,
            description: old.description,
            freqs: old.freqs,
            dbOffsets: old.dbOffsets
        )
        all[index] = renamed
        persist()
        return renamed
    }

    /// Copies a built-in or custom curve into a new editable custom curve
    /// labelled "Copy of <label>" (" 2", " 3", … on repeats). Unknown custom
    /// ids return nil without persisting; a built-in that fails to load rethrows.
    @discardableResult
    public func duplicate(id: String) throws -> IdealCurve? {
        let source: IdealCurve
        if IdealCurveLibrary.builtInIds.contains(id) {
            source = try loadBuiltIn(id)
        } else if let custom = all.first(where: { $0.id == id }) {
            source = custom
        } else {
            return nil
        }
        let copy = IdealCurve(
            id: makeId(),
            label: Self.uniqueCopyLabel(for: source.label, taken: Set(all.map(\.label))),
            description: Self.curveDescription,
            freqs: source.freqs,
            dbOffsets: source.dbOffsets
        )
        all.append(copy)
        persist()
        return copy
    }

    private static func uniqueCopyLabel(for sourceLabel: String, taken: Set<String>) -> String {
        let base = copyLabelPrefix + sourceLabel
        guard taken.contains(base) else { return base }
        var n = firstCopySuffix
        while taken.contains("\(base) \(n)") { n += 1 }
        return "\(base) \(n)"
    }

    private func refuseIfBuiltIn(_ id: String) throws {
        if IdealCurveLibrary.builtInIds.contains(id) {
            throw Refusal.builtInReadOnly(id: id)
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
