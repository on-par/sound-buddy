import SoundBuddyKit
import SwiftUI
#if canImport(UIKit)
import AVFAudio
import UIKit
#endif

/// The P0 Analyze screen: a console-style RTA (with its dashed ideal-EQ
/// target and legend), the short coaching stack, the overall level readout
/// (an estimated dB, unit drawn tiny). Always listening while
/// on screen in the foreground — no Start/Stop control; lifecycle events go
/// to the model.
/// Pure rendering — every decision lives in AnalyzeModel (SoundBuddyKit),
/// which is where the tests are.
///
/// portrait: header + RTA + coaching; landscape: RTA-first with a coaching
/// peek (#1548). AnalyzeLayout (SoundBuddyKit) decides portrait vs landscape
/// and the peek state; this view only renders. Problem markers pulse on the
/// RTA in both layouts (#1554). Tapping the Target legend (or its pencil)
/// enters an in-place target-edit mode: an "Editing target" chip with
/// Cancel/Done takes the legend's place in the band under the RTA, and the RTA
/// stays on screen — no pushed view (#1558). The header / landscape strip
/// always keeps the listening indicator and the band keeps one height, so the
/// RTA never moves when editing starts or ends (#1565). While editing, a row
/// of preset pills (Flat / Music fullrange / Worship service) sits under the
/// legend band; tapping one seeds the draft from that bundled curve (#1560).
/// While editing, problem markers hide and the landscape coaching peek stays
/// closed, so neither overlay collides with the handles or the chip (#1562).
///
/// A gear button beside the level readout (end of the landscape strip) opens
/// the Settings sheet (#1591). Its keep-awake toggle (#1584): while on (the
/// default, persisted) and the scene is active, auto-lock is off; leaving the
/// foreground always restores it. KeepAwakePolicy decides; this view owns the
/// stored preference and applies it. Its Microphone section (#1594) picks the
/// input and carries the honesty copy that used to be a header badge;
/// choosing an input restarts listening on the new route.
///
/// TODO(ipad): the layout is single-column; switch the RTA and coaching
/// stack side by side on a regular horizontal size class.
struct AnalyzeView: View {
    let model: AnalyzeModel
    let keepAwake: KeepAwakeController
    let micInputs: MicInputController
    @Environment(\.scenePhase) private var scenePhase
    @State private var coachingPeekOpen = false
    @State private var settingsOpen = false
    @AppStorage(KeepAwakePolicy.defaultsKey) private var keepAwakeEnabled = KeepAwakePolicy.defaultValue

