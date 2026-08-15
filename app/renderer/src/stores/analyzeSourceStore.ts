// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Open/closed state for the unified "Analyze" source picker (#543, epic e17)
// — TD-001 slice 6h (#711): replaces inline-app.js's window.analyzeSourcePicker
// open/close DOM bridge. Pure UI state, no injected API needed; the picker's
// choice routing (analyzeSourceState.targetModeFor / switchMode /
// chooseAndAnalyzeFile) stays in AnalyzeSourcePicker.tsx and the classic
// scripts, exactly as before.

import { create } from 'zustand';

export interface AnalyzeSourceState {
  isOpen: boolean;
  open(): void;
  close(): void;
}

export const useAnalyzeSourceStore = create<AnalyzeSourceState>()((set) => ({
  isOpen: false,
  open() {
    set({ isOpen: true });
  },
  close() {
    set({ isOpen: false });
  },
}));
