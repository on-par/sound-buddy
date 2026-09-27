import Foundation

/// One draggable control point on the target curve, positioned on the Mac's
/// 48-point grid (#1559).
public struct TargetCurveHandle: Equatable, Sendable {
    /// 0..<TargetCurveHandles.handleCount, left to right.
    public let ordinal: Int
    /// Index into IdealCurve.gridFreqs / dbOffsets.
    public let gridIndex: Int
    public let hz: Double
    /// The curve's own offset at gridIndex — not level-matched.
    public let offsetDb: Double
}

/// Reshapes the RTA's live target curve by dragging a thinned set of control
/// points on the 48-point Mac grid (ADR for #1559). Editing happens on
/// IdealCurve's own grid, never on a display grid — ADR-0154 already forbids
/// index-pairing dbOffsets against the RTA bands, and the same rule applies
/// here: the handles sit on gridFreqs, not on RTALayout's ~60 bands.
public enum TargetCurveHandles {
    /// Ten handles are dense enough to reshape a curve and sparse enough to
    /// hit on an iPhone; every one of the 48 grid points would be ~7pt apart.
    public static let handleCount = 10
    /// round(k * (gridPoints - 1) / (handleCount - 1)) for k in 0..<handleCount.
    public static let gridIndices: [Int] = (0..<handleCount).map {
        Int((Double($0) * Double(IdealCurve.gridPoints - 1) / Double(handleCount - 1)).rounded())
    }
    public static let customId = "custom"
    public static let customLabel = "Custom"
    static let customDescription = "Edited on Analyze."

    /// `curve` resampled onto `IdealCurve.gridFreqs` via `offset(atHz:)`.
    /// Returns `curve` unchanged when its freqs already equal the grid.
    public static func onGrid(_ curve: IdealCurve) -> IdealCurve {
        guard curve.freqs != IdealCurve.gridFreqs else { return curve }
        let offsets = IdealCurve.gridFreqs.map { curve.offset(atHz: $0) }
        return IdealCurve(
            id: curve.id,
            label: curve.label,
            description: curve.description,
            freqs: IdealCurve.gridFreqs,
            dbOffsets: offsets
        )
    }

    /// The current handle positions of `curve`, resampled onto the grid first.
    public static func handles(for curve: IdealCurve) -> [TargetCurveHandle] {
        let grid = onGrid(curve)
        return gridIndices.enumerated().map { ordinal, gridIndex in
            TargetCurveHandle(ordinal: ordinal, gridIndex: gridIndex, hz: grid.freqs[gridIndex], offsetDb: grid.dbOffsets[gridIndex])
        }
    }

    /// Sets `handle`'s grid point to `offsetDb`, and spreads the delta onto
    /// the grid points strictly between it and its neighbouring handles with
    /// a raised-cosine weight `w(t) = 0.5 * (1 + cos(pi * t))`, `t` the
    /// fractional distance to the neighbour — zero slope at both handles, so
    /// the edited curve reads as a smooth spline rather than a tent. Neighbour
    /// handles themselves never move. An out-of-range `handle` returns
    /// `onGrid(curve)` unchanged. The result always has `freqs == gridFreqs`
    /// and the id/label `customId`/`customLabel`.
    public static func moving(_ curve: IdealCurve, handle: Int, toOffsetDb offsetDb: Double) -> IdealCurve {
        let grid = onGrid(curve)
        guard gridIndices.indices.contains(handle) else { return grid }
        var offsets = grid.dbOffsets
        let handleIndex = gridIndices[handle]
        let delta = offsetDb - offsets[handleIndex]
        offsets[handleIndex] = offsetDb

        if handle > 0 {
            spread(delta: delta, from: handleIndex, to: gridIndices[handle - 1], into: &offsets)
        }
        if handle < gridIndices.count - 1 {
            spread(delta: delta, from: handleIndex, to: gridIndices[handle + 1], into: &offsets)
        }

        return IdealCurve(
            id: customId,
            label: customLabel,
            description: customDescription,
            freqs: IdealCurve.gridFreqs,
            dbOffsets: offsets
        )
    }

    /// Applies `delta * 0.5 * (1 + cos(pi * t))` to every grid point strictly
    /// between `handleIndex` and `neighbourIndex`, `t` the fraction of the way
    /// from the handle to the neighbour.
    private static func spread(delta: Double, from handleIndex: Int, to neighbourIndex: Int, into offsets: inout [Double]) {
        let span = neighbourIndex - handleIndex
        guard span != 0 else { return }
        let lower = min(handleIndex, neighbourIndex)
        let upper = max(handleIndex, neighbourIndex)
        guard upper - lower > 1 else { return }
        for i in (lower + 1)..<upper {
            let t = Double(i - handleIndex) / Double(span)
            let weight = 0.5 * (1 + cos(.pi * t))
            offsets[i] += delta * weight
        }
    }
}

/// One active handle drag, captured at grab so the finger drives a delta
/// from the grab point rather than an absolute jump (#1559 ADR).
public struct TargetHandleDrag: Equatable, Sendable {
    public let handle: Int
    public let startOffsetDb: Double
    /// The RTA's dB-mean level-match shift, frozen for the whole drag so the
    /// handle stays under the finger while it moves.
    public let levelShiftDb: Double

    public init(handle: Int, startOffsetDb: Double, levelShiftDb: Double) {
        self.handle = handle
        self.startOffsetDb = startOffsetDb
        self.levelShiftDb = levelShiftDb
    }

    /// `startOffsetDb + fraction * scale.spanDb`, clamped so the *displayed*
    /// value (`result + levelShiftDb`) stays inside `[scale.floorDb,
    /// scale.ceilingDb]` — the handle can never leave the visible RTA.
    /// `fraction` is the vertical drag translation as a fraction of the
    /// plot's height, positive meaning up.
    public func offsetDb(forTranslationFraction fraction: Double, scale: RTAScale) -> Double {
        let raw = startOffsetDb + fraction * scale.spanDb
        let displayed = min(scale.ceilingDb, max(scale.floorDb, raw + levelShiftDb))
        return displayed - levelShiftDb
    }
}
