import Foundation

/// Fixed-capacity mono sample ring. The audio tap writes on the render
/// thread; the meter tick reads the newest frame on the main thread — the lock
/// makes that handoff safe. Writes never allocate after init.
///
/// TODO(perf): swap NSLock for a lock-free SPSC ring if profiling shows the
/// render callback blocking on the reader.
public final class SampleRingBuffer: @unchecked Sendable {
    public let capacity: Int
    private var storage: [Float]
    private var writeIndex = 0
    private var filled = 0
    private let lock = NSLock()

    public init(capacity: Int) {
        precondition(capacity > 0, "SampleRingBuffer capacity must be positive")
        self.capacity = capacity
        storage = Array(repeating: 0, count: capacity)
    }

    public func write(_ samples: UnsafeBufferPointer<Float>) {
        lock.lock()
        defer { lock.unlock() }
        for sample in samples.suffix(capacity) {
            storage[writeIndex] = sample
            writeIndex = (writeIndex + 1) % capacity
        }
        filled = min(capacity, filled + samples.count)
    }

    public func write(_ samples: [Float]) {
        samples.withUnsafeBufferPointer { write($0) }
    }

    /// The newest `count` samples, oldest first, or nil until that many have
    /// been written (or if `count` exceeds capacity).
    public func latest(_ count: Int) -> [Float]? {
        lock.lock()
        defer { lock.unlock() }
        guard count <= filled else { return nil }
        let start = (writeIndex - count + capacity) % capacity
        return (0..<count).map { storage[(start + $0) % capacity] }
    }

    public func reset() {
        lock.lock()
        defer { lock.unlock() }
        writeIndex = 0
        filled = 0
    }
}
