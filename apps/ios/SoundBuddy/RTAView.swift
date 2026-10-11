import SoundBuddyKit
import SwiftUI

/// Console-style real-time analyzer: ~60 log-spaced 1/6-octave bars from
/// 20 Hz to 20 kHz (numeric ticks only, no unit title, #1610), drawn per the
/// shared RTA display spec (#1707, docs/rta-display-spec.md):
/// - **Relative** (default): each bar is the band's deviation from the
///   level-matched target, growing up or down from a solid 0 line on a
///   ±15 dB grid; gray within ±3 dB, amber over, cyan under; values past
///   ±15 clamp with a cap marker.
/// - **Absolute**: dBFS bars on −96…0 with the dashed level-matched target
///   line, warm lows and cool mids/highs (RTAColor). Target editing always
///   draws Absolute.
/// Bars are semi-transparent; peak ticks hold then fall in both views. When
/// showsProblemMarkers is on, pulsing amber/cyan regions hug the target (the
/// 0 line in Relative) over each coaching problem band (#1553), text-free.
/// While live the canvas redraws every display frame (≥30 fps), stepping the
/// ballistics from the latest 20 Hz analysis frame; only this view reads the
/// meter, so the rest of the screen does not re-render with it.
struct RTAView: View {
    let model: AnalyzeModel
    var fillsHeight: Bool = false
    var showsProblemMarkers: Bool = false
    @AppStorage(RTAViewMode.defaultsKey) private var requestedMode = RTAViewMode.defaultValue
    @State private var stepper = RTAFrameStepperBox()

    private var mode: RTAViewMode {
        RTAViewMode.effective(requested: requestedMode, isEditingTarget: model.isEditingTarget)
    }

    /// The handle drag clamp authority (#1559): editing always draws
    /// Absolute, whose window is the model's `rtaScale`.
    private var scale: RTAScale {
        mode == .absolute ? model.rtaScale : mode.scale
    }

