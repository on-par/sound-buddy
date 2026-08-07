// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The "Grade your own service" guide dialog (#142, reworked #295, TD-001
// slice 6f, #704) — ports inline-app.js's openGuideDialog/closeGuideDialog/
// gradeOwnChooseFile and the guide-paths click delegation into a real store.
// grade-own-state.js stays a classic script, read via a typed window cast —
// matching ringoutStore.ts's getFeedbackRingout() pattern.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import { useAnalysisStore } from './analysisStore';
import type { SoundBuddyApi } from '../../../electron/ipc/api';

export type GradeOwnGuideApi = Pick<SoundBuddyApi, 'openFileDialog' | 'openCaptureGuide'>;

interface GradeOwnStateApi {
  ctaAction(pathId: string): string | null;
}
function getGradeOwnState(): GradeOwnStateApi {
  return (window as unknown as { gradeOwnState: GradeOwnStateApi }).gradeOwnState;
}

export interface GradeOwnGuideState {
  dialogOpen: boolean;
  open(): void;
  close(): void;
  chooseFile(): Promise<void>;
  handlePathAction(pathId: string): void;
}

export function createGradeOwnGuideStore(getApi: () => GradeOwnGuideApi) {
  return create<GradeOwnGuideState>()((set, get) => ({
    dialogOpen: false,

    open() {
      set({ dialogOpen: true });
    },

    close() {
      set({ dialogOpen: false });
    },

    // Mirrors the onboarding "pick your own file" path: no mode switch needed
    // here since the CTA lives in the Report Card toolbar, so the card is
    // already the active tab.
    async chooseFile() {
      let fp: string | null;
      try { fp = await getApi().openFileDialog(); } catch { return; }
      if (!fp) return;
      get().close();
      useAnalysisStore.getState().selectFile(fp);
      await useAnalysisStore.getState().startAnalysis(fp);
    },

    handlePathAction(pathId) {
      const action = getGradeOwnState().ctaAction(pathId);
      if (action === 'choose-file') {
        void get().chooseFile();
      } else if (action === 'open-guide') {
        try { getApi().openCaptureGuide()?.catch(() => {}); } catch { /* preload missing */ }
        get().close();
      }
    },
  }));
}

export const useGradeOwnGuideStore = createGradeOwnGuideStore(getSoundBuddy);
