// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The skill-tree onboarding dialog (#382) — the progressive nine-branch tree
// mirroring the MxU teaching order, portaled by App.tsx onto
// #skill-tree-island. It is a thin view over skillTreeStore: all derivation
// (completion, badges, next-level) goes through skill-tree-state.js's pure
// functions, read via a typed window cast — matching OnboardingDialog.tsx's
// shape. Content, progress and badges are static/derived; no adaptive AI.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import {
  useSkillTreeStore,
  type SkillTreeProgress,
  type SkillTreeStateApi,
} from './stores/skillTreeStore';

// skill-tree-state.js stays a classic script — read via a typed window cast,
// matching GradeOwnGuideDialog.tsx's getGradeOwnState() pattern. Absent on the
// very first render (before BOOT_SCRIPTS run), so the dialog renders closed.
function getSkillTreeState(): SkillTreeStateApi | undefined {
  return (window as unknown as { skillTreeState?: SkillTreeStateApi }).skillTreeState;
}

// The branch that contains the next uncompleted level, for the Continue
// affordance. Pure presentation glue over nextLevelId().
function nextBranchId(state: SkillTreeStateApi, progress: SkillTreeProgress): string | null {
  const nextId = state.nextLevelId(progress);
  if (!nextId) return null;
  // nextLevelId only ever returns a level id that exists in SKILL_TREE, so
  // the find always succeeds.
  const branch = state.SKILL_TREE.find((b) => b.levels.some((l) => l.id === nextId))!;
  return branch.id;
}

export default function SkillTreeDialog(): JSX.Element {
  const state = getSkillTreeState();
  const { dialogOpen, progress, selectedBranchId, selectBranch, toggleLevelComplete, close } =
    useStoreShallow(useSkillTreeStore, (s) => ({
      dialogOpen: s.dialogOpen,
      progress: s.progress,
      selectedBranchId: s.selectedBranchId,
      selectBranch: s.selectBranch,
      toggleLevelComplete: s.toggleLevelComplete,
      close: s.close,
    }));

  /* c8 ignore start -- document-level Escape close, no jsdom in this harness;
     covered by app/tests/e2e/utility-dialogs.spec.ts. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && useSkillTreeStore.getState().dialogOpen) {
        useSkillTreeStore.getState().close();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  // Boot scripts have not run yet (first render) — render the closed state so
  // the tree never takes down the whole render.
  if (!state) {
    return (
      <div
        id="skill-tree-dialog"
        className="rig-dialog"
        style={{ display: 'none' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-tree-title"
      />
    );
  }

  const badges = state.badgesFor(progress);
  const continueBranch = nextBranchId(state, progress);
  const selected = state.SKILL_TREE.find((branch) => branch.id === selectedBranchId)
    ?? state.SKILL_TREE[0];

  return (
    <div
      id="skill-tree-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-tree-title"
      /* c8 ignore next -- click dispatch, no jsdom */
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="rig-dialog-card skill-tree-card">
        <div className="rig-dialog-title" id="skill-tree-title">Skill Tree</div>
        <div className="skill-tree-overall">{`${progress.completed.length} of ${state.LEVEL_COUNT} levels · ${badges.length} of ${state.BRANCH_COUNT} badges`}</div>
        <div className="skill-tree-branches">
          {state.SKILL_TREE.map((branch) => {
            const complete = state.branchComplete(progress, branch.id);
            const earned = badges.some((badge) => badge.branchId === branch.id);
            return (
              <button
                key={branch.id}
                type="button"
                data-skill-branch={branch.id}
                className={'skill-tree-branch' + (selectedBranchId === branch.id ? ' active' : '')}
                onClick={() => selectBranch(branch.id)}
              >
                <span className="skill-tree-branch-check">{complete ? '✓' : ''}</span>
                <span className="skill-tree-branch-title">{branch.title}</span>
                {earned && <span className="skill-tree-badge-chip">Badge earned</span>}
              </button>
            );
          })}
        </div>
        <div className="skill-tree-branch-detail">
          <div className="skill-tree-branch-summary">{selected.summary}</div>
          {selected.levels.map((level) => {
            const done = state.isLevelComplete(progress, level.id);
            return (
              <div key={level.id} className="skill-tree-level">
                <div className="skill-tree-level-title">{level.title}</div>
                <div className="skill-tree-level-body">{level.body}</div>
                <div className="skill-tree-level-tip">{level.tip}</div>
                <button
                  type="button"
                  data-skill-level={level.id}
                  className="btn btn-secondary sm skill-tree-level-toggle"
                  onClick={() => toggleLevelComplete(level.id)}
                >
                  {done ? 'Mark incomplete' : 'Mark complete'}
                </button>
              </div>
            );
          })}
        </div>
        <div className="rig-dialog-actions skill-tree-actions">
          <button
            type="button"
            data-skill-continue
            className="btn btn-primary sm"
            disabled={continueBranch === null}
            onClick={() => { if (continueBranch !== null) selectBranch(continueBranch); }}
          >
            Continue
          </button>
          <button
            type="button"
            data-skill-close
            className="btn btn-secondary sm"
            onClick={close}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}