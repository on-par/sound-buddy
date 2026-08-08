// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #phase-doubling-dialog Doubling/Phase Bug Detector checklist (#370,
// TD-001 slice 6f, #704) — ports inline-app.js's phaseDoublingStep module
// var + renderPhaseDoublingStep/openPhaseDoublingDialog/
// closePhaseDoublingDialog and the wiring IIFE's next/prev handlers into a
// real store. phase-doubling-state.js stays a classic script, read via a
// typed window cast — matching ringoutStore.ts's getFeedbackRingout()
// pattern (and ringoutStore.ts:109-113's identical next/prev shape).

import { create } from 'zustand';

interface PhaseDoublingStateApi {
  clampIndex(i: number): number;
}
function getPhaseDoublingState(): PhaseDoublingStateApi {
  return (window as unknown as { phaseDoublingState: PhaseDoublingStateApi }).phaseDoublingState;
}

export interface PhaseDoublingContext {
  filename: string;
  detected: boolean;
}

export interface PhaseDoublingDialogState {
  dialogOpen: boolean;
  step: number;
  context: PhaseDoublingContext | null;
  open(context: PhaseDoublingContext | null): void;
  close(): void;
  next(): void;
  prev(): void;
}

export const usePhaseDoublingStore = create<PhaseDoublingDialogState>()((set) => ({
  dialogOpen: false,
  step: 0,
  context: null,

  open(context) {
    set({ dialogOpen: true, step: 0, context });
  },

  close() {
    set({ dialogOpen: false });
  },

  next() {
    set((s) => ({ step: getPhaseDoublingState().clampIndex(s.step + 1) }));
  },

  prev() {
    set((s) => ({ step: getPhaseDoublingState().clampIndex(s.step - 1) }));
  },
}));
