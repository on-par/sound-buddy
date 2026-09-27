import Foundation
import Observation

/// One selectable microphone (#1594): an audio-session input port, or one of
/// the built-in mic's data sources (bottom / front / back) when the OS
/// exposes them.
public struct MicInputOption: Equatable, Identifiable, Sendable {
    public let portUID: String
    /// The port's data source, when the option picks one; nil for the port
    /// as a whole.
    public let dataSourceID: Int?
    public let name: String

    public init(portUID: String, dataSourceID: Int?, name: String) {
        self.portUID = portUID
        self.dataSourceID = dataSourceID
        self.name = name
    }

    /// Stable across launches: the port UID, plus "#<dataSourceID>" when the
    /// option picks a data source. This is what gets persisted.
    public var id: String {
        dataSourceID.map { "\(portUID)#\($0)" } ?? portUID
    }
}

/// The audio session behind the picker. The app's AVAudioSession adapter is
/// the real one; tests inject a fake, so nothing here needs AVFoundation.
@MainActor
public protocol MicInputSession: AnyObject {
    /// Inputs the OS offers right now (built-in data sources + connected
    /// externals).
    func availableOptions() -> [MicInputOption]
    /// The option id of the input currently routed, when known.
    func activeOptionID() -> String?
    /// Routes `option`, or hands the choice back to the system when nil.
    func apply(_ option: MicInputOption?) throws
}

/// Pure rules for the Settings microphone picker (#1594). A missing preferred
/// input always falls back to the system default. Choosing an input never
/// changes the level math: every input shares the same uncalibrated estimate.
public enum MicInputPolicy {
    /// UserDefaults key for the preferred input's option id.
    public static let defaultsKey = "preferredMicInputID"

    public static let sectionTitle = "Microphone"
    public static let systemDefaultName = "System default"
    /// Settings' honesty copy, replacing the old header badge. Never claims a
    /// calibrated SPL, whichever input is chosen.
    public static let honestyFootnote =
        "Level is an uncalibrated estimate, not dBA. Coaching is relative to the target."

    static let accessibilityPrefix = "settings.mic."
    static let systemDefaultSlug = "system-default"

    /// The preferred input while it is available, else the system default.
    public static func resolve(preferredID: String?, availableIDs: [String], systemDefaultID: String?) -> String? {
        if let preferredID, availableIDs.contains(preferredID) { return preferredID }
        return systemDefaultID
    }

    public static func preferredID(in defaults: UserDefaults) -> String? {
        defaults.string(forKey: defaultsKey)
    }

    /// Stores `id`, or removes the key when nil (system default).
    public static func storePreferredID(_ id: String?, in defaults: UserDefaults) {
        if let id {
            defaults.set(id, forKey: defaultsKey)
        } else {
            defaults.removeObject(forKey: defaultsKey)
        }
    }

    /// "settings.mic.<slug>": the id lowercased, with every run of
    /// non-alphanumerics collapsed to one "-". nil is the system-default row.
    public static func accessibilityIdentifier(for id: String?) -> String {
        guard let id else { return accessibilityPrefix + systemDefaultSlug }
        let slug = id.lowercased()
            .split(whereSeparator: { !($0.isASCII && ($0.isLetter || $0.isNumber)) })
            .joined(separator: "-")
        return accessibilityPrefix + slug
    }

    public static func accessibilityLabel(name: String, isSelected: Bool) -> String {
        isSelected ? "\(name), selected" : name
    }
}

/// Lists inputs, persists the user's choice, and applies it to an injected
/// session (#1594). Settings reads and selects through this; MicCapture calls
/// `applyPreferred()` before it starts the engine.
@MainActor
@Observable
public final class MicInputController {
    public private(set) var options: [MicInputOption] = []
    /// The user's stored choice; nil means the system default.
    public private(set) var preferredID: String?
    /// The input actually in use (the preferred one, or the system default).
    public private(set) var activeID: String?

    private let session: MicInputSession
    private let defaults: UserDefaults

    public init(session: MicInputSession, defaults: UserDefaults = .standard) {
        self.session = session
        self.defaults = defaults
        self.preferredID = MicInputPolicy.preferredID(in: defaults)
    }

    /// The in-use input's name, or "System default" when the route is unknown.
    public var activeName: String {
        options.first { $0.id == activeID }?.name ?? MicInputPolicy.systemDefaultName
    }

    /// Re-reads the inputs. A stored preference whose input is gone is
    /// cleared, so the UI shows the system default.
    public func refresh() {
        options = session.availableOptions()
        let stored = MicInputPolicy.preferredID(in: defaults)
        let ids = options.map(\.id)
        if let stored, !ids.contains(stored) {
            MicInputPolicy.storePreferredID(nil, in: defaults)
            preferredID = nil
        } else {
            preferredID = stored
        }
        activeID = MicInputPolicy.resolve(preferredID: preferredID, availableIDs: ids, systemDefaultID: session.activeOptionID())
    }

    /// Chooses `id` (nil = system default): persists it and routes it. An
    /// input that vanished or that the session refuses leaves the system
    /// default in place.
    public func select(_ id: String?) {
        options = session.availableOptions()
        let option = id.flatMap { id in options.first { $0.id == id } }
        do {
            try session.apply(option)
            MicInputPolicy.storePreferredID(option?.id, in: defaults)
            preferredID = option?.id
        } catch {
            MicInputPolicy.storePreferredID(nil, in: defaults)
            preferredID = nil
        }
        activeID = MicInputPolicy.resolve(preferredID: preferredID, availableIDs: options.map(\.id), systemDefaultID: session.activeOptionID())
    }

    /// Routes the stored preference before capture starts; a missing input
    /// resets to the system default. A refusal keeps the stored preference
    /// (the device may simply be busy) and capture runs on the default.
    public func applyPreferred() {
        refresh()
        let option = preferredID.flatMap { id in options.first { $0.id == id } }
        let applied = (try? session.apply(option)) != nil
        activeID = MicInputPolicy.resolve(
            preferredID: applied ? preferredID : nil,
            availableIDs: options.map(\.id),
            systemDefaultID: session.activeOptionID()
        )
    }
}
