// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The first-run onboarding welcome overlay (#69, TD-001 slice 6f, #704) —
// ports inline-app.js's initOnboarding/runFirstAnalysis/close closures into a
// real store, replacing the old dlg.style.display DOM toggling with
// dialogOpen state OnboardingDialog.tsx renders. onboarding-state.js stays a
// classic script, read via a typed window cast — matching ringoutStore.ts's
// getFeedbackRingout() pattern.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import { switchMode } from '../mode-switch';
import { useAnalysisStore } from './analysisStore';
import type { SoundBuddyApi } from '../../../electron/ipc/api';

export type OnboardingApi = Pick<SoundBuddyApi, 'isOnboardingDisabled' | 'getDemoAudio' | 'openFileDialog'>;

interface OnboardingStateApi {
  shouldShowOnboarding(storage: Storage): boolean;
  markOnboardingSeen(storage: Storage): void;
}
function getOnboardingState(): OnboardingStateApi | undefined {
  return (window as unknown as { onboardingState?: OnboardingStateApi }).onboardingState;
}

const ANALYSIS_FAILED_COPY = 'That didn’t work — the analysis couldn’t finish. Try again, or skip for now.';

export interface OnboardingState {
  dialogOpen: boolean;
  phase: 'actions' | 'progress';
  copyOverride: string | null;
  runButtonLabel: string;
  init(): Promise<void>;
  runFirstAnalysis(): Promise<void>;
  close(): void;
}

export function createOnboardingStore(getApi: () => OnboardingApi) {
  return create<OnboardingState>()((set, get) => ({
    dialogOpen: false,
    phase: 'actions',
    copyOverride: null,
    runButtonLabel: 'Run your first analysis',

    async init() {
      const onboardingState = getOnboardingState();
      if (!onboardingState) return;
      // Dev/e2e escape hatch (SOUND_BUDDY_DISABLE_ONBOARDING): skip the
      // overlay so automated specs can drive the UI without the modal scrim
      // in the way. dialogOpen starts false, so awaiting this causes no flash.
      try {
        if (await getApi().isOnboardingDisabled()) return;
      } catch { /* no bridge -> show */ }
      if (!onboardingState.shouldShowOnboarding(window.localStorage)) return;
      set({ dialogOpen: true });
    },

    async runFirstAnalysis() {
      set({ phase: 'progress' });
      let demo: string | null = null;
      try { demo = await getApi().getDemoAudio(); } catch { demo = null; }

      // No bundled demo (e.g. asset missing) — never dead-end: retire
      // onboarding and hand the user the normal file picker on the Report
      // Card tab instead.
      if (!demo) {
        get().close();
        switchMode('reportcard');
        try {
          const fp = await getApi().openFileDialog();
          if (fp) {
            useAnalysisStore.getState().selectFile(fp);
            void useAnalysisStore.getState().startAnalysis(fp);
          }
        } catch { /* user cancelled */ }
        return;
      }

      // Route through the Report Card tab so the shared analysis pipeline +
      // spectrum render fire exactly as a normal run; the overlay's progress
      // state is the indicator meanwhile.
      switchMode('reportcard');
      useAnalysisStore.getState().selectFile(demo);
      await useAnalysisStore.getState().startAnalysis(demo);

      if (!useAnalysisStore.getState().currentAnalysis) {
        // Analysis failed (error surfaced in the spectrum panel). Relabel the
        // CTA and let the user retry or skip.
        set({ copyOverride: ANALYSIS_FAILED_COPY, runButtonLabel: 'Try again', phase: 'actions' });
        return;
      }
      get().close();
    },

    close() {
      // Seen once — completing or skipping both retire the flow for good.
      getOnboardingState()?.markOnboardingSeen(window.localStorage);
      set({ dialogOpen: false });
    },
  }));
}

export const useOnboardingStore = createOnboardingStore(getSoundBuddy);
