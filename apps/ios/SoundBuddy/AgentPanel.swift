import SoundBuddyKit
import SwiftUI

struct AgentPanel: View {
    enum Host {
        case tab
        case sheet
        case rail
    }

    let host: Host
    let model: AnalyzeModel
    let console: ConsoleTargetModel?
    let writer: ConsoleEQWriter?
    @Binding var selection: AgentSelection
    var onClose: (() -> Void)? = nil
    @State private var applyError: String?

    private var phase: ConsoleSessionPhase { console?.phase ?? .idle }

    private var mainLR: ConsoleEQ? {
        guard let console, console.selected == .mainLR else { return nil }
        return console.eq
    }

    private var agent: AgentModel {
        AgentModel(
            events: model.coaching,
            selectedID: selection.selectedID,
            dismissedIDs: selection.dismissedIDs,
            mainLR: mainLR,
            phase: phase,
            writer: writer
        )
    }

    private var isArmed: Bool {
        ConsoleCoachingMapper.isArmed(writer: writer, phase: phase)
    }

    var body: some View {
        let agent = self.agent
        ScrollView {
            VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
                header
                badges
                if let console, let applied = console.appliedCoaching {
                    AgentAppliedRow(applied: applied, isArmed: isArmed) { undo(on: console) }
                }
                if let error = applyError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.issueText)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("agent.error")
                }
                if let event = agent.selected, let move = agent.move, let diagnosis = agent.diagnosis {
                    diagnosisCard(diagnosis)
                    moveCard(event: event, move: move, applyState: agent.applyState)
                    if let next = agent.next {
                        nextRow(next)
                    }
                } else {
                    emptyCard
                }
                Text(AgentCopy.footer)
                    .font(.caption)
                    .foregroundStyle(Palette.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("agent.footer")
            }
            .padding(host == .tab ? Layout.tabPadding : Layout.padding)
            .frame(maxWidth: host == .tab ? Layout.tabMaxWidth : .infinity, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background {
            if host == .tab {
                Palette.background.ignoresSafeArea()
            }
        }
        .accessibilityIdentifier("agent.\(hostIdentifier)")
    }

    private var hostIdentifier: String {
        switch host {
        case .tab: "tab"
        case .sheet: "sheet"
        case .rail: "rail"
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Layout.rowSpacing) {
            Image(systemName: "sparkles")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Palette.goldText)
                .frame(width: ThemeMetrics.minimumHitTarget, height: ThemeMetrics.minimumHitTarget)
                .background(Palette.accent.opacity(ThemeMetrics.pillTintOpacity), in: RoundedRectangle(cornerRadius: ThemeMetrics.tileRadius))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Layout.tightSpacing) {
                Text(AgentCopy.title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Palette.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Text(AgentCopy.subtitle)
                    .font(.footnote)
                    .foregroundStyle(Palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if let onClose, host != .tab {
                Button(action: onClose) {
                    Image(systemName: host == .rail ? "sidebar.trailing" : "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.secondaryText)
                        .frame(width: ThemeMetrics.minimumHitTarget, height: ThemeMetrics.minimumHitTarget)
                        .background(Palette.panel2, in: host == .rail ? AnyShape(RoundedRectangle(cornerRadius: ThemeMetrics.tileRadius)) : AnyShape(Circle()))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(host == .rail ? "Hide Agent" : "Close")
                .accessibilityIdentifier("agent.close")
            }
        }
    }

    private var badges: some View {
        HStack(spacing: Layout.rowSpacing) {
            Label(AgentCopy.badge, systemImage: "checklist")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.goodText)
                .padding(.horizontal, Layout.badgePaddingH)
                .padding(.vertical, Layout.badgePaddingV)
                .background(Palette.good.opacity(ThemeMetrics.pillTintOpacity), in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.good.opacity(ThemeMetrics.pillBorderOpacity), lineWidth: ThemeMetrics.hairline))
            Text(AgentCopy.badgeDetail)
                .font(.caption.monospaced())
                .foregroundStyle(Palette.tertiaryText)
                .lineLimit(1)
                .minimumScaleFactor(Layout.minScale)
            Spacer(minLength: 0)
            if writer != nil {
                StatusPill(text: AgentCopy.armed, tone: .gold)
                    .accessibilityIdentifier("agent.armed")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("agent.badge")
    }

    private func diagnosisCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: Layout.tightSpacing) {
            Text(message)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Text(AgentCopy.diagnosisSource)
                .font(.caption)
                .foregroundStyle(Palette.tertiaryText)
        }
        .padding(Layout.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius).strokeBorder(Palette.borderSubtle, lineWidth: ThemeMetrics.hairline))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("agent.diagnosis")
    }