    var body: some View {
        GeometryReader { proxy in
            let layout = AnalyzeLayout(width: proxy.size.width, height: proxy.size.height)
            content(for: layout, proxy: proxy)
                .onChange(of: layout) { _, _ in coachingPeekOpen = false }
                .onChange(of: model.isEditingTarget) { _, editing in
                    coachingPeekOpen = AnalyzeLayout.peekOpen(afterEditingChange: editing, wasOpen: coachingPeekOpen)
                }
        }
        .padding(Layout.screenPadding)
        .background(Palette.background.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .sheet(isPresented: $settingsOpen) {
            SettingsView(keepAwakeEnabled: $keepAwakeEnabled, micInputs: micInputs) { id in
                micInputs.select(id)
                Task { await model.restartListening() }
            }
        }
        .task { await model.appear() }
        .onAppear { applyKeepAwake() }
        .onDisappear {
            model.disappear()
            keepAwake.release()
        }
        .onChange(of: keepAwakeEnabled) { _, _ in applyKeepAwake() }
        // No background audio mode in P0: release the mic when the app leaves
        // the foreground instead of letting the OS cut the engine, and pick it
        // back up on return. .inactive (permission alert, Control Center) is
        // deliberately ignored.
        .onChange(of: scenePhase) { _, phase in
            applyKeepAwake()
            switch phase {
            case .background: model.enterBackground()
            case .active: Task { await model.enterForeground() }
            default: break
            }
        }
        #if canImport(UIKit)
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willTerminateNotification)) { _ in
            model.terminate()
        }
        // Belt and braces: scenePhase also reports .inactive, but never leave
        // auto-lock disabled once the app starts to leave the foreground.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            keepAwake.release()
        }
        // An external mic unplugged (or a new one plugged in) while
        // listening (#1601): fall back to the system default and keep going
        // on the new route instead of leaving a dead engine.
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { note in
            if micInputs.routeChanged(MicRouteChange(notification: note)) {
                Task { await model.restartListening() }
            }
        }
        #endif
    }

    private func applyKeepAwake() {
        keepAwake.apply(keepAwake: keepAwakeEnabled, isSceneActive: scenePhase == .active)
    }

    @ViewBuilder
    private func content(for layout: AnalyzeLayout, proxy: GeometryProxy) -> some View {
        switch layout {
        case .portrait: portraitBody
        case .landscape: landscapeBody(proxy: proxy)
        }
    }

    private var portraitBody: some View {
        VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
            header
            VStack(alignment: .leading, spacing: Layout.legendSpacing) {
                RTAView(
                    model: model,
                    showsProblemMarkers: AnalyzeLayout.portrait.showsProblemMarkers(isEditingTarget: model.isEditingTarget)
                )
                if AnalyzeLayout.portrait.targetControlsUnderRTA {
                    TargetControlsBand(model: model, onEdit: beginTargetEdit)
                }
            }
            CoachingStackView(model: model)
            Spacer(minLength: 0)
            StatusMessageView(model: model)
        }
    }

    private func beginTargetEdit() {
        withAnimation(.snappy) { model.beginTargetEdit() }
    }

    private func landscapeBody(proxy: GeometryProxy) -> some View {
        VStack(spacing: Layout.landscapeSpacing) {
            landscapeStrip
            RTAView(
                model: model,
                fillsHeight: true,
                showsProblemMarkers: AnalyzeLayout.landscape.showsProblemMarkers(isEditingTarget: model.isEditingTarget)
            )
            if AnalyzeLayout.landscape.targetControlsUnderRTA {
                TargetControlsBand(model: model, onEdit: beginTargetEdit)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            StatusMessageView(model: model)
            CoachingPeekHandle(model: model, isOpen: $coachingPeekOpen)
        }
        .overlay(alignment: .bottom) {
            if coachingPeekOpen {
                CoachingPeekPanel(
                    model: model,
                    isOpen: $coachingPeekOpen,
                    maxHeight: proxy.size.height * Layout.peekMaxHeightFraction
                )
            }
        }
    }

    private var landscapeStrip: some View {
        HStack(spacing: Layout.landscapeStripSpacing) {
            ListeningIndicator(state: model.state)
            Spacer()
            OverallLevelReadout(model: model, font: .headline.monospacedDigit())
            SettingsButton { settingsOpen = true }
        }
        .lineLimit(1)
    }

    /// Brand first: the Mac icon's mark and "Sound Buddy", with the Analyze
    /// section label and listening status beneath; the level readout and the
    /// settings gear stay on the right.
    private var header: some View {
        HStack(alignment: .center, spacing: Layout.brandSpacing) {
            Image("BrandMark")
                .resizable()
                .frame(width: Layout.brandMarkSize, height: Layout.brandMarkSize)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Layout.headerSpacing) {
                Text("Sound Buddy")
                    .font(.title2.weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(Layout.titleMinScale)
                    .accessibilityAddTraits(.isHeader)
                HStack(spacing: Layout.indicatorSpacing) {
                    Text("Analyze")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.accent)
                    ListeningIndicator(state: model.state)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: Layout.headerSpacing) {
                OverallLevelReadout(model: model, font: .title2.weight(.bold).monospacedDigit())
                SettingsButton { settingsOpen = true }
            }
        }
    }
}

/// The overall level readout: the estimated level large in `font`, with a
/// tiny "dB" beside it (omitted with the "—" dash). Shared by the portrait
/// header and the landscape status strip so the accessibility label stays
/// identical in both.
private struct OverallLevelReadout: View {
    let model: AnalyzeModel
    let font: Font

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Layout.levelUnitSpacing) {
            Text(model.overallLevelNumberText)
                .font(font)
            if model.overallDb != nil {
                Text(AnalyzeModel.overallLevelUnit)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Palette.secondaryText)
            }
        }
        .foregroundStyle(model.overallDb == nil ? Palette.secondaryText : Color.primary)
        .lineLimit(1)
        .transaction { $0.animation = nil }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Overall level \(model.overallLevelText), phone mic estimate")
    }
}

