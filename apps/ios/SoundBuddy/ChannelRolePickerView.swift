import SoundBuddyKit
import SwiftUI

/// One strip's role picker (#1793): the desk name and the guesser's reason,
/// then every `ChannelRole`. `onPick` is the caller's `updateReview { $0.setRole(...) }`
/// — this view makes no decision itself. `dismiss()` is a no-op when there is
/// nothing to pop (the iPad split view's detail pane), so one call covers both
/// iPhone's push and iPad's in-place detail.
struct ChannelRolePickerView: View {
    let row: ChannelSetupReview.Row
    let onPick: (ChannelRole) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: Layout.headerSpacing) {
                    Text(row.strip.displayName)
                        .font(.headline)
                    Text(row.reason)
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                }
                .padding(.vertical, Layout.headerVerticalPadding)
            }
            Section(ChannelSetupCopy.rolePickerTitle) {
                ForEach(ChannelRole.allCases, id: \.self) { role in
                    Button {
                        onPick(role)
                        dismiss()
                    } label: {
                        HStack {
                            Text(ChannelSetupCopy.roleTitle(role))
                                .foregroundStyle(Color.primary)
                            Spacer()
                            if role == row.role {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(Palette.accent)
                            }
                        }
                    }
                    .accessibilityIdentifier("channelSetup.rolePicker.\(role.rawValue)")
                }
            }
        }
        .navigationTitle(row.strip.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private enum Layout {
        static let headerSpacing: CGFloat = 4
        static let headerVerticalPadding: CGFloat = 4
    }
}
