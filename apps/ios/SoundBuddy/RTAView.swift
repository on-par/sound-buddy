import SoundBuddyKit
import SwiftUI

/// Console-style real-time analyzer: ~60 log-spaced 1/6-octave bars from
/// 20 Hz to 20 kHz on a dBFS grid, with peak-hold ticks, plus a dashed
/// level-matched target line for the active ideal-EQ curve. Warm lows, cool
/// mids/highs (RTAColor). Drawn in one Canvas pass — it redraws at the 20 Hz
/// meter rate, and only this view reads the meter, so the rest of the screen
/// does not re-render with it.
struct RTAView: View {
    let model: AnalyzeModel
    var scale: RTAScale = .standard

    var body: some View {
        let meter = model.rta
        let layout = model.rtaLayout
        let target = model.rtaTargetDb
        Canvas { context, size in
            let plot = CGRect(
                x: RTAMetrics.dbLabelWidth,
                y: RTAMetrics.topInset,
                width: size.width - RTAMetrics.dbLabelWidth - RTAMetrics.trailingInset,
                height: size.height - RTAMetrics.topInset - RTAMetrics.freqLabelHeight
            )
            drawGrid(in: &context, plot: plot)
            drawBars(in: &context, plot: plot, layout: layout, meter: meter)
            if let target, target.count == layout.bands.count {
                drawTarget(in: &context, plot: plot, layout: layout, target: target)
            }
        }
        .frame(height: RTAMetrics.height)
        .background(RTAPalette.plotBackground, in: RoundedRectangle(cornerRadius: RTAMetrics.cornerRadius))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Real-time analyzer, 20 hertz to 20 kilohertz")
        .accessibilityValue(accessibilityValue(layout: layout, meter: meter))
    }

    private func y(_ db: Double, in plot: CGRect) -> CGFloat {
        plot.maxY - plot.height * scale.fraction(db: db)
    }

    private func x(_ hz: Double, in plot: CGRect) -> CGFloat {
        plot.minX + plot.width * RTALayout.xFraction(hz: hz)
    }

    private func drawGrid(in context: inout GraphicsContext, plot: CGRect) {
        let gridStyle = StrokeStyle(lineWidth: RTAMetrics.gridLineWidth)
        for db in scale.dbTicks {
            let lineY = y(db, in: plot)
            var line = Path()
            line.move(to: CGPoint(x: plot.minX, y: lineY))
            line.addLine(to: CGPoint(x: plot.maxX, y: lineY))
            context.stroke(line, with: .color(RTAPalette.grid), style: gridStyle)
            context.draw(
                Text(String(format: "%.0f", db)).font(.system(size: RTAMetrics.labelFontSize).monospacedDigit())
                    .foregroundStyle(RTAPalette.label),
                at: CGPoint(x: plot.minX - RTAMetrics.labelGap, y: lineY),
                anchor: .trailing
            )
        }
        for tick in RTALayout.frequencyTicks {
            let lineX = x(tick.hz, in: plot)
            var line = Path()
            line.move(to: CGPoint(x: lineX, y: plot.minY))
            line.addLine(to: CGPoint(x: lineX, y: plot.maxY))
            context.stroke(line, with: .color(RTAPalette.grid), style: gridStyle)
            context.draw(
                Text(tick.label).font(.system(size: RTAMetrics.labelFontSize).monospacedDigit())
                    .foregroundStyle(RTAPalette.label),
                at: CGPoint(x: lineX, y: plot.maxY + RTAMetrics.labelGap),
                anchor: .top
            )
        }
        context.draw(
            Text("dBFS").font(.system(size: RTAMetrics.labelFontSize).weight(.semibold))
                .foregroundStyle(RTAPalette.label),
            at: CGPoint(x: plot.minX - RTAMetrics.labelGap, y: plot.minY - RTAMetrics.topInset / 2),
            anchor: .trailing
        )
    }