/// Gear chip beside the level readout that opens the Settings sheet (#1591).
/// Shared by the portrait header and the landscape status strip.
private struct SettingsButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "gearshape")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, Layout.badgePaddingH)
                .padding(.vertical, Layout.badgePaddingV)
                .background(Palette.surface, in: Capsule())
                .foregroundStyle(Palette.secondaryText)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
        .accessibilityIdentifier("analyze.settings")
    }
}

/// The Settings sheet (#1591): the keep-awake preference (#1584) and the
/// microphone picker with the honesty copy (#1594). The keep-awake binding is
/// AnalyzeView's @AppStorage, so flipping it here re-applies keep-awake
/// through AnalyzeView's onChange. `onSelectMic` persists and routes the
/// choice (nil = system default) and restarts listening.
private struct SettingsView: View {
    @Binding var keepAwakeEnabled: Bool
    let micInputs: MicInputController
    let onSelectMic: (String?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(KeepAwakePolicy.accessibilityLabel, isOn: $keepAwakeEnabled)
                        .tint(Palette.accent)
                        .accessibilityLabel(KeepAwakePolicy.accessibilityLabel)
                        .accessibilityValue(KeepAwakePolicy.accessibilityValue(keepAwake: keepAwakeEnabled))
                        .accessibilityIdentifier("settings.keepAwake")
                } footer: {
                    Text("Stops the screen from locking while Analyze is open. Auto-lock always returns when you leave the app.")
                }
                .listRowBackground(Palette.surface)

                Section {
                    LabeledContent("In use", value: micInputs.activeName)
                        .accessibilityIdentifier("settings.mic.active")
                    MicInputRow(name: MicInputPolicy.systemDefaultName, id: nil, isSelected: micInputs.preferredID == nil, onSelect: onSelectMic)
                    ForEach(micInputs.options) { option in
                        MicInputRow(name: option.name, id: option.id, isSelected: micInputs.preferredID == option.id, onSelect: onSelectMic)
                    }
                } header: {
                    Text(MicInputPolicy.sectionTitle)
                } footer: {
                    Text(MicInputPolicy.honestyFootnote)
                        .accessibilityIdentifier("settings.mic.honesty")
                }
                .listRowBackground(Palette.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Palette.accent)
                        .accessibilityIdentifier("settings.done")
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear { micInputs.refresh() }
        #if canImport(UIKit)
        // A mic plugged in or pulled while the sheet is up.
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { _ in
            micInputs.refresh()
        }
        #endif
    }
}

/// One microphone choice in Settings: the name with a checkmark when chosen.
private struct MicInputRow: View {
    let name: String
    /// nil is the system-default row.
    let id: String?
    let isSelected: Bool
    let onSelect: (String?) -> Void

    var body: some View {
        Button { onSelect(id) } label: {
            HStack {
                Text(name)
                    .foregroundStyle(Color.primary)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Palette.accent)
                }
            }
        }
        .accessibilityLabel(MicInputPolicy.accessibilityLabel(name: name, isSelected: isSelected))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(MicInputPolicy.accessibilityIdentifier(for: id))
    }
}

// MARK: - Coaching peek (landscape)

/// The thin bottom bar that opens/closes the landscape coaching peek: tap or
/// swipe up to open, tap or swipe down to close.
private struct CoachingPeekHandle: View {
    let model: AnalyzeModel
    @Binding var isOpen: Bool

