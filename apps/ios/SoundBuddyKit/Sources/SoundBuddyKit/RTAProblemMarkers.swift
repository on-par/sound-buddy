import Foundation

/// One problem-marker descriptor placed on the RTA grid: which contiguous RTA
/// bands it covers and which side of the target line it pulses on.
public struct RTAMarkerSpan: Equatable, Sendable {
    public let direction: ProblemMarkerDescriptor.Direction
    /// Indices into `RTALayout.bands`, contiguous and non-empty.
    public let bandIndices: ClosedRange<Int>

    public init(direction: ProblemMarkerDescriptor.Direction, bandIndices: ClosedRange<Int>) {
        self.direction = direction
        self.bandIndices = bandIndices
    }
}

/// Pure geometry + timing for the RTA's text-free problem markers (#1553).
public enum RTAProblemMarkers {
    public static let pulsePeriodSeconds = 1.6
    public static let pulseMinOpacity = 0.25
    public static let pulseMaxOpacity = 0.7

    /// One span per descriptor that overlaps at least one RTA band, in
    /// descriptor order. A descriptor covers the contiguous RTA band indices
    /// whose centerHz lies in [lowHz, highHz) — except the top band, whose
    /// highHz is inclusive so a descriptor's own top edge (e.g. brilliance's
    /// 20 kHz, RTALayout.maxHz) still matches the RTA's last band. Descriptors
    /// that cover no RTA band are dropped.
    public static func spans(for markers: [ProblemMarkerDescriptor], on layout: RTALayout) -> [RTAMarkerSpan] {
        markers.compactMap { marker in
            let indices = layout.bands.indices.filter { i in
                let centerHz = layout.bands[i].centerHz
                guard centerHz >= marker.lowHz else { return false }
                if centerHz < marker.highHz { return true }
                return marker.band == .brilliance && centerHz <= marker.highHz
            }
            guard let first = indices.first, let last = indices.last else { return nil }
            return RTAMarkerSpan(direction: marker.direction, bandIndices: first...last)
        }
    }

    /// Periodic fill opacity for the pulsing marker regions, in
    /// [pulseMinOpacity, pulseMaxOpacity]. `pulseMinOpacity` for non-finite
    /// input.
    public static func pulseOpacity(atSeconds seconds: Double) -> Double {
        guard seconds.isFinite else { return pulseMinOpacity }
        let phase = (1 - cos(2 * Double.pi * seconds / pulsePeriodSeconds)) / 2
        return pulseMinOpacity + (pulseMaxOpacity - pulseMinOpacity) * phase
    }
}
