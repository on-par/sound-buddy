// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The skill-tree onboarding dialog (#382) — wraps skill-tree-state.js (a
// classic script read via a typed window cast, matching gradeOwnGuideStore's
// getGradeOwnState() pattern) in a real Zustand store. All derivation stays in
// skill-tree-state.js; this store is a thin state wrapper for dialog
// open/close, branch selection, and the persist-through-toggle action.
// Progress is renderer-local user data, stored under the script's versioned
// localStorage key — never AppSettings.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { SoundBuddyApi } from '../../../electron/ipc/api';

export type SkillTreeApi = Pick<SoundBuddyApi, 'onOpenSkillTreeDialog'>;

export interface SkillTreeLevel {
  id: string;
  title: string;
  body: string;
  tip: string;
}

export interface SkillTreeBranch {
  id: string;
  title: string;
  summary: string;
  levels: SkillTreeLevel[];
}

export interface SkillTreeProgress {
  completed: string[];
}

export interface SkillTreeBadge {
  branchId: string;
  title: string;
}

export interface SkillTreeStateApi {
  KEY: string;
  SKILL_TREE: SkillTreeBranch[];
  BRANCH_COUNT: number;
  LEVELS_PER_BRANCH: number;
  LEVEL_COUNT: number;
  loadProgress(storage: Storage): SkillTreeProgress;
  saveProgress(storage: Storage, progress: SkillTreeProgress): void;
  isLevelComplete(progress: SkillTreeProgress, levelId: string): boolean;
  completeLevel(progress: SkillTreeProgress, levelId: string): SkillTreeProgress;
  branchComplete(progress: SkillTreeProgress, branchId: string): boolean;
  badgesFor(progress: SkillTreeProgress): SkillTreeBadge[];
  nextLevelId(progress: SkillTreeProgress): string | null;
}

function getSkillTreeState(): SkillTreeStateApi {
  return (window as unknown as { skillTreeState: SkillTreeStateApi }).skillTreeState;
}

export interface SkillTreeStoreState {
  dialogOpen: boolean;
  progress: { completed: string[] };
  selectedBranchId: string;
  open(): void;
  close(): void;
  selectBranch(branchId: string): void;
  toggleLevelComplete(levelId: string): void;
  bindIpcEvents(): void;
  init(): void;
}

export function createSkillTreeStore(getApi: () => SkillTreeApi) {
  return create<SkillTreeStoreState>()((set, get) => ({
    dialogOpen: false,
    progress: { completed: [] },
    selectedBranchId: '',

    // Re-reads progress so the dialog is always current, and lands on the
    // first branch in MxU order.
    open() {
      const state = getSkillTreeState();
      set({
        progress: state.loadProgress(window.localStorage),
        selectedBranchId: state.SKILL_TREE[0].id,
        dialogOpen: true,
      });
    },

    close() {
      set({ dialogOpen: false });
    },

    selectBranch(branchId) {
      set({ selectedBranchId: branchId });
    },

    // Pure toggle via skill-tree-state.js, then persists and reflects it.
    toggleLevelComplete(levelId) {
      const state = getSkillTreeState();
      const next = state.completeLevel(get().progress, levelId);
      state.saveProgress(window.localStorage, next);
      set({ progress: next });
    },

    // Help ▸ "Skill Tree…" pushes the renderer open (menu-push channel).
    bindIpcEvents() {
      getApi().onOpenSkillTreeDialog(() => get().open());
    },

    // Hydrates progress without opening the dialog; called from App.tsx
    // after BOOT_SCRIPTS so window.skillTreeState exists.
    init() {
      set({ progress: getSkillTreeState().loadProgress(window.localStorage) });
    },
  }));
}

export const useSkillTreeStore = createSkillTreeStore(getSoundBuddy);