import Testing
@testable import SoundBuddyKit

/// A band-deviation event shaped like BandDeviationCoach's output: id keyed
/// by band, the signed deviation in `data`, copy that carries the number.
private func tip(_ band: Band, _ deviationDb: Double, at sessionTime: Double = 0) -> CoachingEvent {
    CoachingEvent(
        id: "\(CoachingEvent.RuleType.bandDeviation.rawValue)-\(band.rawValue)",
        ruleType: .bandDeviation,
        severity: .suggestion,
        band: band,
        message: "\(band.label) is \(abs(deviationDb)) dB \(deviationDb > 0 ? "over" : "under") the target.",
        data: ["deviationDb": .number(deviationDb)],
        source: .phoneMicEstimate,
        sessionTime: sessionTime
    )
}

/// #1700: cards are keyed by tip id so a refresh never re-sorts or recreates
/// the visible stack; only the numbers inside a card change.
@Suite struct AnalyzeCoachingViewModelTests {
    @Test func startsEmpty() {
        let vm = AnalyzeCoachingViewModel()
        #expect(vm.cards.isEmpty)
    }

    @Test func theFirstUpdateShowsTheIncomingOrder() {
        var vm = AnalyzeCoachingViewModel()
        let shown = vm.update(with: [tip(.bass, 7), tip(.presence, -5), tip(.lowMid, 4)])
        #expect(shown.map(\.band) == [.bass, .presence, .lowMid])
        #expect(vm.cards == shown)
    }

    @Test func aKeptCardHoldsItsPositionAndTakesTheNewValue() {
        var vm = AnalyzeCoachingViewModel()
        vm.update(with: [tip(.bass, 7, at: 1), tip(.presence, -5, at: 1)])
        // Presence overtakes Bass: the coach re-sorts by magnitude, the stack must not.
        let shown = vm.update(with: [tip(.presence, -9, at: 2), tip(.bass, 6, at: 2)])
        #expect(shown.map(\.band) == [.bass, .presence])
        #expect(shown.map(\.id) == ["band-deviation-bass", "band-deviation-presence"])
        #expect(shown[0] == tip(.bass, 6, at: 2), "value, copy and time update in place")
        #expect(shown[1] == tip(.presence, -9, at: 2))
    }

    @Test func newTipsJoinAfterTheCardsAlreadyShown() {
        var vm = AnalyzeCoachingViewModel()
        vm.update(with: [tip(.lowMid, 4)])
        let shown = vm.update(with: [tip(.brilliance, -12), tip(.bass, 8), tip(.lowMid, 3.5)])
        #expect(shown.map(\.band) == [.lowMid, .brilliance, .bass], "new tips append in severity order")
    }

    @Test func aDepartedTipLeavesAndTheSurvivorsKeepTheirOrder() {
        var vm = AnalyzeCoachingViewModel()
        vm.update(with: [tip(.bass, 7), tip(.presence, -5), tip(.lowMid, 4)])
        let shown = vm.update(with: [tip(.lowMid, 6), tip(.bass, 5)])
        #expect(shown.map(\.band) == [.bass, .lowMid])
    }

    @Test func aFreedSlotIsTakenByTheNextNewTipAtTheEnd() {
        var vm = AnalyzeCoachingViewModel()
        vm.update(with: [tip(.bass, 7), tip(.presence, -5), tip(.lowMid, 4)])
        let shown = vm.update(with: [tip(.mid, 10), tip(.lowMid, 4), tip(.bass, 7)])
        #expect(shown.map(\.band) == [.bass, .lowMid, .mid])
    }

    @Test func neverShowsMoreThanMaxCards() {
        #expect(AnalyzeCoachingViewModel.maxCards == BandDeviationCoach.maxEvents)
        #expect(AnalyzeCoachingViewModel.maxCards == 3)
        var vm = AnalyzeCoachingViewModel()
        let five = [tip(.bass, 9), tip(.presence, -8), tip(.lowMid, 7), tip(.mid, 6), tip(.brilliance, 5)]
        #expect(vm.update(with: five).map(\.band) == [.bass, .presence, .lowMid])
        // Kept cards win over newcomers when the incoming list is long.
        let shown = vm.update(with: [tip(.mid, 12), tip(.subBass, 11), tip(.lowMid, 7), tip(.bass, 9), tip(.presence, -8)])
        #expect(shown.count == 3)
        #expect(shown.map(\.band) == [.bass, .presence, .lowMid])
    }

    @Test func anEmptyUpdateClearsTheStack() {
        var vm = AnalyzeCoachingViewModel()
        vm.update(with: [tip(.bass, 7)])
        #expect(vm.update(with: []).isEmpty)
        #expect(vm.update(with: [tip(.presence, -5), tip(.bass, 7)]).map(\.band) == [.presence, .bass])
    }

    @Test func resetForgetsTheRememberedOrder() {
        var vm = AnalyzeCoachingViewModel()
        vm.update(with: [tip(.bass, 7), tip(.presence, -5)])
        vm.reset()
        #expect(vm.cards.isEmpty)
        #expect(vm.update(with: [tip(.presence, -9), tip(.bass, 6)]).map(\.band) == [.presence, .bass])
    }

    @Test func randomRefreshesKeepEveryContinuingCardInPlace() {
        var rng = SplitMix64(seed: 1700)
        var vm = AnalyzeCoachingViewModel()
        for step in 0..<500 {
            let before = vm.cards
            let count = Int(rng.next() % 6)
            let bands = Array(Band.allCases.shuffled(using: &rng).prefix(count))
            let incoming = bands.map { tip($0, Double(rng.next() % 200) / 10 - 10, at: Double(step)) }
                .sorted { abs($0.data!["deviationDb"]!.number) > abs($1.data!["deviationDb"]!.number) }
            let shown = vm.update(with: incoming)
            #expect(shown.count <= AnalyzeCoachingViewModel.maxCards)
            #expect(Set(shown.map(\.id)).count == shown.count, "no duplicate cards")
            #expect(shown.allSatisfy { card in incoming.contains(card) }, "every card is a current tip, with its current value")
            let survivors = before.map(\.id).filter { id in shown.contains { $0.id == id } }
            #expect(Array(shown.map(\.id).prefix(survivors.count)) == survivors, "continuing cards keep their order at the top")
        }
    }
}

private struct SplitMix64: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

private extension CoachingEvent.DataValue {
    var number: Double {
        if case let .number(value) = self { return value }
        return 0
    }
}