    var body: some View {
        let enabled = AnalyzeLayout.coachingPeekEnabled(isEditingTarget: model.isEditingTarget)
        HStack(spacing: Layout.landscapeStripSpacing) {
            Text(AnalyzeLayout.coachingPeekLabel(count: model.coaching.count))
                .font(.footnote.weight(.semibold))
            Image(systemName: isOpen ? "chevron.down" : "chevron.up")
                .font(.footnote.weight(.semibold))
        }
        .frame(maxWidth: .infinity)
        .frame(height: Layout.peekHandleHeight)
        .background(Palette.surface, in: Capsule())
        .foregroundStyle(Palette.secondaryText)
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.snappy) { isOpen.toggle() } }
        .gesture(
            DragGesture(minimumDistance: Layout.peekDragMinDistance)
                .onEnded { value in
                    withAnimation(.snappy) {
                        isOpen = AnalyzeLayout.peekOpen(afterDrag: value.translation.height, wasOpen: isOpen)
                    }
                }
        )
        .opacity(enabled ? 1 : Layout.peekDisabledOpacity)
        .allowsHitTesting(enabled)
        .disabled(!enabled)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Coaching")
        .accessibilityValue("\(model.coaching.count) hints")
        .accessibilityHint(
            enabled
                ? (isOpen ? "Hides the coaching cards" : "Shows the coaching cards")
                : "Unavailable while editing the target"
        )
    }
}

/// The landscape coaching overlay: the same CoachingStackView cards as
/// portrait, scrollable so they fit on a short landscape phone, closed by
/// the same handle repeated at the panel's bottom.
private struct CoachingPeekPanel: View {
    let model: AnalyzeModel
    @Binding var isOpen: Bool
    let maxHeight: CGFloat

    var body: some View {
        VStack(spacing: Layout.landscapeSpacing) {
            ScrollView {
                CoachingStackView(model: model)
            }
            .frame(maxHeight: maxHeight)
            CoachingPeekHandle(model: model, isOpen: $isOpen)
        }
        .padding(Layout.cardPadding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
    }
}

/// Small status line beside the Analyze label — the only listening chrome.
private struct ListeningIndicator: View {
    let state: AnalyzeModel.State

    var body: some View {
        HStack(spacing: Layout.indicatorSpacing) {
            Circle()
                .fill(state == .live ? Palette.live : Palette.secondaryText)
                .frame(width: Layout.indicatorDot, height: Layout.indicatorDot)
            Text(text)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.secondaryText)
        }
        .accessibilityElement(children: .combine)
    }

    private var text: String {
        switch state {
        case .live: "Listening"
        case .requestingPermission: "Starting microphone…"
        case .idle: "Paused"
        case .micDenied: "Microphone off"
        case .failed: "Microphone unavailable"
        }
    }
}

// MARK: - Target legend

/// The band directly under the RTA: the Target legend when idle, the
/// "Editing target" chip while `model.isEditingTarget`, plus a row of preset
/// pills (#1560) that only that chip row needs. Every row stays laid out
/// (only the inactive ones are hidden), so the band is always the same total
/// height and nothing around it shifts on toggle (#1565).
private struct TargetControlsBand: View {
    let model: AnalyzeModel
    let onEdit: () -> Void

    var body: some View {
        let editing = model.isEditingTarget
        VStack(alignment: .leading, spacing: Layout.legendSpacing) {
            ZStack(alignment: .leading) {
                TargetLegend(text: model.targetLegendText, onEdit: onEdit)
                    .opacity(editing ? 0 : 1)
                    .allowsHitTesting(!editing)
                    .accessibilityHidden(editing)
                TargetEditChip(model: model)
                    .opacity(editing ? 1 : 0)
                    .allowsHitTesting(editing)
                    .accessibilityHidden(!editing)
            }
            TargetPresetStrip(model: model)
                .opacity(editing ? 1 : 0)
                .allowsHitTesting(editing)
                .accessibilityHidden(!editing)
        }
    }
}

/// A short dashed swatch plus "Target · <label> (auto)", under the RTA.
/// Tapping the row (or its pencil) enters in-place target-edit mode (#1558).
private struct TargetLegend: View {
    let text: String
    let onEdit: () -> Void

