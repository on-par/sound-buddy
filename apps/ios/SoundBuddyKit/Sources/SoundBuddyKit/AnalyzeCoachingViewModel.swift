import Foundation

/// The coaching cards Analyze shows, with stable identity (#1700).
///
/// BandDeviationCoach returns its tips sorted by |deviation| on every
/// refresh, so two visible tips trading magnitude used to swap cards and the
/// stack re-laid out about once a second. This reconciles each new tip list
/// against the cards already shown, keyed by `CoachingEvent.id` (one id per
/// band/tip):
///
/// - a tip that is still present keeps its position; only its value, copy
///   and session time are replaced in place;
/// - tips that are gone leave, and the survivors keep their relative order;
/// - new tips join after the existing cards, in the incoming (most severe
///   first) order;
/// - the stack never holds more than `maxCards`, and continuing cards win
///   over newcomers for those slots.
///
/// Pure value type: AnalyzeModel owns one, and views only render `cards`.
/// It takes plain `[CoachingEvent]`, so stabilizer-driven tips can feed the
/// same API later without changes.
public struct AnalyzeCoachingViewModel: Equatable, Sendable {
    /// The same cap as the coach's (and the stabilizer's) tip set.
    public static let maxCards: Int = BandDeviationCoach.maxEvents

    public private(set) var cards: [CoachingEvent] = []

    public init() {}

    /// Reconciles `events` into `cards` and returns the new card list.
    @discardableResult
    public mutating func update(with events: [CoachingEvent]) -> [CoachingEvent] {
        var latest: [String: CoachingEvent] = [:]
        for event in events where latest[event.id] == nil {
            latest[event.id] = event
        }
        var next = cards.compactMap { latest[$0.id] }
        let kept = Set(next.map(\.id))
        var seen = kept
        for event in events where !seen.contains(event.id) {
            seen.insert(event.id)
            next.append(event)
        }
        cards = Array(next.prefix(Self.maxCards))
        return cards
    }

    /// Forgets the shown cards and their order (a new listening session).
    public mutating func reset() {
        cards = []
    }
}
