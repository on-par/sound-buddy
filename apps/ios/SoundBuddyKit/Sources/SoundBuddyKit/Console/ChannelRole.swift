import Foundation

/// A first guess at what a scribble-strip feeds, computed purely from its
/// label and weak color/neighbour context (#1783). Additive: new cases are
/// fine; `schemaVersion` only bumps on a breaking rename or removal.
public enum ChannelRole: String, CaseIterable, Codable, Sendable {
    public static let schemaVersion = 1

    case vocal, speech, choir, kick, snare, tom, hiHat, overheads, bass,
         electricGuitar, acousticGuitar, keys, synth, tracks, click, guide,
         playback, roomMic, talkback, unused, unknown

    /// Roles a tracks prefix may wrap ("TBass" → tracks, not bass): vocal,
    /// choir, kick, snare, tom, hiHat, overheads, bass, electricGuitar,
    /// acousticGuitar, keys, synth.
    public var isInstrumentOrVoice: Bool {
        switch self {
        case .vocal, .choir, .kick, .snare, .tom, .hiHat, .overheads, .bass,
             .electricGuitar, .acousticGuitar, .keys, .synth:
            return true
        case .speech, .tracks, .click, .guide, .playback, .roomMic, .talkback, .unused, .unknown:
            return false
        }
    }

    /// vocal, speech, choir — anchors for the people-names context rule.
    public var isVoice: Bool {
        switch self {
        case .vocal, .speech, .choir:
            return true
        case .kick, .snare, .tom, .hiHat, .overheads, .bass, .electricGuitar,
             .acousticGuitar, .keys, .synth, .tracks, .click, .guide,
             .playback, .roomMic, .talkback, .unused, .unknown:
            return false
        }
    }
}

/// A guess's score bucketed for the review screen: high confidence lets a
/// volunteer skip the strip, medium/low asks them to look.
public enum ChannelRoleConfidence: String, Sendable, Equatable {
    case high, medium, low

    public static let highThreshold = 0.8
    public static let mediumThreshold = 0.5
    static let epsilon = 1e-9

    public init(score: Double) {
        if score >= ChannelRoleConfidence.highThreshold - ChannelRoleConfidence.epsilon {
            self = .high
        } else if score >= ChannelRoleConfidence.mediumThreshold - ChannelRoleConfidence.epsilon {
            self = .medium
        } else {
            self = .low
        }
    }
}

/// One strip as the guesser sees it, in console order. `id` is opaque
/// (e.g. "/ch/04/config") and only echoed back — no rule may read it.
public struct ChannelRoleInput: Equatable, Sendable {
    public let id: String
    public let name: String
    public let color: ConsoleChannelColor

    public init(id: String, name: String, color: ConsoleChannelColor) {
        self.id = id
        self.name = name
        self.color = color
    }
}

/// The guesser's verdict for one strip: a role, a 0...1 confidence, a
/// one-line reason, and which rule produced it.
public struct ChannelRoleGuess: Equatable, Sendable {
    public enum Basis: String, Sendable, Equatable {
        case label, context, blank
    }

    public let id: String
    public let name: String
    public let role: ChannelRole
    public let confidence: Double
    public let reason: String
    public let basis: Basis

    public init(id: String, name: String, role: ChannelRole, confidence: Double, reason: String, basis: Basis) {
        self.id = id
        self.name = name
        self.role = role
        self.confidence = confidence
        self.reason = reason
        self.basis = basis
    }

    public var bucket: ChannelRoleConfidence { ChannelRoleConfidence(score: confidence) }
}
