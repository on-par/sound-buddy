// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { AnalysisApi, SceneDiffDto } from '../../../electron/ipc/api';

export type SceneDiffStatus = 'idle' | 'one-loaded' | 'diffing' | 'done' | 'error';

export interface SceneDiffState {
  status: SceneDiffStatus;
  // 0, 1, or 2 dropped .scn paths, in drop order — a third drop shifts the
  // window (drops the oldest, keeps the second as the new first).
  scenePaths: string[];
  diff: SceneDiffDto | null;
  nameA: string | null;
  nameB: string | null;
  sceneError: string | null;
  addScenePath(path: string): Promise<void>;
  clearScenes(): void;
}

const INITIAL_STATE = {
  status: 'idle' as SceneDiffStatus,
  scenePaths: [] as string[],
  diff: null as SceneDiffDto | null,
  nameA: null as string | null,
  nameB: null as string | null,
  sceneError: null as string | null,
};

export function createSceneDiffStore(getApi: () => Pick<AnalysisApi, 'diffScenes'>) {
  return create<SceneDiffState>()((set, get) => ({
    ...INITIAL_STATE,
    async addScenePath(path) {
      const prev = get().scenePaths;
      const next = prev.length >= 2 ? [prev[1], path] : [...prev, path];

      if (next.length < 2) {
        set({ scenePaths: next, status: 'one-loaded', sceneError: null });
        return;
      }

      set({ scenePaths: next, status: 'diffing', sceneError: null });
      try {
        const result = await getApi().diffScenes({ pathA: next[0], pathB: next[1] });
        if (result.ok) {
          set({ status: 'done', diff: result.diff, nameA: result.nameA, nameB: result.nameB, sceneError: null });
        } else {
          set({ status: 'error', sceneError: result.error, diff: null });
        }
      } catch {
        set({
          status: 'error',
          sceneError: "Couldn't compare the scene files. Restart Sound Buddy and try again.",
          diff: null,
        });
      }
    },
    clearScenes() {
      set({ ...INITIAL_STATE });
    },
  }));
}

export const useSceneDiffStore = createSceneDiffStore(getSoundBuddy);
