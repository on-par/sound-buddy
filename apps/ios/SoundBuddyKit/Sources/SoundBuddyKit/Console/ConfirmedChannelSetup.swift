import Foundation

/// Where a saved strip's role came from: the guesser's own guess, left
/// untouched by the volunteer, or a role the volunteer picked/confirmed in
/// the review screen.
public enum ChannelRoleOrigin: String, Codable, Sendable, Equatable {
    case guessed
    case confirmed
}

/// What the channel-setup review's Done button produces, and what #1785
/// persists verbatim: the console it was read from, every strip's final
/// role and where that role came from, the volunteer's room-mic pick (if
/// any), and when it was confirmed. Additive: new fields are fine;
/// `schemaVersion` only bumps on a breaking rename or removal.
public struct ConfirmedChannelSetup: Codable, Equatable, Sendable {
    public static let schemaVersion = 1

    /// One strip as saved: its desk identity plus the role the volunteer
    /// left in place.
    public struct Strip: Codable, Equatable, Sendable {
        public let id: ConsoleStripID
        /// The desk name verbatim — "" is kept, never substituted with a
        /// fallback label.
        public let name: String
        public let color: ConsoleChannelColor
        /// `nil` for bus strips, which have no `/config/source` field.
        public let source: ConsoleInputSource?
        public let role: ChannelRole
        public let origin: ChannelRoleOrigin

        public init(id: ConsoleStripID, name: String, color: ConsoleChannelColor, source: ConsoleInputSource?, role: ChannelRole, origin: ChannelRoleOrigin) {
            self.id = id
            self.name = name
            self.color = color
            self.source = source
            self.role = role
            self.origin = origin
        }
    }

    public let schemaVersion: Int
    public let console: ConsoleIdentity
    /// Every strip, in the inventory's walk order.
    public let strips: [Strip]
    /// `nil` means "None, use this iPad's mic".
    public let roomMic: ConsoleStripID?
    public let confirmedAt: Date

    public init(console: ConsoleIdentity, strips: [Strip], roomMic: ConsoleStripID?, confirmedAt: Date) {
        schemaVersion = ConfirmedChannelSetup.schemaVersion
        self.console = console
        self.strips = strips
        self.roomMic = roomMic
        self.confirmedAt = confirmedAt
    }
}
