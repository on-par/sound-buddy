import Foundation
import Testing
@testable import SoundBuddyKit

@Suite struct ConsoleChipStatusTests {
    @Test func liveIsGreen() {
        let status = ConsoleChipStatus(phase: .live)
        #expect(status == .live)
        #expect(status.tint == .green)
        #expect(status.label == "Live")
        #expect(status.tooltip == nil)
    }

    @Test func degradedIsAmberWithTooManyAppsTooltip() {
        let status = ConsoleChipStatus(phase: .liveDegraded)
        #expect(status == .degraded)
        #expect(status.tint == .amber)
        #expect(status.label == "Degraded")
        #expect(status.tooltip == ConsoleSessionPhase.liveDegraded.statusMessage)
    }

    @Test func reconnectingPhasesAreAmberReconnecting() {
        for phase: ConsoleSessionPhase in [.reconnecting, .connecting, .syncing, .suspended] {
            let status = ConsoleChipStatus(phase: phase)
            #expect(status == .reconnecting, "expected \(phase) to be reconnecting")
            #expect(status.tint == .amber)
            #expect(status.label == "Reconnecting…")
            #expect(status.tooltip == nil)
        }
    }

    @Test func offlinePhasesAreGrey() {
        for phase: ConsoleSessionPhase in [.idle, .noNetwork, .permissionDenied] {
            let status = ConsoleChipStatus(phase: phase)
            #expect(status == .offline, "expected \(phase) to be offline")
            #expect(status.tint == .grey)
            #expect(status.label == "Offline")
            #expect(status.tooltip == nil)
        }
    }

    @Test func everyPhaseMapsToAStatus() {
        let expected: [(ConsoleSessionPhase, ConsoleChipStatus)] = [
            (.idle, .offline),
            (.connecting, .reconnecting),
            (.syncing, .reconnecting),
            (.live, .live),
            (.liveDegraded, .degraded),
            (.reconnecting, .reconnecting),
            (.suspended, .reconnecting),
            (.noNetwork, .offline),
            (.permissionDenied, .offline),
        ]
        for (phase, status) in expected {
            #expect(ConsoleChipStatus(phase: phase) == status)
        }
    }

    @Test func chipHiddenWithoutFlagConsentOrConsole() {
        let console = ConsoleIdentity(name: "FOH", model: "M32R")
        let combinations: [(flag: Bool, consent: Bool, console: ConsoleIdentity?, visible: Bool)] = [
            (false, false, nil, false),
            (false, false, console, false),
            (false, true, nil, false),
            (false, true, console, false),
            (true, false, nil, false),
            (true, false, console, false),
            (true, true, nil, false),
            (true, true, console, true),
        ]

        for combination in combinations {
            let visible = ConsoleChipStatus.isVisible(
                flagEnabled: combination.flag,
                consentGranted: combination.consent,
                console: combination.console
            )
            #expect(visible == combination.visible, "expected \(combination) to be \(combination.visible)")
        }
    }
}
