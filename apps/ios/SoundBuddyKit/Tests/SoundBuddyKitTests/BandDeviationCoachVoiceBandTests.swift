import Testing
@testable import SoundBuddyKit

/// #1702: in Speech + bed, deviations are level-matched over the voice bands
/// only, so a hot underscore low end cannot drag the voice bands' level match.
@Suite struct BandDeviationCoachVoiceBandTests {
    @Test func levelMatchesOverOnlyTheGivenBands() {
        let coach = BandDeviationCoach(ideal: .flat)
        let levels = BandLevels(db: [
            .subBass: -16, .bass: -18, .lowMid: -30, .mid: -36, .highMid: -30, .presence: -30, .brilliance: -20,
        ])
        let voice = coach.deviations(for: levels, in: ProgramMode.voiceBands)
        #expect(Set(voice.keys) == ProgramMode.voiceBands)
        #expect(voice[.lowMid] == 2)
        #expect(voice[.mid] == -4)
        #expect(voice[.highMid] == 2)
    }

    @Test func allBandsMatchesTheExistingDeviations() {
        let coach = BandDeviationCoach(ideal: .flat)
        let levels = BandLevels(db: [.subBass: -16, .bass: -18, .lowMid: -30, .mid: -36, .highMid: -30, .presence: -30, .brilliance: -20])
        #expect(coach.deviations(for: levels, in: Set(Band.allCases)) == coach.deviations(for: levels))
    }

    @Test func belowTheSignalGateIsEmpty() {
        let coach = BandDeviationCoach(ideal: .flat)
        #expect(coach.deviations(for: .silent, in: ProgramMode.voiceBands).isEmpty)
    }
}
