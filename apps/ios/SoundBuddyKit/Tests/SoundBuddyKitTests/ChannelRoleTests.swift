import Foundation
import Testing
@testable import SoundBuddyKit

@Suite struct ChannelRoleTests {
    @Test func roleSetIsVersionedAndComplete() {
        #expect(ChannelRole.schemaVersion == 1)
        #expect(ChannelRole.allCases.count == 21)
        let rawValues = Set(ChannelRole.allCases.map(\.rawValue))
        #expect(rawValues.contains("hiHat"))
        #expect(rawValues.contains("roomMic"))
        #expect(rawValues.contains("unused"))
        #expect(rawValues.contains("unknown"))
    }

    @Test func confidenceBucketsUseIssueThresholds() {
        #expect(ChannelRoleConfidence(score: 0.8) == .high)
        #expect(ChannelRoleConfidence(score: 0.79) == .medium)
        #expect(ChannelRoleConfidence(score: 0.5) == .medium)
        #expect(ChannelRoleConfidence(score: 0.49) == .low)
        #expect(ChannelRoleConfidence(score: 0) == .low)
        #expect(ChannelRoleConfidence(score: 1) == .high)
        #expect(ChannelRoleConfidence(score: 0.8 - 1e-12) == .high)
    }

    @Test func guessBucketDerivesFromConfidence() {
        let high = ChannelRoleGuess(id: "/ch/01/config", name: "Kick", role: .kick, confidence: 0.9, reason: "r", basis: .label)
        #expect(high.bucket == .high)

        let medium = ChannelRoleGuess(id: "/ch/02/config", name: "Ryan", role: .vocal, confidence: 0.6, reason: "r", basis: .context)
        #expect(medium.bucket == .medium)

        let low = ChannelRoleGuess(id: "/ch/03/config", name: "MD 1", role: .unknown, confidence: 0, reason: "r", basis: .label)
        #expect(low.bucket == .low)
    }

    @Test func voiceAndInstrumentPartitions() {
        let voiceRoles: Set<ChannelRole> = [.vocal, .speech, .choir]
        for role in ChannelRole.allCases {
            #expect(role.isVoice == voiceRoles.contains(role), "isVoice for \(role)")
        }

        let notInstrumentOrVoice: Set<ChannelRole> = [
            .tracks, .click, .guide, .playback, .roomMic, .talkback, .unused, .unknown, .speech,
        ]
        for role in notInstrumentOrVoice {
            #expect(role.isInstrumentOrVoice == false, "\(role) should not be isInstrumentOrVoice")
        }

        let instrumentOrVoiceRoles: Set<ChannelRole> = [
            .vocal, .choir, .kick, .snare, .tom, .hiHat, .overheads, .bass,
            .electricGuitar, .acousticGuitar, .keys, .synth,
        ]
        for role in instrumentOrVoiceRoles {
            #expect(role.isInstrumentOrVoice == true, "\(role) should be isInstrumentOrVoice")
        }
    }
}