    var body: some View {
        Button(action: onEdit) {
            HStack(spacing: Layout.legendSwatchGap) {
                Path { path in
                    let midY = Layout.legendSwatchSize.height / 2
                    path.move(to: CGPoint(x: 0, y: midY))
                    path.addLine(to: CGPoint(x: Layout.legendSwatchSize.width, y: midY))
                }
                .stroke(Palette.target, style: StrokeStyle(lineWidth: Layout.legendSwatchLineWidth, dash: Layout.legendSwatchDash))
                .frame(width: Layout.legendSwatchSize.width, height: Layout.legendSwatchSize.height)
                Text(text)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.secondaryText)
                Image(systemName: "pencil")
                    .font(.caption)
                    .foregroundStyle(Palette.secondaryText)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
        .accessibilityHint("Edits the target curve")
        .accessibilityIdentifier("analyze.targetLegend")
    }
}

/// The "Editing target" chip (Cancel / Done) shown in place of the legend,
/// under the RTA, while `model.isEditingTarget` (#1558, #1565).
private struct TargetEditChip: View {
    let model: AnalyzeModel

    var body: some View {
        HStack(spacing: Layout.editChipSpacing) {
            Label(TargetCurveEditor.chipTitle, systemImage: "pencil")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.target)
            Button("Cancel") {
                withAnimation(.snappy) { model.cancelTargetEdit() }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(Palette.secondaryText)
            .accessibilityIdentifier("analyze.targetEditChip.cancel")
            Button("Done") {
                withAnimation(.snappy) { model.commitTargetEdit() }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(Palette.accent)
            .accessibilityIdentifier("analyze.targetEditChip.done")
        }
        .padding(.horizontal, Layout.editChipPaddingH)
        .padding(.vertical, Layout.editChipPaddingV)
        .background(Palette.surface, in: Capsule())
        .accessibilityIdentifier("analyze.targetEditChip")
    }
}

/// One-tap starting points for the target-curve draft while editing
/// (#1560): tapping a pill replaces the draft with that bundled curve,
/// discarding unsaved handle drags.
private struct TargetPresetStrip: View {
    let model: AnalyzeModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Layout.presetPillSpacing) {
                ForEach(TargetCurvePreset.all) { preset in
                    TargetPresetPill(preset: preset, model: model)
                }
            }
        }
        .accessibilityIdentifier("analyze.targetPresets")
    }
}

private struct TargetPresetPill: View {
    let preset: TargetCurvePreset
    let model: AnalyzeModel

    var body: some View {
        let selected = model.activeTargetPresetId == preset.id
        Button(preset.title) {
            withAnimation(.snappy) { _ = model.selectTargetPreset(preset) }
        }
        .font(.caption.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, Layout.presetPillPaddingH)
        .padding(.vertical, Layout.presetPillPaddingV)
        .foregroundStyle(selected ? Palette.background : Palette.secondaryText)
        .background(selected ? Palette.accent : Palette.surface, in: Capsule())
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("analyze.targetPreset.\(preset.id)")
    }
}

// MARK: - Coaching

/// The short coaching stack: BandDeviationCoach.maxEvents fixed slots, each
/// updated in place. Slots are identified by position (not by event), and
/// nothing here animates — the model refreshes the stack about once a second,
/// and an implicit animation over changing text cross-fades old and new
/// copies into ghosted, double-drawn text.
struct CoachingStackView: View {
    let model: AnalyzeModel

    var body: some View {
        let events = model.coaching
        VStack(alignment: .leading, spacing: Layout.cardSpacing) {
            Text("Coaching")
                .font(.headline)
            ForEach(0..<BandDeviationCoach.maxEvents, id: \.self) { slot in
                if slot < events.count {
                    CoachingCard(event: events[slot])
                } else if slot == 0 {
                    CoachingPlaceholder(text: model.coachingPlaceholder)
                } else {
                    // Keeps the stack's height steady as hints come and go.
                    Color.clear
                        .frame(height: Layout.coachingSlotMinHeight)
                        .accessibilityHidden(true)
                }
            }
        }
        .transaction { $0.animation = nil }
    }
}

private struct CoachingPlaceholder: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Palette.secondaryText)
            .frame(maxWidth: .infinity, minHeight: Layout.coachingSlotMinHeight, alignment: .leading)
            .padding(.horizontal, Layout.cardPadding)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
    }
}

private struct CoachingCard: View {
    let event: CoachingEvent

