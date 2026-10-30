import SoundBuddyKit
import SwiftUI

/// The channel-setup review (#1793): groups one finished read into "Check
/// these" / "Looks right" / hidden unused, lets the volunteer fix a role or
/// pick the room mic, then hands `ChannelSetupFlow.finish(at:)`'s result to
/// `onDone`. A thin renderer — every decision lives in `ChannelSetupReview`
/// and reaches it only through `flow.updateReview`.
struct ChannelSetupReviewView: View {
    let flow: ChannelSetupFlow
    let onDone: (ConfirmedChannelSetup) -> Void

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var looksRightExpanded = false
    @State private var selection: ConsoleStripID?

    var body: some View {
        if let review = flow.review {
            Group {
                if horizontalSizeClass == .regular {
                    NavigationSplitView {
                        iPadList(review: review)
                    } detail: {
                        detail(for: review)
                    }
                } else {
                    iPhoneList(review: review)
                }
            }
            .toolbar { toolbarContent(for: review) }
        }
    }

    @ViewBuilder
    private func detail(for review: ChannelSetupReview) -> some View {
        if let selection, let row = review.rows.first(where: { $0.id == selection }) {
            ChannelRolePickerView(row: row) { role in setRole(role, for: row.id) }
        } else {
            Text(ChannelSetupCopy.rolePickerTitle)
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)
        }
    }

    private func iPhoneList(review: ChannelSetupReview) -> some View {
        List {
            sections(review: review) { row in
                NavigationLink {
                    ChannelRolePickerView(row: row) { role in setRole(role, for: row.id) }
                } label: {
                    rowContent(row, review: review)
                }
            }
        }
    }

    private func iPadList(review: ChannelSetupReview) -> some View {
        List(selection: $selection) {
            sections(review: review) { row in
                rowContent(row, review: review).tag(row.id)
            }
        }
    }

    @ViewBuilder
    private func sections<RowContent: View>(
        review: ChannelSetupReview,
        @ViewBuilder row rowBuilder: @escaping (ChannelSetupReview.Row) -> RowContent
    ) -> some View {
        if !review.checkThese.isEmpty {
            Section(ChannelSetupCopy.checkTheseHeader) {
                ForEach(review.checkThese) { rowBuilder($0) }
            }
        }
        if !review.looksRight.isEmpty {
            Section {
                DisclosureGroup(ChannelSetupCopy.looksRight(count: review.looksRightCount), isExpanded: $looksRightExpanded) {
                    ForEach(review.looksRight) { rowBuilder($0) }
                }
            }
        }
        Section {
            Toggle(ChannelSetupCopy.showUnused, isOn: showUnusedBinding(review))
                .accessibilityIdentifier("channelSetup.showUnused")
            ForEach(review.unused) { rowBuilder($0) }
        }
        if flow.showsRoomMicPicker {
            Section(ChannelSetupCopy.roomMicHeader) {
                roomMicMenu(review: review)
                NavigationLink(ChannelSetupCopy.roomMicOther) {
                    otherChannelList(review: review)
                }
            }
        }
    }

    private func rowContent(_ row: ChannelSetupReview.Row, review: ChannelSetupReview) -> some View {
        HStack(spacing: Layout.rowSpacing) {
            RoundedRectangle(cornerRadius: Layout.colorBarCornerRadius)
                .fill(tintColor(for: row.strip.color.base))
                .frame(width: Layout.colorBarWidth)
            VStack(alignment: .leading, spacing: Layout.rowInnerSpacing) {
                ViewThatFits(in: .horizontal) {
                    Text(row.strip.displayName).lineLimit(1)
                    Text(row.strip.displayName)
                }
                .font(.body)
                if let source = row.strip.source {
                    Text(source.displayName)
                        .font(.caption)
                        .foregroundStyle(Palette.secondaryText)
                }
                Text(ChannelSetupCopy.roleTitle(row.role))
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
            }
            Spacer()
            Text(ChannelSetupCopy.confidenceChip(for: row))
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, Layout.chipHorizontalPadding)
                .padding(.vertical, Layout.chipVerticalPadding)
                .background(Palette.surface, in: Capsule())
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(review.accessibilityLabel(for: row.id) ?? "")
        .accessibilityIdentifier("channelSetup.row.\(row.id.configPath)")
    }

    private struct RoomMicMenuOption: Identifiable {
        let id: String
        let choice: ChannelSetupReview.RoomMicChoice
        let label: String
    }

    private func mainRoomMicOptions(review: ChannelSetupReview) -> [RoomMicMenuOption] {
        review.roomMicOptions.compactMap { choice in
            switch choice {
            case .candidate(let id):
                return RoomMicMenuOption(id: id.configPath, choice: choice, label: ChannelSetupCopy.roomMicChoiceLabel(choice, in: review))
            case .none:
                return RoomMicMenuOption(id: "none", choice: choice, label: ChannelSetupCopy.roomMicChoiceLabel(choice, in: review))
            case .otherChannel:
                return nil
            }
        }
    }

    private func otherChannelOptions(review: ChannelSetupReview) -> [RoomMicMenuOption] {
        review.roomMicOptions.compactMap { choice in
            guard case let .otherChannel(id) = choice else { return nil }
            return RoomMicMenuOption(id: id.configPath, choice: choice, label: ChannelSetupCopy.roomMicChoiceLabel(choice, in: review))
        }
    }

    private func roomMicMenu(review: ChannelSetupReview) -> some View {
        Menu {
            ForEach(mainRoomMicOptions(review: review)) { option in
                Button(option.label) { selectRoomMic(option.choice) }
            }
        } label: {
            HStack {
                Text(ChannelSetupCopy.roomMicHeader)
                    .foregroundStyle(Color.primary)
                Spacer()
                Text(ChannelSetupCopy.roomMicChoiceLabel(review.roomMic, in: review))
                    .foregroundStyle(Palette.secondaryText)
            }
        }
        .accessibilityIdentifier("channelSetup.roomMic")
    }

    private func otherChannelList(review: ChannelSetupReview) -> some View {
        List(otherChannelOptions(review: review)) { option in
            Button {
                selectRoomMic(option.choice)
            } label: {
                HStack {
                    Text(option.label)
                        .foregroundStyle(Color.primary)
                    Spacer()
                    if review.roomMic == option.choice {
                        Image(systemName: "checkmark")
                            .foregroundStyle(Palette.accent)
                    }
                }
            }
        }
        .navigationTitle(ChannelSetupCopy.roomMicOther)
        .navigationBarTitleDisplayMode(.inline)
    }

    @ToolbarContentBuilder
    private func toolbarContent(for review: ChannelSetupReview) -> some ToolbarContent {
        ToolbarItem(placement: .bottomBar) {
            Button(ChannelSetupCopy.confirmAll) {
                flow.updateReview { $0.confirmAll() }
            }
            .accessibilityIdentifier("channelSetup.confirmAll")
        }
        ToolbarItem(placement: .confirmationAction) {
            Button(ChannelSetupCopy.done) {
                if let setup = flow.finish(at: Date()) { onDone(setup) }
            }
            .disabled(!review.isDoneEnabled)
            .accessibilityIdentifier("channelSetup.done")
        }
    }

    private func setRole(_ role: ChannelRole, for id: ConsoleStripID) {
        flow.updateReview { $0.setRole(role, for: id) }
    }

    private func selectRoomMic(_ choice: ChannelSetupReview.RoomMicChoice) {
        flow.updateReview { _ = $0.selectRoomMic(choice) }
    }

    private func showUnusedBinding(_ review: ChannelSetupReview) -> Binding<Bool> {
        Binding(
            get: { review.showUnused },
            set: { newValue in flow.updateReview { $0.showUnused = newValue } }
        )
    }

    /// Mirrors `ConsoleTargetPickerView.tintColor(for:)`: `base` is already
    /// the non-inverted hue, so inverted colors fall out of this for free.
    private func tintColor(for base: ConsoleChannelColor) -> Color {
        switch base {
        case .off: return Palette.secondaryText
        case .red: return .red
        case .green: return .green
        case .yellow: return .yellow
        case .blue: return .blue
        case .magenta: return .pink
        case .cyan: return .cyan
        case .white: return .white
        default: return Palette.secondaryText
        }
    }

    private enum Layout {
        static let rowSpacing: CGFloat = 10
        static let rowInnerSpacing: CGFloat = 2
        static let colorBarWidth: CGFloat = 6
        static let colorBarCornerRadius: CGFloat = 3
        static let chipHorizontalPadding: CGFloat = 8
        static let chipVerticalPadding: CGFloat = 3
    }
}
