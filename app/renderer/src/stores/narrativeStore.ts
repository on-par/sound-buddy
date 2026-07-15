// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { LlmApi } from '../../../electron/ipc/api';

export type NarrativeApi = Pick<LlmApi, 'triggerLlmAnalysis' | 'onLlmDelta' | 'onLlmDone' | 'getLlmConfig'>;

export interface NarrativeState {
  narrativeText: string;
  isStreaming: boolean;
  streamError: string | null;
  provider: string | null;
  model: string | null;
  startNarrative(payload: unknown): Promise<void>;
  cancelNarrative(): void;
  bindIpcEvents(): void;
}

export function createNarrativeStore(getApi: () => NarrativeApi) {
  return create<NarrativeState>()((set, get) => ({
    narrativeText: '',
    isStreaming: false,
    streamError: null,
    provider: null,
    model: null,
    async startNarrative(payload) {
      if (get().isStreaming) return;
      set({ isStreaming: true, narrativeText: '', streamError: null });
      try {
        const cfg = await getApi().getLlmConfig();
        set({ provider: cfg.provider, model: cfg.model });
        await getApi().triggerLlmAnalysis(payload);
      } catch (err) {
        set({ isStreaming: false, streamError: err instanceof Error ? err.message : String(err) });
      }
    },
    cancelNarrative() {
      set({ isStreaming: false });
    },
    bindIpcEvents() {
      const api = getApi();
      api.onLlmDelta((text) => {
        if (get().isStreaming) set({ narrativeText: get().narrativeText + text });
      });
      api.onLlmDone(() => set({ isStreaming: false }));
    },
  }));
}

export const useNarrativeStore = createNarrativeStore(getSoundBuddy);
