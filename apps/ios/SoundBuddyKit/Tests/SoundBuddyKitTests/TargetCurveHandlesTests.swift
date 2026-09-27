import Foundation
import Testing
@testable import SoundBuddyKit

private let epsilon = 1e-9

@Suite struct TargetCurveHandlesGridIndicesTests {
    @Test func matchesTheExpectedThinnedSet() {
        #expect(TargetCurveHandles.gridIndices == [0, 5, 10, 16, 21, 26, 31, 37, 42, 47])
    }

    @Test func countMatchesHandleCount() {
        #expect(TargetCurveHandles.gridIndices.count == TargetCurveHandles.handleCount)
    }

    @Test func indicesAscendStrictly() {
        for (a, b) in zip(TargetCurveHandles.gridIndices, TargetCurveHandles.gridIndices.dropFirst()) {
            #expect(a < b)
        }
    }

    @Test func lastIndexIsTheLastGridPoint() {
        #expect(TargetCurveHandles.gridIndices.last == IdealCurve.gridPoints - 1)
    }
}

@Suite struct TargetCurveHandlesHandlesForTests {
    @Test func flatCurveHasTenZeroOffsetHandles() {
        let handles = TargetCurveHandles.handles(for: .flat)
        #expect(handles.count == TargetCurveHandles.handleCount)
        for (handle, gridIndex) in zip(handles, TargetCurveHandles.gridIndices) {
            #expect(handle.gridIndex == gridIndex)
            #expect(handle.hz == IdealCurve.gridFreqs[gridIndex])
            #expect(handle.offsetDb == 0)
        }
    }

    @Test func ordinalsAreSequential() {
        let handles = TargetCurveHandles.handles(for: .flat)
        #expect(handles.map(\.ordinal) == Array(0..<TargetCurveHandles.handleCount))
    }
}

@Suite struct TargetCurveHandlesOnGridTests {
    @Test func aFortyEightPointGridCurveIsUnchanged() {
        #expect(TargetCurveHandles.onGrid(.flat) == .flat)
    }

    @Test func aNonGridCurveResamplesToFortyEightPoints() {
        let curve = IdealCurve(id: "t", label: "T", description: "", freqs: [100, 400, 1600], dbOffsets: [2, 6, -2])
        let grid = TargetCurveHandles.onGrid(curve)
        #expect(grid.freqs == IdealCurve.gridFreqs)
        #expect(grid.dbOffsets.count == IdealCurve.gridPoints)
        for (hz, offset) in zip(grid.freqs, grid.dbOffsets) {
            #expect(abs(offset - curve.offset(atHz: hz)) < epsilon)
        }
    }
}

@Suite struct TargetCurveHandlesMovingTests {
    @Test func theGrabbedHandlePointEqualsTheNewOffset() {
        let moved = TargetCurveHandles.moving(.flat, handle: 3, toOffsetDb: 5)
        #expect(abs(moved.dbOffsets[TargetCurveHandles.gridIndices[3]] - 5) < epsilon)
    }

    @Test func otherHandlesAreUnchanged() {
        let moved = TargetCurveHandles.moving(.flat, handle: 3, toOffsetDb: 5)
        for (ordinal, gridIndex) in TargetCurveHandles.gridIndices.enumerated() where ordinal != 3 {
            #expect(abs(moved.dbOffsets[gridIndex] - 0) < epsilon)
        }
    }

    @Test func resultHasFortyEightGridPointsWithCustomIdAndLabel() {
        let moved = TargetCurveHandles.moving(.flat, handle: 3, toOffsetDb: 5)
        #expect(moved.freqs == IdealCurve.gridFreqs)
        #expect(moved.dbOffsets.count == IdealCurve.gridPoints)
        #expect(moved.id == TargetCurveHandles.customId)
        #expect(moved.label == TargetCurveHandles.customLabel)
    }

    @Test func aMidwayPointGetsAboutHalfTheDelta() {
        // Handle 3 is grid index 16, its right neighbour (handle 4) is 21.
        // The midpoint 18/19 sits close to t = 0.5, where the raised cosine
        // weight is 0.5.
        let moved = TargetCurveHandles.moving(.flat, handle: 3, toOffsetDb: 10)
        let midIndex = 18 // t = (18-16)/(21-16) = 0.4
        let t = Double(midIndex - 16) / Double(21 - 16)
        let expectedWeight = 0.5 * (1 + cos(.pi * t))
        #expect(abs(moved.dbOffsets[midIndex] - 10 * expectedWeight) < epsilon)
    }

