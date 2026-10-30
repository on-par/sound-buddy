import Foundation
import Observation

/// Settings > Console (beta)'s "Channel setup" block (#1797): the
/// `ChannelSetupCopy` / `ChannelSetupRecheckCopy` idiom.
public enum ChannelSetupSettingsCopy {
    public static let header = "Channel setup"
    public static let empty = "No channel setup yet"
    public static let redo = "Redo setup"
    public static let forget = "Forget this console"

    public static func forgetTitle(consoleName: String) -> String {
        "Forget \(consoleName)?"
    }

    public static let forgetMessage = "Its saved channel setup is removed. Next time you connect, Sound Buddy offers setup again."
    public static let forgetConfirm = "Forget"

    /// Day/month/year only, no time — a named style, not a magic number.
    static func dateText(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: timeZone))
    }

    public static func confirmedOn(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        "Confirmed \(dateText(date, locale: locale, timeZone: timeZone))"
    }

    /// The console's own name, or its model when the name is "" — never a
    /// label beyond the model.
    public static func displayName(_ console: ConsoleIdentity) -> String {
        console.name.isEmpty ? console.model : console.name
    }
}

/// One saved-setup row for the Channel setup list: the console's display
/// name, the model and confirmed date, and the combined accessibility
/// label VoiceOver reads for the whole row.
public struct ChannelSetupSettingsRow: Equatable, Sendable, Identifiable {
    public let console: ConsoleIdentity
    public let confirmedAt: Date
    public let title: String
    public let detail: String
    public let accessibilityLabel: String

    public var id: String { ChannelSetupStore.key(for: console) }

    public init(setup: ConfirmedChannelSetup, locale: Locale = .current, timeZone: TimeZone = .current) {
        console = setup.console
        confirmedAt = setup.confirmedAt
        title = ChannelSetupSettingsCopy.displayName(setup.console)
        detail = "\(setup.console.model) · \(ChannelSetupSettingsCopy.confirmedOn(setup.confirmedAt, locale: locale, timeZone: timeZone))"
        let dateText = ChannelSetupSettingsCopy.dateText(setup.confirmedAt, locale: locale, timeZone: timeZone)
        accessibilityLabel = "\(title), \(setup.console.model), channel setup confirmed \(dateText)"
    }
}

/// Settings > Console (beta)'s "Channel setup" block (#1797): the saved
/// setup (name, model, confirmed date) per console, with Redo setup and
/// Forget this console. Read-only — only ever reads `ChannelSetupStore`
/// and calls the injected `forget` closure (`ChannelSetupRecheck.forget`),
/// never a console directly. Gated on the `console` feature flag plus
/// consent (`isSectionVisible`); the view hides the whole block when either
/// is false.
@MainActor
@Observable
public final class ChannelSetupSettingsModel {
    @ObservationIgnored private let setupStore: ChannelSetupStore
    @ObservationIgnored private let forgetAction: @MainActor (ConsoleIdentity) -> Void
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone

    public private(set) var rows: [ChannelSetupSettingsRow] = []

    public init(
        setupStore: ChannelSetupStore,
        forget: @escaping @MainActor (ConsoleIdentity) -> Void,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.setupStore = setupStore
        forgetAction = forget
        self.locale = locale
        self.timeZone = timeZone
        refresh()
    }

    public static func isSectionVisible(flagEnabled: Bool, consentGranted: Bool) -> Bool {
        flagEnabled && consentGranted
    }

    public func refresh() {
        rows = setupStore.savedConsoles.compactMap { console in
            guard case let .found(saved) = setupStore.setup(for: console) else { return nil }
            return ChannelSetupSettingsRow(setup: saved.setup, locale: locale, timeZone: timeZone)
        }
    }

    public func forget(_ console: ConsoleIdentity) {
        forgetAction(console)
        refresh()
    }
}
