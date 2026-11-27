import SoundBuddyKit
import SwiftUI

struct MixView<Rail: View>: View {
    let model: AnalyzeModel
    let console: ConsoleTargetModel?
    let triage: MixTriage
    let layout: MixLayout
    @Binding var sermonQuiet: Bool
    @Binding var railOpen: Bool
    let onReviewFix: (CoachingEvent) -> Void
    @ViewBuilder let rail: () -> Rail
    @State private var segment = MixSegment.attention

    var body: some View {
        HStack(alignment: .top, spacing: MixMetrics.columnSpacing) {
            ScrollView {
                VStack(alignment: .leading, spacing: MixMetrics.sectionSpacing) {
                    header
                    controls
                    switch segment {
                    case .attention: attention
                    case .channels: channels
                    }
                }
                .padding(MixMetrics.screenPadding)
            }
            if layout.showsAgentRail, railOpen {
                rail()
                    .frame(width: MixLayout.railWidth)
                    .background(Palette.panel, in: RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
                    .overlay(RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius).strokeBorder(Palette.borderSubtle, lineWidth: ThemeMetrics.hairline))
                    .padding([.top, .bottom, .trailing], MixMetrics.screenPadding)
                    .transition(.move(edge: .trailing))
            }
        }
        .background(Palette.background.ignoresSafeArea())
        .animation(.snappy, value: railOpen)
    }

    private var channelsState: MixChannelsState {
        MixChannelsState(catalog: console?.catalog)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: MixMetrics.headerSpacing) {
                Text(MixCopy.title)
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Palette.primaryText)
                    .accessibilityAddTraits(.isHeader)
                HStack(spacing: MixMetrics.dotSpacing) {
                    Circle()
                        .fill(subtitleDot)
                        .frame(width: MixMetrics.dotSize, height: MixMetrics.dotSize)
                    Text(MixCopy.subline(chipTitle: console?.chipTitle, chipStatus: console?.chipStatus))
                        .font(.subheadline)
                        .foregroundStyle(Palette.secondaryText)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("mix.subline")
            }
            Spacer(minLength: 0)
            if layout.showsAgentRail, !railOpen {
                Button { railOpen = true } label: {
                    Image(systemName: "sidebar.trailing")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.secondaryText)
                        .frame(width: ThemeMetrics.minimumHitTarget, height: ThemeMetrics.minimumHitTarget)
                        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: ThemeMetrics.tileRadius))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Show Agent")
                .accessibilityIdentifier("mix.rail.open")
            }
        }
    }

    private var subtitleDot: Color {
        guard let console else { return Palette.accent }
        switch console.chipStatus.tint {
        case .green: return Palette.good
        case .amber: return Palette.check
        case .grey: return Palette.tertiaryText
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: MixMetrics.rowSpacing) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: MixMetrics.rowSpacing) {
                    segmentPicker
                    Spacer(minLength: 0)
                    sermonQuietToggle
                }
                VStack(alignment: .leading, spacing: MixMetrics.rowSpacing) {
                    segmentPicker
                    sermonQuietToggle
                }
            }
            Text(MixCopy.sermonQuietCaption)
                .font(.caption)
                .foregroundStyle(Palette.tertiaryText)
                .accessibilityIdentifier("mix.sermonQuiet.caption")
        }
    }

    private var segmentPicker: some View {
        SegmentedPills(
            options: MixSegment.allCases,
            selection: $segment,
            title: { option in
                switch option {
                case .attention: MixCopy.attentionSegment(count: triage.badgeCount)
                case .channels: MixCopy.channelsSegment(count: channelsState.rows.count)
                }
            },
            identifier: { "mix.segment.\($0.rawValue)" }
        )
        .fixedSize()
    }

    private var sermonQuietToggle: some View {
        Toggle(isOn: $sermonQuiet) {
            Text(MixCopy.sermonQuietTitle)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.primaryText)
        }
        .toggleStyle(.switch)
        .tint(Palette.accent)
        .fixedSize()
        .padding(.horizontal, MixMetrics.pillPaddingH)
        .frame(minHeight: ThemeMetrics.minimumHitTarget)
        .background(Palette.panel2, in: Capsule())
        .overlay(Capsule().strokeBorder(sermonQuiet ? Palette.accent.opacity(ThemeMetrics.pillBorderOpacity) : Palette.borderSubtle, lineWidth: ThemeMetrics.hairline))
        .accessibilityIdentifier("mix.sermonQuiet")
    }

    @ViewBuilder
    private var attention: some View {
        if let empty = triage.emptyMessage(isMixOnTarget: model.isMixOnTarget, placeholder: model.coachingPlaceholder) {
            MixEmptyCard(text: empty, isCalm: model.isMixOnTarget && triage.heldCount == 0)
        } else {
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: MixMetrics.cardSpacing, alignment: .top), count: layout.cardsAcross),
                alignment: .leading,
                spacing: MixMetrics.cardSpacing
            ) {
                ForEach(triage.visible) { item in
                    AttentionCard(item: item) {
                        if let event = model.coaching.first(where: { $0.id == item.id }) {
                            onReviewFix(event)
                        }
                    }
                }
            }
            .transaction { $0.animation = nil }
        }
        if let footer = MixCopy.heldFooter(count: triage.heldCount) {
            Label(footer, systemImage: "moon")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.secondaryText)
                .frame(maxWidth: .infinity, minHeight: ThemeMetrics.minimumHitTarget, alignment: .leading)
                .padding(.horizontal, MixMetrics.cardPadding)
                .overlay(
                    RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius)
                        .strokeBorder(Palette.borderStrong, style: StrokeStyle(lineWidth: ThemeMetrics.hairline, dash: MixMetrics.footerDash))
                )
                .accessibilityIdentifier("mix.heldFooter")
        }
    }

    @ViewBuilder
    private var channels: some View {
        let state = channelsState
        let rows = state.rows
        if let message = state.emptyMessage {
            MixEmptyCard(text: message, isCalm: false)
                .accessibilityIdentifier(state == .unavailable ? "mix.channels.unavailable" : "mix.channels.empty")
        } else {
            VStack(spacing: 0) {
                ForEach(rows, id: \.target) { label in
                    ChannelRow(label: label)
                    if label.target != rows.last?.target {
                        Divider().overlay(Palette.borderSubtle)
                    }
                }
            }
            .background(Palette.panel2, in: RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius).strokeBorder(Palette.borderSubtle, lineWidth: ThemeMetrics.hairline))
            .accessibilityIdentifier("mix.channels")
        }
    }
}

