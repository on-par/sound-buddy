import Foundation
import Testing
@testable import SoundBuddyKit

/// #1708: prove the raw mic path. The rule, the readout copy, the omni
/// preference and the debug launch options are pure and tested here; the
/// app reads the real AVAudioSession / input node values into them.
private func raw(
    mode: String = MicSessionDiagnostics.measurementMode,
    voiceProcessing: Bool = false,
    agc: Bool? = false
) -> MicSessionDiagnostics {
    MicSessionDiagnostics(
        category: "AVAudioSessionCategoryRecord",
        mode: mode,
        inputPortType: "MicrophoneBuiltIn",
        inputPortName: "iPad Microphone",
        dataSource: "Front",
        polarPattern: MicPolarPattern.omnidirectional.rawValue,
        sampleRate: 48_000,
        isVoiceProcessingEnabled: voiceProcessing,
        isVoiceProcessingAGCEnabled: agc,
        isInputGainSettable: true
    )
}

@Suite struct MicSessionDiagnosticsTests {
    @Test func measurementModeWithVoiceProcessingAndAGCOffIsRaw() {
        let d = raw()
        #expect(d.isRawMeasurement)
        #expect(d.processingReasons.isEmpty)
        #expect(MicSessionDiagnostics.measurementMode == "AVAudioSessionModeMeasurement")
    }

    @Test func aDifferentModeIsProcessedAndSaysSo() {
        let d = raw(mode: "AVAudioSessionModeVoiceChat")
        #expect(!d.isRawMeasurement)
        #expect(d.processingReasons == [.modeNotMeasurement("VoiceChat")])
        #expect(d.statusLine == "Mic: Processed ⚠ (mode VoiceChat, not Measurement)")
    }

    @Test func voiceProcessingOnIsProcessedAndSaysSo() {
        let d = raw(voiceProcessing: true)
        #expect(!d.isRawMeasurement)
        #expect(d.processingReasons == [.voiceProcessingOn])
        #expect(d.statusLine == "Mic: Processed ⚠ (voice processing on)")
    }

    @Test func agcOnIsProcessedAndSaysSo() {
        let d = raw(agc: true)
        #expect(!d.isRawMeasurement)
        #expect(d.processingReasons == [.agcOn])
        #expect(d.statusLine == "Mic: Processed ⚠ (AGC on)")
    }

    @Test func unavailableAGCDoesNotCountAsProcessing() {
        #expect(raw(agc: nil).isRawMeasurement)
    }

    @Test func everyFlippedConditionIsNamedInOrder() {
        let d = raw(mode: "AVAudioSessionModeDefault", voiceProcessing: true, agc: true)
        #expect(d.processingReasons == [.modeNotMeasurement("Default"), .voiceProcessingOn, .agcOn])
        #expect(d.statusLine == "Mic: Processed ⚠ (mode Default, not Measurement; voice processing on; AGC on)")
    }

    @Test func theRawStatusLineAndDetails() {
        let d = raw()
        #expect(d.statusLine == "Mic: Raw measurement ✓")
        #expect(d.details.map(\.label) == ["Mode", "Category", "Port", "Data source", "Polar pattern", "Sample rate", "Voice processing", "AGC", "Input gain"])
        let values = Dictionary(uniqueKeysWithValues: d.details.map { ($0.label, $0.value) })
        #expect(values["Mode"] == "Measurement")
        #expect(values["Category"] == "Record")
        #expect(values["Port"] == "iPad Microphone (MicrophoneBuiltIn)")
        #expect(values["Data source"] == "Front")
        #expect(values["Polar pattern"] == "Omnidirectional")
        #expect(values["Sample rate"] == "48 kHz")
        #expect(values["Voice processing"] == "Off")
        #expect(values["AGC"] == "Off")
        #expect(values["Input gain"] == "Settable")
    }

    @Test func missingRouteDetailsReadAsDashesAndOddRatesKeepADecimal() {
        let d = MicSessionDiagnostics(
            category: "AVAudioSessionCategoryRecord", mode: MicSessionDiagnostics.measurementMode,
            inputPortType: nil, inputPortName: nil, dataSource: nil, polarPattern: nil,
            sampleRate: 44_100, isVoiceProcessingEnabled: false, isVoiceProcessingAGCEnabled: nil,
            isInputGainSettable: false
        )
        let values = Dictionary(uniqueKeysWithValues: d.details.map { ($0.label, $0.value) })
        #expect(values["Port"] == "—")
        #expect(values["Data source"] == "—")
        #expect(values["Polar pattern"] == "—")
        #expect(values["Sample rate"] == "44.1 kHz")
        #expect(values["AGC"] == "Unavailable")
        #expect(values["Input gain"] == "Fixed")
    }