    var body: some View {
        HStack(alignment: .center, spacing: Layout.cardSpacing) {
            Image(systemName: icon)
                .foregroundStyle(Palette.accent)
            Text(event.message)
                .font(.subheadline)
                .lineLimit(Layout.coachingMaxLines)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: Layout.coachingSlotMinHeight)
        .padding(.horizontal, Layout.cardPadding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch event.severity {
        case .warning: "exclamationmark.triangle.fill"
        case .suggestion: "slider.vertical.3"
        case .info: "info.circle"
        }
    }
}

// MARK: - Status

/// Mic-denied and start-failure messages, each with the next step.
private struct StatusMessageView: View {
    let model: AnalyzeModel

    var body: some View {
        switch model.state {
        case .micDenied:
            VStack(alignment: .leading, spacing: Layout.cardSpacing) {
                Text("Microphone access is off. Turn it on in Settings > Sound Buddy to analyze the room.")
                    .font(.subheadline)
                #if canImport(UIKit)
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                #endif
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: Layout.cardSpacing) {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Palette.error)
                Button("Try again") {
                    Task { await model.retry() }
                }
            }
        case .idle, .requestingPermission, .live:
            EmptyView()
        }
    }
}

// MARK: - Style

private enum Layout {
    static let screenPadding: CGFloat = 20
    static let sectionSpacing: CGFloat = 20
    static let headerSpacing: CGFloat = 2
    static let brandSpacing: CGFloat = 10
    /// Matches BRAND_MARK_POINTS in scripts/make_ios_icons.py.
    static let brandMarkSize: CGFloat = 36
    /// Lets "Sound Buddy" shrink rather than wrap beside the readout on narrow phones.
    static let titleMinScale: CGFloat = 0.8
    /// Gap between the hero number and its tiny "dB" unit.
    static let levelUnitSpacing: CGFloat = 2
    static let cardSpacing: CGFloat = 10
    static let cardPadding: CGFloat = 14
    static let cornerRadius: CGFloat = 12
    static let badgePaddingH: CGFloat = 10
    static let badgePaddingV: CGFloat = 5
    static let indicatorSpacing: CGFloat = 6
    static let indicatorDot: CGFloat = 8
    /// Fits a two-line coaching hint with padding, so cards keep one height.
    static let coachingSlotMinHeight: CGFloat = 64
    static let coachingMaxLines = 3
    static let legendSpacing: CGFloat = 6
    static let legendSwatchGap: CGFloat = 6
    static let legendSwatchSize = CGSize(width: 18, height: 8)
    static let legendSwatchLineWidth: CGFloat = 1.5
    static let legendSwatchDash: [CGFloat] = [3, 2]
    static let editChipSpacing: CGFloat = 10
    static let editChipPaddingH: CGFloat = 10
    static let editChipPaddingV: CGFloat = 5
    static let presetPillSpacing: CGFloat = 8
    static let presetPillPaddingH: CGFloat = 10
    static let presetPillPaddingV: CGFloat = 5
    static let landscapeSpacing: CGFloat = 8
    static let peekHandleHeight: CGFloat = 28
    static let peekDragMinDistance: CGFloat = 8
    static let peekMaxHeightFraction: CGFloat = 0.6
    /// Dims the coaching peek handle while target-edit mode disables it (#1562).
    static let peekDisabledOpacity: Double = 0.4
    static let landscapeStripSpacing: CGFloat = 12
}

/// Mirrors the Mac renderer's design tokens (app/renderer :root) — dark
/// neutrals with the gold accent.
private enum Palette {
    static let background = hex(0x0B0C0F) // --neutral-950 (--bg-app)
    static let surface = hex(0x1B1F26) // --neutral-800 (--surface)
    static let accent = hex(0xEBB93C) // --gold-500
    static let live = hex(0x3FB950)
    static let error = hex(0xE5534B)
    static let secondaryText = hex(0xA2AAB6) // --neutral-300 (--text-secondary)
    /// Shares RTAPalette.target so the legend swatch matches the dashed line
    /// drawn on the RTA itself.
    static let target = RTAPalette.target

    private static func hex(_ rgb: UInt32) -> Color {
        Color(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}