    private func drawBars(in context: inout GraphicsContext, plot: CGRect, layout: RTALayout, meter: RTAMeter) {
        guard meter.levels.count == layout.bands.count else { return }
        for (i, band) in layout.bands.enumerated() {
            let left = x(band.lowHz, in: plot) + RTAMetrics.barGap / 2
            let width = max(RTAMetrics.minBarWidth, x(band.highHz, in: plot) - x(band.lowHz, in: plot) - RTAMetrics.barGap)
            let fraction = scale.fraction(db: meter.levels[i])
            if fraction > 0 {
                let top = y(meter.levels[i], in: plot)
                let bar = CGRect(x: left, y: top, width: width, height: plot.maxY - top)
                let tone = RTAColor.hsb(hz: band.centerHz, fraction: fraction)
                let color = Color(hue: tone.hue, saturation: tone.saturation, brightness: tone.brightness)
                context.fill(
                    Path(bar),
                    with: .linearGradient(
                        Gradient(colors: [color.opacity(RTAMetrics.barBaseOpacity), color]),
                        startPoint: CGPoint(x: bar.midX, y: plot.maxY),
                        endPoint: CGPoint(x: bar.midX, y: top)
                    )
                )
            }
            if scale.fraction(db: meter.peaks[i]) > 0 {
                let peakY = y(meter.peaks[i], in: plot)
                let tick = CGRect(x: left, y: peakY - RTAMetrics.peakTickHeight, width: width, height: RTAMetrics.peakTickHeight)
                context.fill(Path(tick), with: .color(RTAPalette.peak))
            }
        }
    }

    private func drawTarget(in context: inout GraphicsContext, plot: CGRect, layout: RTALayout, target: [Double]) {
        var path = Path()
        for (i, band) in layout.bands.enumerated() {
            let point = CGPoint(x: x(band.centerHz, in: plot), y: y(target[i], in: plot))
            if i == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }
        context.stroke(
            path,
            with: .color(RTAPalette.target),
            style: StrokeStyle(
                lineWidth: RTAMetrics.targetLineWidth,
                lineCap: .round,
                lineJoin: .round,
                dash: RTAMetrics.targetDash
            )
        )
    }

    private func accessibilityValue(layout: RTALayout, meter: RTAMeter) -> String {
        guard model.state == .live,
              let loudest = meter.levels.indices.max(by: { meter.levels[$0] < meter.levels[$1] }),
              loudest < layout.bands.count
        else { return "not listening" }
        let hz = layout.bands[loudest].centerHz
        let position = hz >= 1000 ? String(format: "%.1f kilohertz", hz / 1000) : "\(Int(hz.rounded())) hertz"
        return "Loudest around \(position), estimated"
    }
}

private enum RTAMetrics {
    static let height: CGFloat = 300
    static let cornerRadius: CGFloat = 12
    static let dbLabelWidth: CGFloat = 34
    static let trailingInset: CGFloat = 10
    static let topInset: CGFloat = 18
    static let freqLabelHeight: CGFloat = 20
    static let labelGap: CGFloat = 4
    static let labelFontSize: CGFloat = 9
    static let gridLineWidth: CGFloat = 0.5
    static let barGap: CGFloat = 1.5
    static let minBarWidth: CGFloat = 1
    static let peakTickHeight: CGFloat = 2
    /// Bars fade toward the floor, like a lit LED column.
    static let barBaseOpacity = 0.45
    static let targetLineWidth: CGFloat = 1.5
    static let targetDash: [CGFloat] = [5, 4]
}

enum RTAPalette {
    static let plotBackground = Color(red: 0.03, green: 0.035, blue: 0.045)
    static let grid = Color.white.opacity(0.12)
    static let label = Color.white.opacity(0.55)
    static let peak = Color.white.opacity(0.9)
    /// High-opacity white rather than the gold accent: gold would blend into
    /// the hot end of the warm low-band ramp (RTAColor), and white reads
    /// consistently against both the warm lows and the cool mids/highs.
    static let target = Color.white.opacity(0.85)
}