    @Test func theLogLineCarriesTheVerdictAndTheKeyValues() {
        let line = raw().logLine
        #expect(line.hasPrefix("mic raw=true"))
        #expect(line.contains("mode=Measurement"))
        #expect(line.contains("vp=false"))
        #expect(line.contains("polar=Omnidirectional"))
        #expect(line.contains("rate=48000"))
    }
}

@Suite struct MicPolarPatternPolicyTests {
    private let front = MicDataSource(id: 1, name: "Front", supportedPolarPatterns: [.cardioid, .subcardioid], selectedPolarPattern: .cardioid)
    private let bottom = MicDataSource(id: 2, name: "Bottom", supportedPolarPatterns: [.omnidirectional, .cardioid], selectedPolarPattern: .cardioid)
    private let back = MicDataSource(id: 3, name: "Back", supportedPolarPatterns: [.omnidirectional], selectedPolarPattern: .omnidirectional)

    @Test func theSelectedSourceSwitchesToOmniWhenItOffersIt() {
        #expect(MicPolarPatternPolicy.choice(sources: [front, bottom], selectedID: 2, userPickedDataSource: false)
            == MicPolarChoice(dataSourceID: 2, pattern: .omnidirectional))
    }

    @Test func aSelectedSourceAlreadyOmniNeedsNoChange() {
        #expect(MicPolarPatternPolicy.choice(sources: [front, back], selectedID: 3, userPickedDataSource: false) == nil)
    }

    @Test func aSpeechTunedSelectedSourceGivesWayToAnOmniSource() {
        #expect(MicPolarPatternPolicy.choice(sources: [front, bottom], selectedID: 1, userPickedDataSource: false)
            == MicPolarChoice(dataSourceID: 2, pattern: .omnidirectional))
    }

    @Test func noOmniAnywhereLeavesTheRouteAlone() {
        #expect(MicPolarPatternPolicy.choice(sources: [front], selectedID: 1, userPickedDataSource: false) == nil)
        #expect(MicPolarPatternPolicy.choice(sources: [], selectedID: nil, userPickedDataSource: false) == nil)
    }

    @Test func aUserPickedDataSourceIsNeverOverridden() {
        #expect(MicPolarPatternPolicy.choice(sources: [front, bottom], selectedID: 1, userPickedDataSource: true) == nil)
    }

    @Test func polarPatternRawValuesMatchAVAudioSession() {
        #expect(MicPolarPattern.omnidirectional.rawValue == "Omnidirectional")
        #expect(MicPolarPattern.cardioid.rawValue == "Cardioid")
        #expect(MicPolarPattern.subcardioid.rawValue == "Subcardioid")
        #expect(MicPolarPattern.stereo.rawValue == "Stereo")
    }
}

@Suite struct DebugLaunchOptionsTests {
    @Test func demoSourcesSkipTheMicPrompt() {
        #expect(DebugLaunchOptions.skipsMicPermissionPrompt(["app", "-coachingDemo"]))
        #expect(DebugLaunchOptions.skipsMicPermissionPrompt(["app", "-speechBedDemo"]))
        #expect(DebugLaunchOptions.skipsMicPermissionPrompt(["app", "-skipMicPrompt"]))
        #expect(!DebugLaunchOptions.skipsMicPermissionPrompt(["app"]))
        #expect(!DebugLaunchOptions.skipsMicPermissionPrompt(["app", "-targetEditDemo"]), "edit demo alone still uses the real mic path")
    }

    @Test func settingsCanOpenOnLaunch() {
        #expect(DebugLaunchOptions.opensSettings(["app", "-openSettings"]))
        #expect(!DebugLaunchOptions.opensSettings(["app", "-coachingDemo"]))
    }

    @Test func theSkippedPromptAlwaysGrants() async {
        #expect(await PreGrantedMicPermission().request())
    }
}
