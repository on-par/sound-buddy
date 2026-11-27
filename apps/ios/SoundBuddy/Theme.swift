import SoundBuddyKit
import SwiftUI

/// Mirrors the Mac renderer's design tokens (app/renderer :root) — dark
/// neutrals with the gold accent. Internal (not file-private) so other
/// Analyze-adjacent views (e.g. ConsoleChip) share the same tokens.
enum Palette {
    static let background = hex(0x0B0C0F) // --neutral-950 (--bg-app)
    static let surface = hex(0x1B1F26) // --neutral-800 (--surface)
    static let accent = hex(0xEBB93C) // --gold-500
    static let live = hex(0x3FB950)
    static let error = hex(0xE5534B)
    static let secondaryText = hex(0xA2AAB6) // --neutral-300 (--text-secondary)
    /// Shares RTAPalette.target so the legend swatch matches the dashed line
    /// drawn on the RTA itself.
    static let target = RTAPalette.target

    static let panel = hex(0x101217)
    static let panel2 = hex(0x15181E)
    static let surfaceRaised = hex(0x22262F)
    static let inset = hex(0x08090B)
    static let goldText = hex(0xF3CA5E)
    static let onAccent = hex(0x1A1500)
    static let primaryText = hex(0xE6E9EE)
    static let tertiaryText = hex(0x7A828F)
    static let good = hex(0x33B85A)
    static let goodText = hex(0x57D77C)
    static let check = hex(0xE8862E)
    static let checkText = hex(0xF2A65A)
    static let issue = hex(0xE5484D)
    static let issueText = hex(0xF26D71)
    static let info = hex(0x4C93F0)
    static let infoText = hex(0x7DB0F7)
    static let targetLine = hex(0x6FA8F5)
    static let borderSubtle = Color.white.opacity(0.055)
    static let borderStrong = Color.white.opacity(0.09)

    static func band(_ band: Band) -> Color {
        switch band {
        case .subBass: hex(0x4C63D2)
        case .bass: hex(0x3D82D6)
        case .lowMid: hex(0x2BA2C9)
        case .mid: hex(0x23BBA6)
        case .highMid: hex(0x5FC96F)
        case .presence: hex(0xD9B23E)
        case .brilliance: hex(0xEC8B3E)
        }
    }

    static func hex(_ rgb: UInt32) -> Color {
        Color(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

enum ThemeMetrics {
    static let minimumHitTarget = CGFloat(TargetControlMetrics.minimumHitTarget)
    static let primaryActionHeight: CGFloat = 50
    static let cardRadius: CGFloat = 16
    static let sheetRadius: CGFloat = 22
    static let wellRadius: CGFloat = 14
    static let tileRadius: CGFloat = 10
    static let hairline: CGFloat = 1
    static let pillTintOpacity = 0.15
    static let pillBorderOpacity = 0.35
    static let pillTracking: CGFloat = 0.6
    static let pillPaddingH: CGFloat = 8
    static let pillPaddingV: CGFloat = 3
    static let segmentPaddingH: CGFloat = 12
    static let segmentInset: CGFloat = 2
}

enum StatusTone {
    case check
    case issue
    case gold

    var color: Color {
        switch self {
        case .check: Palette.check
        case .issue: Palette.issue
        case .gold: Palette.accent
        }
    }

    var text: Color {
        switch self {
        case .check: Palette.checkText
        case .issue: Palette.issueText
        case .gold: Palette.goldText
        }
    }

    init(_ severity: AttentionSeverity) {
        switch severity {
        case .issue: self = .issue
        case .check: self = .check
        }
    }
}

struct StatusPill: View {
    let text: String
    let tone: StatusTone

    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(ThemeMetrics.pillTracking)
            .lineLimit(1)
            .foregroundStyle(tone.text)
            .padding(.horizontal, ThemeMetrics.pillPaddingH)
            .padding(.vertical, ThemeMetrics.pillPaddingV)
            .background(tone.color.opacity(ThemeMetrics.pillTintOpacity), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(ThemeMetrics.pillBorderOpacity), lineWidth: ThemeMetrics.hairline))
    }
}

struct SegmentedPills<Value: Hashable>: View {
    let options: [Value]
    @Binding var selection: Value
    let title: (Value) -> String
    let identifier: (Value) -> String

    var body: some View {
        HStack(spacing: ThemeMetrics.segmentInset) {
            ForEach(options, id: \.self) { option in
                let selected = option == selection
                Button {
                    selection = option
                } label: {
                    Text(title(option))
                        .font(.footnote.weight(.semibold).monospacedDigit())
                        .lineLimit(1)
                        .padding(.horizontal, ThemeMetrics.segmentPaddingH)
                        .frame(minWidth: ThemeMetrics.minimumHitTarget, minHeight: ThemeMetrics.minimumHitTarget)
                        .foregroundStyle(selected ? Palette.goldText : Palette.tertiaryText)
                        .background(selected ? Palette.surfaceRaised : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier(identifier(option))
            }
        }
        .padding(ThemeMetrics.segmentInset)
        .background(Palette.panel2, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.borderSubtle, lineWidth: ThemeMetrics.hairline))
    }
}

extension ConsoleChannelColor {
    var scribbleTint: Color {
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
}
