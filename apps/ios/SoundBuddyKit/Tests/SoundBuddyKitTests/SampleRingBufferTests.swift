import Testing
@testable import SoundBuddyKit

@Suite struct SampleRingBufferTests {
    @Test func latestIsNilUntilEnoughSamplesArrive() {
        let ring = SampleRingBuffer(capacity: 8)
        ring.write([1, 2, 3])
        #expect(ring.latest(4) == nil)
        ring.write([4])
        #expect(ring.latest(4) == [1, 2, 3, 4])
    }

    @Test func latestReturnsNewestSamplesInOrderAcrossWraparound() {
        let ring = SampleRingBuffer(capacity: 8)
        ring.write((1...6).map(Float.init))
        ring.write((7...10).map(Float.init))
        #expect(ring.latest(4) == [7, 8, 9, 10])
        #expect(ring.latest(8) == (3...10).map(Float.init))
    }

    @Test func writeLargerThanCapacityKeepsOnlyTheTail() {
        let ring = SampleRingBuffer(capacity: 4)
        ring.write((1...10).map(Float.init))
        #expect(ring.latest(4) == [7, 8, 9, 10])
    }

    @Test func requestLargerThanCapacityIsNil() {
        let ring = SampleRingBuffer(capacity: 4)
        ring.write([1, 2, 3, 4])
        #expect(ring.latest(5) == nil)
    }

    @Test func resetDropsBufferedSamples() {
        let ring = SampleRingBuffer(capacity: 4)
        ring.write([1, 2, 3, 4])
        ring.reset()
        #expect(ring.latest(1) == nil)
    }
}