private enum MixMetrics {
    static let screenPadding: CGFloat = 20
    static let columnSpacing: CGFloat = 0
    static let sectionSpacing: CGFloat = 16
    static let headerSpacing: CGFloat = 4
    static let rowSpacing: CGFloat = 10
    static let cardSpacing: CGFloat = 12
    static let cardPadding: CGFloat = 14
    static let dotSize: CGFloat = 8
    static let dotSpacing: CGFloat = 6
    static let pillPaddingH: CGFloat = 14
    static let footerDash: [CGFloat] = [4, 4]
}

private enum MixSegment: String, CaseIterable, Hashable {
    case attention
    case channels
}

private struct AttentionCard: View {
    let item: AttentionItem
    let onReviewFix: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(Palette.band(item.band))
                .frame(width: Layout.barWidth)
            VStack(alignment: .leading, spacing: Layout.spacing) {
                HStack(spacing: Layout.tagSpacing) {
                    Text(item.bandLabel.uppercased())
                        .font(.caption.weight(.bold).monospaced())
                        .foregroundStyle(Palette.band(item.band))
                        .padding(.horizontal, Layout.tagPaddingH)
                        .padding(.vertical, Layout.tagPaddingV)
                        .background(Palette.band(item.band).opacity(ThemeMetrics.pillTintOpacity), in: RoundedRectangle(cornerRadius: Layout.tagRadius))
                    Text(item.rangeLabel)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Palette.tertiaryText)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    StatusPill(text: item.severity.label, tone: StatusTone(item.severity))
                }
                Text(MixCopy.sourceLine)
                    .font(.caption)
                    .foregroundStyle(Palette.tertiaryText)
                Text(item.message)
                    .font(.subheadline)
                    .foregroundStyle(Palette.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: Layout.tileSpacing) {
                    Text(MixCopy.vsTargetLabel)
                        .font(.caption2.weight(.semibold))
                        .tracking(ThemeMetrics.pillTracking)
                        .foregroundStyle(Palette.tertiaryText)
                    Text(item.deviationText)
                        .font(.title3.weight(.semibold).monospacedDigit())
                        .foregroundStyle(item.direction == .overTarget ? Palette.checkText : Palette.infoText)
                }
                .padding(Layout.tilePadding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.inset, in: RoundedRectangle(cornerRadius: ThemeMetrics.tileRadius))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Versus target, \(item.deviationText), phone mic estimate")
                Label(MixCopy.meterUnavailable, systemImage: "gauge.with.dots.needle.bottom.0percent")
                    .font(.caption)
                    .foregroundStyle(Palette.tertiaryText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("mix.card.metersUnavailable")
                Button(action: onReviewFix) {
                    Label(MixCopy.reviewFix, systemImage: "sparkles")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.onAccent)
                        .frame(maxWidth: .infinity, minHeight: ThemeMetrics.minimumHitTarget)
                        .background(Palette.accent, in: RoundedRectangle(cornerRadius: ThemeMetrics.tileRadius))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("mix.card.reviewFix")
            }
            .padding(Layout.padding)
        }
        .background(Palette.panel2)
        .clipShape(RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius).strokeBorder(Palette.borderSubtle, lineWidth: ThemeMetrics.hairline))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("mix.card.\(item.band.rawValue)")
    }

    private enum Layout {
        static let barWidth: CGFloat = 4
        static let spacing: CGFloat = 10
        static let tagSpacing: CGFloat = 8
        static let tagPaddingH: CGFloat = 7
        static let tagPaddingV: CGFloat = 3
        static let tagRadius: CGFloat = 5
        static let tileSpacing: CGFloat = 4
        static let tilePadding: CGFloat = 10
        static let padding: CGFloat = 14
    }
}

