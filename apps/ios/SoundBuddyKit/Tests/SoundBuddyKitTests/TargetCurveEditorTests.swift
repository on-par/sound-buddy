import Foundation
import Testing
@testable import SoundBuddyKit

@Suite("TargetCurveEditor")
struct TargetCurveEditorTests {
    @Test func aNewEditorIsNotEditingAndTransitionsAreNoOps() {
        var editor = TargetCurveEditor()
        #expect(!editor.isEditing)
        let cancelled = editor.cancel()
        #expect(cancelled == nil)
        let finished = editor.done()
        #expect(finished == nil)
        let updated = editor.updateDraft(.flat)
        #expect(!updated)
    }

    @Test func beginSnapshotsTheActiveCurveAndFlagAndSeedsTheDraft() {
        var editor = TargetCurveEditor()
        editor.begin(active: .flat, isAuto: true)
        #expect(editor.isEditing)
        #expect(editor.original == .flat)
        #expect(editor.originalIsAuto)
        #expect(editor.draft == .flat)
    }

    @Test func aSecondBeginWhileEditingKeepsTheFirstSnapshot() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        var editor = TargetCurveEditor()
        editor.begin(active: .flat, isAuto: true)
        editor.begin(active: worship, isAuto: false)
        #expect(editor.original == .flat)
        #expect(editor.originalIsAuto)
        #expect(editor.draft == .flat)
    }

    @Test func cancelAfterAnUpdateRestoresTheOriginalAndExits() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        var editor = TargetCurveEditor()
        editor.begin(active: .flat, isAuto: true)
        let updated = editor.updateDraft(worship)
        #expect(updated)
        let outcome = editor.cancel()
        let resolution = try #require(outcome)
        #expect(resolution.curve == .flat)
        #expect(resolution.isAuto)
        #expect(!editor.isEditing)
        #expect(editor.original == nil)
        #expect(editor.draft == nil)
    }

    @Test func doneWithAnUnchangedDraftKeepsTheOriginalAutoFlagAndExits() throws {
        var editor = TargetCurveEditor()
        editor.begin(active: .flat, isAuto: true)
        let outcome = editor.done()
        let resolution = try #require(outcome)
        #expect(resolution.curve == .flat)
        #expect(resolution.isAuto)
        #expect(!editor.isEditing)
    }

    @Test func doneAfterAChangedDraftReturnsTheDraftAndClearsAuto() throws {
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        var editor = TargetCurveEditor()
        editor.begin(active: .flat, isAuto: true)
        let updated = editor.updateDraft(worship)
        #expect(updated)
        let outcome = editor.done()
        let resolution = try #require(outcome)
        #expect(resolution.curve == worship)
        #expect(!resolution.isAuto)
        #expect(!editor.isEditing)
    }

    @Test func chipTitleIsEditingTarget() {
        #expect(TargetCurveEditor.chipTitle == "Editing target")
    }
}