    var body: some View {
        let layout = model.rtaLayout
        let target = model.rtaTargetDb
        let isEditingTarget = model.isEditingTarget
        let viewMode = self.mode
        let isLive = model.state == .live
        let input = model.rtaInput
        let targetOffsets = model.rtaTargetOffsets
        let ballistics = model.rtaBallistics.ballistics
        let spans = showsProblemMarkers ? RTAProblemMarkers.spans(for: model.problemMarkers, on: layout) : []
        TimelineView(.animation(paused: !isLive && spans.isEmpty)) { timeline in
            let display = stepper.advance(
                to: timeline.date.timeIntervalSinceReferenceDate,
                input: input,
                targetOffsets: targetOffsets,
                ballistics: ballistics
            )
            Canvas { context, size in
                let plot = plotRect(in: size)
                drawGrid(in: &context, plot: plot, mode: viewMode)
                let pulse = RTAProblemMarkers.pulseOpacity(atSeconds: timeline.date.timeIntervalSinceReferenceDate)
                switch viewMode {
                case .relative:
                    drawRelativeBars(in: &context, plot: plot, layout: layout, display: display)
                    if target != nil {
                        let zero = Array(repeating: 0.0, count: layout.bands.count)
                        if !spans.isEmpty {
                            drawProblemMarkers(in: &context, plot: plot, layout: layout, target: zero, spans: spans, opacity: pulse)
                        }
                        drawZeroLine(in: &context, plot: plot)
                    }
                case .absolute:
                    drawAbsoluteBars(in: &context, plot: plot, layout: layout, display: display)
                    if let target, target.count == layout.bands.count {
                        if !spans.isEmpty {
                            drawProblemMarkers(in: &context, plot: plot, layout: layout, target: target, spans: spans, opacity: pulse)
                        }
                        drawTarget(in: &context, plot: plot, layout: layout, target: target, isEditing: isEditingTarget)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(viewMode == .relative
            ? "Real-time analyzer, relative to target, plus or minus 15 decibels, 20 hertz to 20 kilohertz"
            : "Real-time analyzer, minus 96 to 0 dBFS, 20 hertz to 20 kilohertz")
        .accessibilityValue(accessibilityValue(layout: layout, levels: model.rta.levels))
        .accessibilityIdentifier("analyze.rta.\(viewMode.rawValue)")
        .overlay {
            if isEditingTarget {
                GeometryReader { proxy in
                    handleOverlay(in: plotRect(in: proxy.size))
                }
            }
        }
        .frame(
            minHeight: fillsHeight ? RTAMetrics.minFillHeight : RTAMetrics.height,
            maxHeight: fillsHeight ? .infinity : RTAMetrics.height
        )
        .background(RTAPalette.plotBackground, in: RoundedRectangle(cornerRadius: RTAMetrics.cornerRadius))
    }

    private func plotRect(in size: CGSize) -> CGRect {
        CGRect(
            x: RTAMetrics.dbLabelWidth,
            y: RTAMetrics.topInset,
            width: size.width - RTAMetrics.dbLabelWidth - RTAMetrics.trailingInset,
            height: size.height - RTAMetrics.topInset - RTAMetrics.freqLabelHeight
        )
    }

    private func y(_ db: Double, in plot: CGRect) -> CGFloat {
        plot.maxY - plot.height * scale.fraction(db: db)
    }

    private func x(_ hz: Double, in plot: CGRect) -> CGFloat {
        plot.minX + plot.width * RTALayout.xFraction(hz: hz)
    }

    /// One draggable circle per `model.rtaTargetHandles` entry, while editing.
    /// The first `onChanged` grabs the handle (firing the haptic on success);
    /// later calls drag it; `onEnded` releases it. `DragGesture(minimumDistance:
    /// 0)` so a tap-and-hold grabs immediately, with no dead zone.
    private func handleOverlay(in plot: CGRect) -> some View {
        ForEach(model.rtaTargetHandles, id: \.handle.ordinal) { entry in
            let ordinal = entry.handle.ordinal
            let isActive = model.activeTargetHandle == ordinal
            let diameter = isActive ? RTAMetrics.activeHandleDiameter : RTAMetrics.handleDiameter
            Circle()
                .fill(RTAPalette.target)
                .frame(width: diameter, height: diameter)
                .contentShape(Circle().size(width: RTAMetrics.handleHitDiameter, height: RTAMetrics.handleHitDiameter))
                .position(x: x(entry.handle.hz, in: plot), y: y(entry.displayDb, in: plot))
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            if model.activeTargetHandle == nil {
                                if model.beginTargetHandleDrag(ordinal) {
                                    fireHapticForHandleGrab()
                                }
                            }
                            model.dragTargetHandle(translationFraction: -value.translation.height / plot.height)
                        }
                        .onEnded { value in
                            model.dragTargetHandle(translationFraction: -value.translation.height / plot.height)
                            model.endTargetHandleDrag()
                        }
                )
                .accessibilityIdentifier("analyze.targetHandle.\(ordinal)")
                .accessibilityLabel("Target handle, \(Int(entry.handle.hz.rounded())) hertz")
                .accessibilityAdjustableAction { direction in
                    let stepDb = direction == .increment ? RTAMetrics.accessibilityStepDb : -RTAMetrics.accessibilityStepDb
                    if model.beginTargetHandleDrag(ordinal) {
                        model.dragTargetHandle(translationFraction: stepDb / scale.spanDb)
                        model.endTargetHandleDrag()
                    }
                }
        }
    }

    private func fireHapticForHandleGrab() {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
    }

    private func drawGrid(in context: inout GraphicsContext, plot: CGRect, mode: RTAViewMode) {
        let gridStyle = StrokeStyle(lineWidth: RTAMetrics.gridLineWidth)
        for db in scale.dbTicks {
            let lineY = y(db, in: plot)
            var line = Path()
            line.move(to: CGPoint(x: plot.minX, y: lineY))
            line.addLine(to: CGPoint(x: plot.maxX, y: lineY))
            context.stroke(line, with: .color(RTAPalette.grid), style: gridStyle)
            let label = mode == .relative && db > 0 ? String(format: "+%.0f", db) : String(format: "%.0f", db)
            context.draw(
                Text(label).font(.system(size: RTAMetrics.labelFontSize).monospacedDigit())
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
    }

    private func barRect(for band: RTABand, in plot: CGRect) -> (left: CGFloat, width: CGFloat) {
        let left = x(band.lowHz, in: plot) + RTAMetrics.barGap / 2
        let width = max(RTAMetrics.minBarWidth, x(band.highHz, in: plot) - x(band.lowHz, in: plot) - RTAMetrics.barGap)
        return (left, width)
    }

    /// Absolute view: dBFS bars from the floor, warm lows and cool highs,
    /// semi-transparent so the target line stays visible behind them.
    private func drawAbsoluteBars(in context: inout GraphicsContext, plot: CGRect, layout: RTALayout, display: RTADisplayModel) {
        guard display.levels.count == layout.bands.count else { return }
        for (i, band) in layout.bands.enumerated() {
            let (left, width) = barRect(for: band, in: plot)
            let fraction = scale.fraction(db: display.levels[i])
            if fraction > 0 {
                let top = y(display.levels[i], in: plot)
                let bar = CGRect(x: left, y: top, width: width, height: plot.maxY - top)
                let tone = RTAColor.hsb(hz: band.centerHz, fraction: fraction)
                let color = Color(hue: tone.hue, saturation: tone.saturation, brightness: tone.brightness)
                context.fill(
                    Path(bar),
                    with: .linearGradient(
                        Gradient(colors: [
                            color.opacity(RTAMetrics.barBaseOpacity * RTAMetrics.barFillOpacity),
                            color.opacity(RTAMetrics.barFillOpacity),
                        ]),
                        startPoint: CGPoint(x: bar.midX, y: plot.maxY),
                        endPoint: CGPoint(x: bar.midX, y: top)
                    )
                )
            }
            if scale.fraction(db: display.peaks[i]) > 0 {
                drawPeakTick(in: &context, left: left, width: width, y: y(display.peaks[i], in: plot))
            }
        }
    }

    /// Relative view: each bar grows up or down from the 0 line to its
    /// clamped deviation; gray within ±3 dB, amber over, cyan under. A value
    /// past ±15 dB gets a cap marker at the edge it crossed.
    private func drawRelativeBars(in context: inout GraphicsContext, plot: CGRect, layout: RTALayout, display: RTADisplayModel) {
        guard display.deviations.count == layout.bands.count else { return }
        let zeroY = y(0, in: plot)
        for (i, band) in layout.bands.enumerated() {
            let (left, width) = barRect(for: band, in: plot)
            let deviation = display.deviations[i]
            let clamped = scale.clamp(deviation)
            let valueY = y(clamped.db, in: plot)
            let color = RTAPalette.deviation(RTADeviationTone(deviationDb: deviation))
            let bar = CGRect(x: left, y: min(zeroY, valueY), width: width, height: abs(valueY - zeroY))
            context.fill(Path(bar), with: .color(color.opacity(RTAMetrics.barFillOpacity)))
            if let overflow = clamped.overflow {
                let capY = overflow == .above ? plot.minY : plot.maxY - RTAMetrics.overflowCapHeight
                context.fill(Path(CGRect(x: left, y: capY, width: width, height: RTAMetrics.overflowCapHeight)), with: .color(color))
            }
            let peak = scale.clamp(display.deviationPeaks[i]).db
            drawPeakTick(in: &context, left: left, width: width, y: y(peak, in: plot))
        }
    }

    private func drawPeakTick(in context: inout GraphicsContext, left: CGFloat, width: CGFloat, y peakY: CGFloat) {
        let tick = CGRect(x: left, y: peakY - RTAMetrics.peakTickHeight / 2, width: width, height: RTAMetrics.peakTickHeight)
        context.fill(Path(tick), with: .color(RTAPalette.peak))
    }

    /// Relative view's solid 0 line: the level-matched target itself.
    private func drawZeroLine(in context: inout GraphicsContext, plot: CGRect) {
        var line = Path()
        let zeroY = y(0, in: plot)
        line.move(to: CGPoint(x: plot.minX, y: zeroY))
        line.addLine(to: CGPoint(x: plot.maxX, y: zeroY))
        context.stroke(line, with: .color(RTAPalette.target), style: StrokeStyle(lineWidth: RTAMetrics.targetLineWidth))
    }

    /// Dashed while it's a fixed reference; solid and slightly thicker while
    /// editing, so the line itself reads as the thing being reshaped (#1559).
    private func drawTarget(in context: inout GraphicsContext, plot: CGRect, layout: RTALayout, target: [Double], isEditing: Bool) {
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
                lineWidth: isEditing ? RTAMetrics.editingTargetLineWidth : RTAMetrics.targetLineWidth,
                lineCap: .round,
                lineJoin: .round,
                dash: isEditing ? [] : RTAMetrics.targetDash
            )
        )
    }

    /// Points along the target curve over `span`'s RTA bands, at their
    /// centers — except a single-band span, which is widened to that band's
    /// own low/high edges so the region has visible width.
    private func targetPolyline(for span: RTAMarkerSpan, layout: RTALayout, target: [Double], plot: CGRect) -> [CGPoint] {
        let indices = Array(span.bandIndices)
        if indices.count == 1, let i = indices.first {
            let band = layout.bands[i]
            let ty = y(target[i], in: plot)
            return [CGPoint(x: x(band.lowHz, in: plot), y: ty), CGPoint(x: x(band.highHz, in: plot), y: ty)]
        }
        return indices.map { i in CGPoint(x: x(layout.bands[i].centerHz, in: plot), y: y(target[i], in: plot)) }
    }

    /// A pulsing region hugging the target curve over `span`: above it in
    /// amber for `.overTarget`, below it in cyan for `.underTarget`. No text.
    private func drawProblemMarkers(
        in context: inout GraphicsContext,
        plot: CGRect,
        layout: RTALayout,
        target: [Double],
        spans: [RTAMarkerSpan],
        opacity: Double
    ) {
        for span in spans {
            let nearPoints = targetPolyline(for: span, layout: layout, target: target, plot: plot)
            guard nearPoints.count >= 2 else { continue }
            let sign: CGFloat = span.direction == .overTarget ? -1 : 1
            let farPoints = nearPoints.map { point -> CGPoint in
                let farY = point.y + sign * RTAMetrics.markerDepth
                let clampedY = span.direction == .overTarget ? max(plot.minY, farY) : min(plot.maxY, farY)
                return CGPoint(x: point.x, y: clampedY)
            }
            var region = Path()
            region.move(to: nearPoints[0])
            for point in nearPoints.dropFirst() { region.addLine(to: point) }
            for point in farPoints.reversed() { region.addLine(to: point) }
            region.closeSubpath()

            let color = span.direction == .overTarget ? RTAPalette.overTargetMarker : RTAPalette.underTargetMarker
            let midX = (nearPoints.first!.x + nearPoints.last!.x) / 2
            context.fill(
                region,
                with: .linearGradient(
                    Gradient(colors: [color.opacity(opacity), color.opacity(0)]),
                    startPoint: CGPoint(x: midX, y: nearPoints[0].y),
                    endPoint: CGPoint(x: midX, y: farPoints[0].y)
                )
            )
        }
    }

    private func accessibilityValue(layout: RTALayout, levels: [Double]) -> String {
        guard model.state == .live,
              let loudest = levels.indices.max(by: { levels[$0] < levels[$1] }),
              loudest < layout.bands.count
        else { return "not listening" }
        let hz = layout.bands[loudest].centerHz
        let position = hz >= 1000 ? String(format: "%.1f kilohertz", hz / 1000) : "\(Int(hz.rounded())) hertz"
        return "Loudest around \(position), estimated"
    }
}

private enum RTAMetrics {
    static let height: CGFloat = 300
    /// fillsHeight floor (landscape, iPad tall portrait and wide, #1659), so
    /// the grid stays readable on an SE in landscape.
    static let minFillHeight: CGFloat = 120
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
    /// Spec fill opacity (0.55 to 0.7): semi-transparent, so the target and
    /// EQ curve stay visible behind the bars (#1707).
    static let barFillOpacity = 0.6
    /// The cap marker on a Relative bar past ±15 dB.
    static let overflowCapHeight: CGFloat = 2
    static let targetLineWidth: CGFloat = 1.5
    static let targetDash: [CGFloat] = [5, 4]
    /// Thicker than the dashed reference line, so an editable target reads
    /// differently at a glance (#1559).
    static let editingTargetLineWidth: CGFloat = 2.5
    /// How far a problem-marker region extends from the target line (#1553).
    static let markerDepth: CGFloat = 22
    static let handleDiameter: CGFloat = 12
    static let activeHandleDiameter: CGFloat = 16
    /// Bigger than the visible circle, so a handle stays easy to grab on an
    /// iPhone without widening the drawn dot.
    static let handleHitDiameter: CGFloat = 32
    /// VoiceOver's adjustable-action nudge for a target handle.
    static let accessibilityStepDb: Double = 1
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
    /// Over-target problem markers (#1553): warm amber, cut suggested.
    static let overTargetMarker = Color(red: 1.0, green: 0.66, blue: 0.2)
    /// Under-target problem markers (#1553): cool cyan, boost suggested.
    static let underTargetMarker = Color(red: 0.25, green: 0.85, blue: 1.0)
    /// Relative-view bar within ±3 dB of the target (#1707).
    static let neutralDeviation = Color(white: 0.62)

    /// Relative-view bar color: amber #FFA833 over, cyan #40D9FF under (the
    /// problem-marker palette), neutral gray within ±3 dB.
    static func deviation(_ tone: RTADeviationTone) -> Color {
        switch tone {
        case .neutral: neutralDeviation
        case .over: overTargetMarker
        case .under: underTargetMarker
        }
    }
}

/// Holds the render-rate RTA stepper across body evaluations. A reference
/// type on purpose: it advances once per TimelineView frame and must not
/// invalidate the view when it does.
final class RTAFrameStepperBox {
    private var stepper = RTAFrameStepper()

    func advance(to time: TimeInterval, input: [Double], targetOffsets: [Double], ballistics: RTABallistics) -> RTADisplayModel {
        if input.isEmpty {
            stepper.reset()
        } else {
            stepper.advance(to: time, input: input, targetOffsets: targetOffsets, ballistics: ballistics)
        }
        return stepper.display
    }
}