    @Test func pointsOutsideTheNeighbourSpanAreUnchanged() {
        // Handle 3 (index 16) and its neighbours are handles 2 (index 10) and
        // 4 (index 21); grid index 5 (handle 1) sits well outside that span.
        let moved = TargetCurveHandles.moving(.flat, handle: 3, toOffsetDb: 10)
        #expect(abs(moved.dbOffsets[5] - 0) < epsilon)
    }

    @Test func firstHandleOnlyMovesItsRightSide() {
        let moved = TargetCurveHandles.moving(.flat, handle: 0, toOffsetDb: 8)
        #expect(abs(moved.dbOffsets[0] - 8) < epsilon)
        // Between handle 0 (index 0) and handle 1 (index 5): index 2 moves.
        #expect(moved.dbOffsets[2] != 0)
        // Nothing precedes index 0, so there is no left side to move.
    }

    @Test func lastHandleOnlyMovesItsLeftSide() {
        let moved = TargetCurveHandles.moving(.flat, handle: TargetCurveHandles.handleCount - 1, toOffsetDb: 8)
        let lastIndex = TargetCurveHandles.gridIndices.last!
        #expect(abs(moved.dbOffsets[lastIndex] - 8) < epsilon)
        // Between handle 8 (index 42) and handle 9 (index 47): index 44 moves.
        #expect(moved.dbOffsets[44] != 0)
    }

    @Test func anOutOfRangeHandleReturnsOnGridUnchanged() {
        let curve = IdealCurve(id: "t", label: "T", description: "", freqs: [100, 400, 1600], dbOffsets: [2, 6, -2])
        let moved = TargetCurveHandles.moving(curve, handle: TargetCurveHandles.handleCount, toOffsetDb: 5)
        #expect(moved == TargetCurveHandles.onGrid(curve))
        let movedNegative = TargetCurveHandles.moving(curve, handle: -1, toOffsetDb: 5)
        #expect(movedNegative == TargetCurveHandles.onGrid(curve))
    }

    @Test func movingOnTheWorshipCurveKeepsItsOtherHandles() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let before = TargetCurveHandles.handles(for: worship)
        let moved = TargetCurveHandles.moving(worship, handle: 5, toOffsetDb: before[5].offsetDb + 4)
        let after = TargetCurveHandles.handles(for: moved)
        for ordinal in 0..<TargetCurveHandles.handleCount where ordinal != 5 {
            #expect(abs(after[ordinal].offsetDb - before[ordinal].offsetDb) < epsilon)
        }
        #expect(abs(after[5].offsetDb - (before[5].offsetDb + 4)) < epsilon)
    }
}

@Suite struct TargetHandleDragOffsetDbTests {
    private let scale = RTAScale.standard

    @Test func zeroFractionReturnsTheStartOffset() {
        let drag = TargetHandleDrag(handle: 0, startOffsetDb: -60, levelShiftDb: 0)
        #expect(abs(drag.offsetDb(forTranslationFraction: 0, scale: scale) - (-60)) < epsilon)
    }

    @Test func aSmallFractionMovesByThatFractionOfTheSpan() {
        let drag = TargetHandleDrag(handle: 0, startOffsetDb: -60, levelShiftDb: 0)
        let expected = -60 + 0.1 * scale.spanDb
        #expect(abs(drag.offsetDb(forTranslationFraction: 0.1, scale: scale) - expected) < epsilon)
    }

    @Test func aHugePositiveFractionClampsToTheCeilingMinusTheShift() {
        let drag = TargetHandleDrag(handle: 0, startOffsetDb: -60, levelShiftDb: 5)
        let result = drag.offsetDb(forTranslationFraction: 1000, scale: scale)
        #expect(abs(result - (scale.ceilingDb - 5)) < epsilon)
        #expect(abs((result + 5) - scale.ceilingDb) < epsilon, "the displayed value sits exactly at the ceiling")
    }

    @Test func aHugeNegativeFractionClampsToTheFloorMinusTheShift() {
        let drag = TargetHandleDrag(handle: 0, startOffsetDb: -60, levelShiftDb: 5)
        let result = drag.offsetDb(forTranslationFraction: -1000, scale: scale)
        #expect(abs(result - (scale.floorDb - 5)) < epsilon)
        #expect(abs((result + 5) - scale.floorDb) < epsilon, "the displayed value sits exactly at the floor")
    }
}