    private func moveCard(event: CoachingEvent, move: AgentMove, applyState: AgentApplyState) -> some View {
        VStack(alignment: .leading, spacing: Layout.rowSpacing) {
            HStack(spacing: Layout.rowSpacing) {
                Text(AgentCopy.mainLRTag)
                    .font(.caption.weight(.bold).monospaced())
                    .foregroundStyle(Palette.goldText)
                    .padding(.horizontal, Layout.tagPaddingH)
                    .padding(.vertical, Layout.badgePaddingV)
                    .background(Palette.accent.opacity(ThemeMetrics.pillTintOpacity), in: RoundedRectangle(cornerRadius: Layout.tagRadius))
                Text(AgentCopy.moveTitle(gainDb: move.gainDb, band: event.band))
                    .font(.headline)
                    .foregroundStyle(Palette.primaryText)
                    .lineLimit(1)
                Spacer(minLength: 0)
                StatusPill(text: AgentCopy.proposed, tone: .gold)
            }
            if let preview = move.preview {
                EQCurveView(eqPanel: preview, analyze: model, style: .proposal)
            } else {
                Text(AgentCopy.previewUnavailable)
                    .font(.footnote)
                    .foregroundStyle(Palette.tertiaryText)
                    .frame(maxWidth: .infinity, minHeight: Layout.previewPlaceholderHeight)
                    .background(Palette.inset, in: RoundedRectangle(cornerRadius: ThemeMetrics.tileRadius))
                    .accessibilityIdentifier("agent.previewUnavailable")
            }
            HStack(spacing: Layout.tileSpacing) {
                AgentTile(label: "PEQ", value: move.bandText)
                AgentTile(label: "FREQ", value: move.freqText)
                AgentTile(label: "Q", value: move.qText)
                AgentTile(label: "GAIN", value: move.gainText, highlight: true)
            }
            if let retune = move.retuneNote {
                Text(retune)
                    .font(.caption)
                    .foregroundStyle(Palette.checkText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Label(AgentCopy.safeStep, systemImage: "checkmark.shield")
                .font(.caption)
                .foregroundStyle(Palette.goodText)
            if let undoNote = move.undoNote {
                Text(undoNote)
                    .font(.caption)
                    .foregroundStyle(Palette.tertiaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("agent.undoNote")
            }
            if applyState == .noConsoleLink {
                Label(AgentCopy.noConsoleLink, systemImage: "link")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("agent.noConsoleLink")
            }
            HStack(spacing: Layout.rowSpacing) {
                switch applyState {
                case .ready:
                    Button { apply(event) } label: {
                        Label(AgentCopy.applyTitle(consoleModel: console?.console?.model), systemImage: "checkmark")
                            .font(.headline)
                            .foregroundStyle(Palette.onAccent)
                            .frame(maxWidth: .infinity, minHeight: ThemeMetrics.primaryActionHeight)
                            .background(Palette.accent, in: RoundedRectangle(cornerRadius: Layout.buttonRadius))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("agent.apply")
                case .locked:
                    Button {} label: {
                        Label(AgentCopy.applyLocked, systemImage: "lock.fill")
                            .font(.headline)
                            .foregroundStyle(Palette.tertiaryText)
                            .frame(maxWidth: .infinity, minHeight: ThemeMetrics.primaryActionHeight)
                            .background(Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Layout.buttonRadius))
                    }
                    .buttonStyle(.plain)
                    .disabled(true)
                    .accessibilityIdentifier("agent.apply.locked")
                case .noConsoleLink:
                    EmptyView()
                }
                Button { dismiss(event) } label: {
                    Text(AgentCopy.dismiss)
                        .font(.headline)
                        .foregroundStyle(Palette.primaryText)
                        .frame(maxWidth: applyState == .noConsoleLink ? .infinity : Layout.dismissWidth, minHeight: ThemeMetrics.primaryActionHeight)
                        .background(Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Layout.buttonRadius))
                        .overlay(RoundedRectangle(cornerRadius: Layout.buttonRadius).strokeBorder(Palette.borderStrong, lineWidth: ThemeMetrics.hairline))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("agent.dismiss")
            }
        }
        .padding(Layout.cardPadding)
        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius).strokeBorder(Palette.accent.opacity(ThemeMetrics.pillBorderOpacity), lineWidth: ThemeMetrics.hairline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agent.move")
    }

    private func nextRow(_ next: CoachingEvent) -> some View {
        Button { selection.select(next.id) } label: {
            HStack(spacing: Layout.rowSpacing) {
                Text(AgentCopy.next.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(ThemeMetrics.pillTracking)
                    .foregroundStyle(Palette.tertiaryText)
                if let band = next.band {
                    Text(band.label.uppercased())
                        .font(.caption.weight(.bold).monospaced())
                        .foregroundStyle(Palette.band(band))
                        .padding(.horizontal, Layout.tagPaddingH)
                        .padding(.vertical, Layout.badgePaddingV)
                        .background(Palette.band(band).opacity(ThemeMetrics.pillTintOpacity), in: RoundedRectangle(cornerRadius: Layout.tagRadius))
                }
                Text(next.message)
                    .font(.footnote)
                    .foregroundStyle(Palette.secondaryText)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            .padding(.horizontal, Layout.cardPadding)
            .frame(minHeight: ThemeMetrics.minimumHitTarget)
            .background(Palette.panel2, in: RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("agent.next")
    }

    private var emptyCard: some View {
        Text(model.isMixOnTarget ? MixCopy.onTarget : AgentCopy.empty)
            .font(.subheadline)
            .foregroundStyle(Palette.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(Layout.cardPadding)
            .frame(maxWidth: .infinity, minHeight: Layout.emptyMinHeight, alignment: .leading)
            .background(Palette.panel2, in: RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
            .accessibilityIdentifier("agent.empty")
    }

    private func apply(_ event: CoachingEvent) {
        guard let console else { return }
        let before = console.appliedCoaching
        console.showCoaching(event)
        do {
            try console.applyCoaching(using: writer)
        } catch {
            applyError = String(describing: error)
            return
        }
        guard let after = console.appliedCoaching, after != before else {
            applyError = AgentCopy.applyNothingSent
            return
        }
        applyError = nil
        selection.dismiss(event.id)
    }

    private func undo(on console: ConsoleTargetModel) {
        do {
            try console.undoAppliedCoaching(using: writer)
            applyError = nil
        } catch {
            applyError = String(describing: error)
        }
    }

    private func dismiss(_ event: CoachingEvent) {
        selection.dismiss(event.id)
        console?.clearCoaching()
        applyError = nil
    }

    private enum Layout {
        static let sectionSpacing: CGFloat = 14
        static let rowSpacing: CGFloat = 10
        static let tightSpacing: CGFloat = 3
        static let tileSpacing: CGFloat = 8
        static let padding: CGFloat = 18
        static let tabPadding: CGFloat = 20
        static let tabMaxWidth: CGFloat = 640
        static let cardPadding: CGFloat = 14
        static let badgePaddingH: CGFloat = 10
        static let badgePaddingV: CGFloat = 4
        static let tagPaddingH: CGFloat = 7
        static let tagRadius: CGFloat = 5
        static let buttonRadius: CGFloat = 14
        static let dismissWidth: CGFloat = 120
        static let previewPlaceholderHeight: CGFloat = 80
        static let emptyMinHeight: CGFloat = 64
        static let minScale: CGFloat = 0.8
    }
}

private struct AgentTile: View {
    let label: String
    let value: String
    var highlight = false

    var body: some View {
        VStack(alignment: .leading, spacing: Layout.spacing) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .tracking(ThemeMetrics.pillTracking)
                .foregroundStyle(Palette.tertiaryText)
            Text(value)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(highlight ? Palette.goldText : Palette.primaryText)
                .lineLimit(1)
                .minimumScaleFactor(Layout.minScale)
        }
        .padding(Layout.padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.inset, in: RoundedRectangle(cornerRadius: ThemeMetrics.tileRadius))
        .accessibilityElement(children: .combine)
    }

    private enum Layout {
        static let spacing: CGFloat = 4
        static let padding: CGFloat = 8
        static let minScale: CGFloat = 0.7
    }
}

private struct AgentAppliedRow: View {
    let applied: ConsoleCoachingApplied
    let isArmed: Bool
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: Layout.spacing) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Palette.goodText)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Layout.tightSpacing) {
                Text(applied.confirmation)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.goodText)
                Text(AgentCopy.undoSentence(for: applied))
                    .font(.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button(action: onUndo) {
                Label(ConsoleCoachingMapper.undoLabel(isArmed: isArmed), systemImage: "arrow.uturn.backward")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(isArmed ? Palette.primaryText : Palette.tertiaryText)
                    .padding(.horizontal, Layout.buttonPaddingH)
                    .frame(minHeight: ThemeMetrics.minimumHitTarget)
                    .background(Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: ThemeMetrics.tileRadius))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!isArmed)
            .accessibilityIdentifier("agent.applied.undo")
        }
        .padding(Layout.padding)
        .background(Palette.good.opacity(Layout.tintOpacity), in: RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius).strokeBorder(Palette.good.opacity(ThemeMetrics.pillBorderOpacity), lineWidth: ThemeMetrics.hairline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agent.applied")
    }

    private enum Layout {
        static let spacing: CGFloat = 10
        static let tightSpacing: CGFloat = 3
        static let padding: CGFloat = 14
        static let buttonPaddingH: CGFloat = 12
        static let tintOpacity = 0.08
    }
}
