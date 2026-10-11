import SoundBuddyKit
import SwiftUI

/// The console target picker (#1668): Main LR in its own full-width row
/// above a grid of the 32 channel tiles, each showing the desk's own
/// scribble-strip name and color. One tap selects and dismisses. Pure
/// rendering — `ConsoleTargetModel` (SoundBuddyKit) owns the catalog and the
/// selection.
struct ConsoleTargetPickerView: View {
    let model: ConsoleTargetModel
    let onDone: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
                    if let tooltip = model.chipStatus.tooltip {
                        Text(tooltip)
                            .font(.caption)
                            .foregroundStyle(Palette.secondaryText)
                            .accessibilityIdentifier("consolePicker.tooltip")
                    }
                    if let mainLabel = model.catalog.labels.first {
                        ConsoleTargetTile(label: mainLabel, isSelected: mainLabel.target == model.selected, onSelect: select)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: Layout.tileMinWidth), spacing: Layout.gridSpacing)], spacing: Layout.gridSpacing) {
                        ForEach(Array(model.catalog.labels.dropFirst()), id: \.target) { label in
                            ConsoleTargetTile(label: label, isSelected: label.target == model.selected, onSelect: select)
                        }
                    }
                }
                .padding(Layout.screenPadding)
            }
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle("Console target")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onDone)
                        .foregroundStyle(Palette.accent)
                        .accessibilityIdentifier("consolePicker.done")
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func select(_ target: ConsoleEQTarget) {
        model.select(target)
        onDone()
    }

    private enum Layout {
        static let screenPadding: CGFloat = 16
        static let sectionSpacing: CGFloat = 12
        static let gridSpacing: CGFloat = 10
        static let tileMinWidth: CGFloat = 84
    }
}

/// One tile: a color bar, the desk's display name, and (when it differs)
/// the fallback name small underneath. The selected tile gets an accent
/// border and a checkmark.
private struct ConsoleTargetTile: View {
    let label: ConsoleTargetLabel
    let isSelected: Bool
    let onSelect: (ConsoleEQTarget) -> Void

    var body: some View {
        Button { onSelect(label.target) } label: {
            VStack(alignment: .leading, spacing: Layout.innerSpacing) {
                HStack {
                    colorBar
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Palette.accent)
                    }
                }
                Text(label.displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.primary)
                    .lineLimit(1)
                if label.displayName != label.fallbackName {
                    Text(label.fallbackName)
                        .font(.caption2)
                        .foregroundStyle(Palette.secondaryText)
                        .lineLimit(1)
                }
            }
            .padding(Layout.tilePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Layout.cornerRadius)
                    .strokeBorder(isSelected ? Palette.accent : .clear, lineWidth: Layout.borderWidth)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label.displayName)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("consolePicker.tile.\(ConsoleTargetMemory.storageToken(for: label.target))")
    }

    private var colorBar: some View {
        let color = tintColor(for: label.color.base)
        return Group {
            if label.color.isInverted {
                RoundedRectangle(cornerRadius: Layout.barCornerRadius)
                    .fill(color)
                    .overlay(
                        RoundedRectangle(cornerRadius: Layout.barCornerRadius)
                            .strokeBorder(Color.black.opacity(Layout.invertedBorderOpacity), lineWidth: Layout.borderWidth)
                    )
            } else {
                RoundedRectangle(cornerRadius: Layout.barCornerRadius)
                    .fill(color)
            }
        }
        .frame(height: Layout.barHeight)
        .frame(maxWidth: .infinity)
    }

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
        static let innerSpacing: CGFloat = 6
        static let tilePadding: CGFloat = 10
        static let cornerRadius: CGFloat = 12
        static let barCornerRadius: CGFloat = 4
        static let barHeight: CGFloat = 8
        static let borderWidth: CGFloat = 1.5
        static let invertedBorderOpacity: Double = 0.3
    }
}
