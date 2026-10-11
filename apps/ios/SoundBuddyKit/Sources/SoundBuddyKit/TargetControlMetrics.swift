import Foundation

/// Sizes for the target band under the RTA (#1744): the Target legend and
/// its pencil, the "Editing target" chip's Cancel/Done, and the preset
/// pills. On iPad (regular width) everything steps up to a 44 pt hit target
/// so the pencil is easy to hit at FOH; iPhone keeps today's layout sizes and
/// only grows the pencil's tappable shape. Pure, so the view's sizes are
/// tested here.
public struct TargetControlMetrics: Equatable, Sendable {
    /// Text style step for the legend, chip and pills. The app maps it to a
    /// Dynamic Type font, so ordering is "smaller < larger".
    public enum TextStep: Int, Comparable, Sendable {
        case caption
        case subheadline

        public static func < (lhs: TextStep, rhs: TextStep) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    /// Apple's minimum comfortable hit target (points).
    public static let minimumHitTarget = 44.0
    /// Approximate line height of `.caption` at the default text size. Used
    /// only to size the compact pencil's hit outset.
    public static let compactCaptionLineHeight = 16.0

    public let textStep: TextStep
    public let swatchWidth: Double
    public let swatchHeight: Double
    /// Minimum hit size for every target control's layout frame; 0 means the
    /// controls keep their natural (text) size.
    public let minHitSize: Double
    /// Square size of the pencil's own button; 0 means a bare glyph.
    public let pencilButtonSize: Double
    /// Whether the pencil is drawn as a distinct capsule button.
    public let pencilIsBordered: Bool
    /// Extra tappable margin around the pencil that does not take layout
    /// space (iPhone), so the band's height never changes.
    public let hitOutset: Double
    /// Minimum height of the legend / editing-chip row.
    public let rowMinHeight: Double
    /// Minimum height of each preset pill.
    public let pillMinHeight: Double
    /// Minimum height of the chip's Cancel and Done buttons.
    public let editButtonMinHeight: Double
    public let pillVerticalPadding: Double
    public let editChipVerticalPadding: Double

    /// iPhone (compact width): today's sizes; the pencil's hit area grows to
    /// 44 pt through `hitOutset` only.
    public static let compact = TargetControlMetrics(
        textStep: .caption,
        swatchWidth: 18,
        swatchHeight: 8,
        minHitSize: 0,
        pencilButtonSize: 0,
        pencilIsBordered: false,
        hitOutset: ((minimumHitTarget - compactCaptionLineHeight) / 2).rounded(.up),
        rowMinHeight: 0,
        pillMinHeight: 0,
        editButtonMinHeight: 0,
        pillVerticalPadding: 5,
        editChipVerticalPadding: 5
    )

    /// iPad (regular width): one text step up, a larger swatch, a bordered
    /// pencil, and 44 pt hit targets for every control in the band.
    public static let regular = TargetControlMetrics(
        textStep: .subheadline,
        swatchWidth: 24,
        swatchHeight: 10,
        minHitSize: minimumHitTarget,
        pencilButtonSize: minimumHitTarget,
        pencilIsBordered: true,
        hitOutset: 0,
        rowMinHeight: minimumHitTarget,
        pillMinHeight: minimumHitTarget,
        editButtonMinHeight: minimumHitTarget,
        pillVerticalPadding: 0,
        editChipVerticalPadding: 0
    )

    /// The band's minimum height: the legend / chip row (both always laid
    /// out in one slot) plus the preset strip (always laid out, hidden when
    /// idle), with `spacing` between. Independent of editing, so toggling
    /// edit mode never moves the RTA (#1565).
    public func bandMinHeight(isEditing _: Bool, spacing: Double) -> Double {
        rowMinHeight + spacing + pillMinHeight
    }
}

extension AnalyzeLayout {
    /// The iPad layouts (tall portrait and wide) get the larger target controls.
    public var usesRegularTargetControls: Bool { self == .tallPortrait || self == .wide }

    /// Target band sizes for a regular (iPad) or compact (iPhone) width (#1744).
    public static func targetControlMetrics(isRegularWidth: Bool) -> TargetControlMetrics {
        isRegularWidth ? .regular : .compact
    }

    /// Target band sizes for this layout.
    public var targetControlMetrics: TargetControlMetrics {
        Self.targetControlMetrics(isRegularWidth: usesRegularTargetControls)
    }
}