private struct MixEmptyCard: View {
    let text: String
    let isCalm: Bool

    var body: some View {
        HStack(spacing: Layout.spacing) {
            if isCalm {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Palette.goodText)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(isCalm ? .subheadline.weight(.semibold) : .subheadline)
                .foregroundStyle(isCalm ? Palette.primaryText : Palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: Layout.minHeight, alignment: .leading)
        .padding(.horizontal, Layout.padding)
        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: ThemeMetrics.cardRadius))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(isCalm ? "mix.onTarget" : "mix.empty")
    }

    private enum Layout {
        static let spacing: CGFloat = 10
        static let minHeight: CGFloat = 64
        static let padding: CGFloat = 14
    }
}

private struct ChannelRow: View {
    let label: ConsoleTargetLabel

    var body: some View {
        HStack(spacing: Layout.spacing) {
            RoundedRectangle(cornerRadius: Layout.barRadius)
                .fill(label.color.scribbleTint)
                .overlay {
                    if label.color.isInverted {
                        RoundedRectangle(cornerRadius: Layout.barRadius)
                            .strokeBorder(Color.black.opacity(Layout.invertedBorderOpacity), lineWidth: ThemeMetrics.hairline)
                    }
                }
                .frame(width: Layout.barWidth, height: Layout.barHeight)
            Text(label.displayName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.primaryText)
                .lineLimit(1)
            Spacer(minLength: 0)
            Text(label.fallbackName)
                .font(.caption.monospacedDigit())
                .foregroundStyle(Palette.tertiaryText)
        }
        .padding(.horizontal, Layout.padding)
        .frame(minHeight: ThemeMetrics.minimumHitTarget)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("mix.channel")
    }

    private enum Layout {
        static let spacing: CGFloat = 10
        static let barRadius: CGFloat = 3
        static let barWidth: CGFloat = 6
        static let barHeight: CGFloat = 24
        static let invertedBorderOpacity: Double = 0.3
        static let padding: CGFloat = 14
    }
}
