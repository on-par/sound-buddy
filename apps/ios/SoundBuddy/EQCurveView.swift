import SoundBuddyKit
import SwiftUI

/// The read-only EQ panel's curve (#1669): the selected console target's
/// magnitude response across 20 Hz-20 kHz on a ±`ConsoleEQPanelState.
/// curveRangeDb` axis, with the phone-mic RTA drawn faintly behind it so the
/// engineer can compare what the desk is doing to what Sound Buddy hears.
/// While a coaching suggestion is showing (#1671), a dashed ghost curve and
/// ghost band marker overlay the desk's own solid curve — a picture of the
/// change, never a write. Pure rendering — `ConsoleEQPanelState`
/// (SoundBuddyKit) owns every curve and band-marker value; `AnalyzeModel`
/// only supplies the RTA levels for the background trace.
struct EQCurveView: View {
    let eqPanel: ConsoleEQPanelState
    let analyze: AnalyzeModel

    var body: some View {
        Canvas { context, size in
            let plot = CGRect(origin: .zero, size: size).insetBy(dx: Layout.inset, dy: Layout.inset)
            drawGrid(in: &context, plot: plot)
            drawRTA(in: &context, plot: plot)
            drawCurve(in: &context, plot: plot)
            drawGhost(in: &context, plot: plot)
        }
        .frame(height: Layout.height)
        .background(Layout.background, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .accessibilityIdentifier("consoleEQ.curve")
    }

    private func x(_ hz: Double, in plot: CGRect) -> CGFloat {
        plot.minX + plot.width * RTALayout.xFraction(hz: hz)
    }

    /// `db` from -curveRangeDb...curveRangeDb mapped to the plot's height,
    /// 0 dB at the vertical center.
    private func y(_ db: Double, in plot: CGRect) -> CGFloat {
        let span = 2 * ConsoleEQPanelState.curveRangeDb
        let fraction = (db + ConsoleEQPanelState.curveRangeDb) / span
        return plot.maxY - plot.height * CGFloat(min(1, max(0, fraction)))
    }

    private func drawGrid(in context: inout GraphicsContext, plot: CGRect) {
        var border = Path()
        border.addRect(plot)
        context.stroke(border, with: .color(Layout.gridColor), style: StrokeStyle(lineWidth: Layout.gridLineWidth))

        var zeroLine = Path()
        let zeroY = y(0, in: plot)
        zeroLine.move(to: CGPoint(x: plot.minX, y: zeroY))
        zeroLine.addLine(to: CGPoint(x: plot.maxX, y: zeroY))
        context.stroke(zeroLine, with: .color(Layout.gridColor), style: StrokeStyle(lineWidth: Layout.gridLineWidth))
    }

    /// The phone-mic RTA, drawn at low opacity behind the EQ curve, on the
    /// same log-frequency x axis and its own dB window (not the EQ curve's).
    private func drawRTA(in context: inout GraphicsContext, plot: CGRect) {
        let layout = analyze.rtaLayout
        let meter = analyze.rta
        guard meter.levels.count == layout.bands.count else { return }
        for (index, band) in layout.bands.enumerated() {
            let fraction = RTAScale.standard.fraction(db: meter.levels[index])
            guard fraction > 0 else { continue }
            let left = x(band.lowHz, in: plot)
            let right = x(band.highHz, in: plot)
            let top = plot.maxY - plot.height * CGFloat(fraction)
            let bar = CGRect(x: left, y: top, width: max(Layout.minBarWidth, right - left), height: plot.maxY - top)
            context.fill(Path(bar), with: .color(Layout.rtaColor))
        }
    }

    private func drawCurve(in context: inout GraphicsContext, plot: CGRect) {
        let curve = eqPanel.curveDb
        let frequencies = ConsoleEQPanelState.curveFrequencies
        guard curve.count == frequencies.count, !curve.isEmpty else { return }

        var path = Path()
        for (index, hz) in frequencies.enumerated() {
            let point = CGPoint(x: x(hz, in: plot), y: y(curve[index], in: plot))
            if index == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }
        context.stroke(
            path, with: .color(Layout.curveColor),
            style: StrokeStyle(lineWidth: Layout.curveLineWidth, lineCap: .round, lineJoin: .round)
        )
        drawBandMarkers(in: &context, plot: plot)
    }

    private func drawBandMarkers(in context: inout GraphicsContext, plot: CGRect) {
        guard let eq = eqPanel.eq else { return }
        for band in eq.bands {
            let db = eq.magnitudeResponseDb(atHz: [band.freqHz]).first ?? 0
            let clamped = min(ConsoleEQPanelState.curveRangeDb, max(-ConsoleEQPanelState.curveRangeDb, db))
            let point = CGPoint(x: x(band.freqHz, in: plot), y: y(clamped, in: plot))
            let dot = CGRect(
                x: point.x - Layout.markerRadius, y: point.y - Layout.markerRadius,
                width: Layout.markerRadius * 2, height: Layout.markerRadius * 2
            )
            context.fill(Path(ellipseIn: dot), with: .color(Layout.curveColor))
        }
    }

    /// The dashed ghost curve (#1671) for `eqPanel.coaching`'s suggested
    /// band: the desk's own EQ with that band substituted. No-op without a
    /// suggestion or a read EQ (`ghostCurveDb` is empty then).
    private func drawGhost(in context: inout GraphicsContext, plot: CGRect) {
        guard let coaching = eqPanel.coaching, let eq = eqPanel.eq else { return }
        let ghostCurve = eqPanel.ghostCurveDb
        let frequencies = ConsoleEQPanelState.curveFrequencies
        guard ghostCurve.count == frequencies.count, !ghostCurve.isEmpty else { return }

        var path = Path()
        for (index, hz) in frequencies.enumerated() {
            let point = CGPoint(x: x(hz, in: plot), y: y(ghostCurve[index], in: plot))
            if index == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }
        context.stroke(
            path, with: .color(Layout.ghostColor),
            style: StrokeStyle(lineWidth: Layout.ghostLineWidth, lineCap: .round, lineJoin: .round, dash: Layout.ghostDash)
        )

        let ghostEQ = ConsoleCoachingMapper.ghostEQ(eq, applying: coaching)
        let db = ghostEQ.magnitudeResponseDb(atHz: [coaching.band.freqHz]).first ?? 0
        let clamped = min(ConsoleEQPanelState.curveRangeDb, max(-ConsoleEQPanelState.curveRangeDb, db))
        let point = CGPoint(x: x(coaching.band.freqHz, in: plot), y: y(clamped, in: plot))
        let dot = CGRect(
            x: point.x - Layout.ghostMarkerRadius, y: point.y - Layout.ghostMarkerRadius,
            width: Layout.ghostMarkerRadius * 2, height: Layout.ghostMarkerRadius * 2
        )
        context.stroke(
            Path(ellipseIn: dot), with: .color(Layout.ghostColor),
            style: StrokeStyle(lineWidth: Layout.ghostMarkerLineWidth, dash: Layout.ghostDash)
        )
    }

    private enum Layout {
        static let height: CGFloat = 160
        static let inset: CGFloat = 8
        static let cornerRadius: CGFloat = 12
        static let background = Color(red: 0.03, green: 0.035, blue: 0.045)
        static let gridColor = Color.white.opacity(0.12)
        static let gridLineWidth: CGFloat = 0.5
        static let minBarWidth: CGFloat = 1
        static let rtaColor = Color.white.opacity(0.18)
        static let curveColor = Palette.accent
        static let curveLineWidth: CGFloat = 2
        static let markerRadius: CGFloat = 3
        /// The ghost curve/marker (#1671) draw in the accent color at
        /// reduced opacity, dashed, so they read as "not yet real" beside
        /// the desk's own solid curve.
        static let ghostColor = Palette.accent.opacity(0.6)
        static let ghostLineWidth: CGFloat = 2
        static let ghostDash: [CGFloat] = [5, 4]
        static let ghostMarkerRadius: CGFloat = 5
        static let ghostMarkerLineWidth: CGFloat = 1.5
    }
}
