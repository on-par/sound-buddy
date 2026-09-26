import Foundation

/// The Mac's bundled ideal-EQ profiles (packages/audio-engine/src/profiles/index.ts),
/// shipped inside SoundBuddyKit as ideal-curve.v1 JSON SwiftPM resources so
/// the phone can show the same relative target shapes without a runtime
/// dependency on the Node packages.
public enum IdealCurveLibrary {
    public static let flatId = "flat"
    public static let musicFullRangeId = "music-fullrange"
    public static let worshipServiceId = "worship-service"
    public static let builtInIds = [flatId, musicFullRangeId, worshipServiceId]
    /// Mac LIVE_CAPTURE_DEFAULT_PROFILE_ID.
    public static let liveDefaultId = worshipServiceId
    static let resourcePrefix = "ideal-curve.v1."

    public enum LoadError: Error, Equatable, LocalizedError {
        case missing(id: String)

        public var errorDescription: String? {
            switch self {
            case .missing(let id):
                "Ideal curve \"\(id)\" is missing from the app bundle — reinstall or update Sound Buddy."
            }
        }
    }

    /// Decodes a bundled ideal-curve.v1 JSON resource by id.
    public static func builtIn(id: String) throws -> IdealCurve {
        guard let url = Bundle.module.url(forResource: resourcePrefix + id, withExtension: "json") else {
            throw LoadError.missing(id: id)
        }
        return try JSONDecoder().decode(IdealCurve.self, from: Data(contentsOf: url))
    }

    /// The Analyze screen's live target: worship-service, or flat if the
    /// bundled resource can't be found or decoded — a missing/corrupt
    /// resource degrades the overlay rather than crashing Analyze.
    public static func liveDefault(load: (String) throws -> IdealCurve = IdealCurveLibrary.builtIn(id:)) -> IdealCurve {
        (try? load(liveDefaultId)) ?? .flat
    }
}
