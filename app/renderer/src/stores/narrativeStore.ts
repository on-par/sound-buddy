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
  // Set by cancelNarrative(), cleared by onLlmDone(): a cancel doesn't tell
  // the main process to abort mid-flight, so deltas from the cancelled run
  // can still arrive after isStreaming flips false. Without this flag those
  // deltas would read as "unsolicited" (below) and start a spurious implicit
  // stream — this suppresses them until the run's onLlmDone actually lands.
  suppressDeltas: boolean;
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
    suppressDeltas: false,
    async startNarrative(payload) {
      if (get().isStreaming) return;
      set({ isStreaming: true, narrativeText: '', streamError: null, suppressDeltas: false });
      try {
        const cfg = await getApi().getLlmConfig();
        set({ provider: cfg.provider, model: cfg.model });
        await getApi().triggerLlmAnalysis(payload);
      } catch (err) {
        set({ isStreaming: false, streamError: err instanceof Error ? err.message : String(err) });
      }
    },
    cancelNarrative() {
      set({ isStreaming: false, suppressDeltas: true });
    },
    bindIpcEvents() {
      const api = getApi();
      api.onLlmDelta((text) => {
        if (get().suppressDeltas) return;
        // During live capture the main process auto-triggers LLM analysis on
        // llmIntervalSecs — a delta can arrive without startNarrative having
        // run. Rather than drop it, an unsolicited delta while idle starts an
        // implicit stream so the auto-triggered narrative still renders.
        if (!get().isStreaming) {
          set({ isStreaming: true, narrativeText: text, streamError: null });
        } else {
          set({ narrativeText: get().narrativeText + text });
        }
      });
      api.onLlmDone(() => set({ isStreaming: false, suppressDeltas: false }));
    },
  }));
}

export const useNarrativeStore = createNarrativeStore(getSoundBuddy);
