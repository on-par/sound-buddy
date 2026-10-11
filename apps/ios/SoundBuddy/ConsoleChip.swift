import SoundBuddyKit
import SwiftUI

/// The Analyze header's console link chip (#1668): a tinted dot plus the
/// console/target title, e.g. "● M32R · Main LR". Any status other than
/// `.live` adds a second line with the status label. Tapping it opens the
/// target picker. Pure rendering — `ConsoleChipStatus` (SoundBuddyKit) owns
/// every state decision.
struct ConsoleChip: View {
    let title: String
    let status: ConsoleChipStatus
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Layout.dotSpacing) {
                Circle()
                    .fill(tintColor)
                    .frame(width: Layout.dotSize, height: Layout.dotSize)
                if status == .live {
                    Text(title)
                        .font(.footnote.weight(.semibold))
                } else {
                    VStack(alignment: .leading, spacing: Layout.lineSpacing) {
                        Text(title)
                            .font(.footnote.weight(.semibold))
                        Text(status.label)
                            .font(.caption2)
                            .foregroundStyle(Palette.secondaryText)
                    }
                }
            }
            .padding(.horizontal, Layout.paddingH)
            .padding(.vertical, Layout.paddingV)
            .background(Palette.surface, in: Capsule())
            .foregroundStyle(Color.primary)
        }
        .buttonStyle(.plain)
        .lineLimit(1)
        .help(status.tooltip ?? "")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Console \(title), \(status.label)")
        .accessibilityHint(status.tooltip ?? "Choose which console EQ to view")
        .accessibilityIdentifier("analyze.consoleChip")
    }

    private var tintColor: Color {
        switch status.tint {
        case .green: return .green
        case .amber: return .orange
        case .grey: return .gray
        }
    }

    private enum Layout {
        static let dotSize: CGFloat = 8
        static let dotSpacing: CGFloat = 6
        static let lineSpacing: CGFloat = 1
        static let paddingH: CGFloat = 10
        static let paddingV: CGFloat = 5
    }
}
