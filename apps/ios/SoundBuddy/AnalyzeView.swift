import SoundBuddyKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The P0 Analyze screen: a console-style RTA (with its dashed ideal-EQ
/// target and legend), the short coaching stack, the overall dBFS readout,
/// and the phone-mic honesty cue. Always listening while on screen in the
/// foreground — no Start/Stop control; lifecycle events go to the model.
/// Pure rendering — every decision lives in AnalyzeModel (SoundBuddyKit),
/// which is where the tests are.
///
/// portrait: header + RTA + coaching; landscape: RTA-first with a coaching
/// peek (#1548). AnalyzeLayout (SoundBuddyKit) decides portrait vs landscape
/// and the peek state; this view only renders. Problem markers pulse on the
/// RTA in both layouts (#1554). Tapping the Target legend (or its pencil)
/// enters an in-place target-edit mode: an "Editing target" chip with
/// Cancel/Done replaces the listening indicator or legend, and the RTA stays
/// on screen — no pushed view (#1558).
///
/// TODO(ipad): the layout is single-column; switch the RTA and coaching
/// stack side by side on a regular horizontal size class.
struct AnalyzeView: View {
    let model: AnalyzeModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var coachingPeekOpen = false

    var body: some View {
        GeometryReader { proxy in
            let layout = AnalyzeLayout(width: proxy.size.width, height: proxy.size.height)
            content(for: layout, proxy: proxy)
                .onChange(of: layout) { _, _ in coachingPeekOpen = false }
        }
        .padding(Layout.screenPadding)
        .background(Palette.background.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { await model.appear() }
        .onDisappear { model.disappear() }
        // No background audio mode in P0: release the mic when the app leaves
        // the foreground instead of letting the OS cut the engine, and pick it
        // back up on return. .inactive (permission alert, Control Center) is
        // deliberately ignored.
        .onChange(of: scenePhase) { _, phase in
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
        #endif
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
                RTAView(model: model, showsProblemMarkers: AnalyzeLayout.portrait.showsProblemMarkers)
                TargetLegend(text: model.targetLegendText, onEdit: beginTargetEdit)
                    .opacity(model.isEditingTarget ? 0 : 1)
                    .allowsHitTesting(!model.isEditingTarget)
                    .accessibilityHidden(model.isEditingTarget)
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
            RTAView(model: model, fillsHeight: true, showsProblemMarkers: AnalyzeLayout.landscape.showsProblemMarkers)
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
            if model.isEditingTarget {
                TargetEditChip(model: model)
            } else {
                ListeningIndicator(state: model.state)
                TargetLegend(text: model.targetLegendText, onEdit: beginTargetEdit)
            }
            Spacer()
            OverallLevelReadout(model: model, font: .headline.monospacedDigit())
            HonestyBadge()
        }
        .lineLimit(1)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: Layout.headerSpacing) {
                Text("Analyze")
                    .font(.largeTitle.weight(.bold))
                if model.isEditingTarget {
                    TargetEditChip(model: model)
                } else {
                    ListeningIndicator(state: model.state)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: Layout.headerSpacing) {
                OverallLevelReadout(model: model, font: .title2.weight(.bold).monospacedDigit())
                HonestyBadge()
            }
        }
    }
}

/// The overall dBFS readout. Shared by the portrait header and the landscape
/// status strip so the accessibility label stays identical in both.
private struct OverallLevelReadout: View {
    let model: AnalyzeModel
    let font: Font

    var body: some View {
        Text(model.overallLevelText)
            .font(font)
            .foregroundStyle(model.overallDb == nil ? Palette.secondaryText : Color.primary)
            .lineLimit(1)
            .transaction { $0.animation = nil }
            .accessibilityLabel("Overall level \(model.overallLevelText), phone mic estimate")
    }
}

/// The "Phone mic estimate" honesty cue. Shared by the portrait header and
/// the landscape status strip so the accessibility label stays identical.
private struct HonestyBadge: View {
    var body: some View {
        Label(AnalyzeModel.honestyCue, systemImage: "iphone.gen3")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, Layout.badgePaddingH)
            .padding(.vertical, Layout.badgePaddingV)
            .background(Palette.surface, in: Capsule())
            .foregroundStyle(Palette.secondaryText)
            .accessibilityLabel("\(AnalyzeModel.honestyCue): readings are relative, not calibrated")
    }
}

// MARK: - Coaching peek (landscape)

/// The thin bottom bar that opens/closes the landscape coaching peek: tap or
/// swipe up to open, tap or swipe down to close.
private struct CoachingPeekHandle: View {
    let model: AnalyzeModel
    @Binding var isOpen: Bool

    var body: some View {
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
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Coaching")
        .accessibilityValue("\(model.coaching.count) hints")
        .accessibilityHint(isOpen ? "Hides the coaching cards" : "Shows the coaching cards")
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

/// Small status line under the title — the only listening chrome.
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

/// The "Editing target" chip (Cancel / Done) shown in place of the legend or
/// listening indicator while `model.isEditingTarget` (#1558).
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
    static let headerSpacing: CGFloat = 4
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
    static let landscapeSpacing: CGFloat = 8
    static let peekHandleHeight: CGFloat = 28
    static let peekDragMinDistance: CGFloat = 8
    static let peekMaxHeightFraction: CGFloat = 0.6
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
