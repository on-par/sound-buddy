// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Open/closed state for the shared rig/group name prompt (TD-001 slice 6i,
// #712) — replaces inline-app.js's imperative rigDialog() DOM modal with a
// React dialog (RigDialog.tsx) driven by this store, while keeping the exact
// same promise API (window.rigDialog, installed by RigDialog.tsx's mount
// effect) so RigControls.tsx / rigStore.ts / LiveCapturePanel.tsx's group
// prompts are unchanged. Pure UI state, no injected API needed — the prompt
// resolves through close(result), matching the old modal's
// resolve(entered-string | true | null) contract. A second open() while one
// is pending supersedes the earlier promise (the resolver ref is replaced) —
// the app only ever opens one prompt at a time.

import { create } from 'zustand';

export interface RigDialogOptions {
  title?: string;
  msg?: string;
  value?: string;
  confirmLabel?: string;
  withInput?: boolean;
}

export interface RigDialogState {
  isOpen: boolean;
  title: string;
  msg: string;
  value: string;
  confirmLabel: string;
  withInput: boolean;
  /** Opens the prompt and resolves once close(result) runs (string = OK'd
   *  input, true = OK'd confirm, null = cancel / Esc / backdrop). */
  open(opts: RigDialogOptions): Promise<string | boolean | null>;
  close(result: string | boolean | null): void;
}

// Module-level resolver ref — the same shape the old inline rigDialog()
// closure used, so a pending open() is resolved by the NEXT close() (the app
// never stacks prompts).
let pendingResolver: ((result: string | boolean | null) => void) | null = null;

export const useRigDialogStore = create<RigDialogState>()((set) => ({
  isOpen: false,
  title: '',
  msg: '',
  value: '',
  confirmLabel: 'OK',
  withInput: true,

  open(opts) {
    set({
      isOpen: true,
      title: opts.title ?? '',
      msg: opts.msg ?? '',
      value: opts.value ?? '',
      confirmLabel: opts.confirmLabel ?? 'OK',
      withInput: opts.withInput !== false,
    });
    return new Promise<string | boolean | null>((resolve) => {
      pendingResolver = resolve;
    });
  },

  close(result) {
    set({ isOpen: false });
    if (pendingResolver) {
      pendingResolver(result);
      pendingResolver = null;
    }
  },
}));
