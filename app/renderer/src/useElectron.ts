// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { createContext, useContext } from 'react';
import type { SoundBuddyApi } from '../../electron/ipc/api';

declare global {
  interface Window {
    soundBuddy?: SoundBuddyApi;
  }
}

export function getSoundBuddy(): SoundBuddyApi {
  const api = typeof window !== 'undefined' ? window.soundBuddy : undefined;
  if (!api) throw new Error('soundBuddy IPC bridge unavailable — not running under the Electron preload');
  return api;
}

// Test seam: components read the bridge from context when a test provides one,
// falling back to the real preload bridge in the app.
export const ElectronContext = createContext<SoundBuddyApi | null>(null);

export function useElectron(): SoundBuddyApi {
  return useContext(ElectronContext) ?? getSoundBuddy();
}
