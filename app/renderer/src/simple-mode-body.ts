// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { AppSettings } from '../../electron/ipc/api';
import { isSimpleMode } from './simple-mode';
import { useSettingsStore } from './stores/settingsStore';

export function syncSimpleModeBodyClass(settings: AppSettings | null): void {
  document.body.classList.toggle('simple-mode', isSimpleMode(settings));
}

export function installSimpleModeBodyClassSync(): () => void {
  syncSimpleModeBodyClass(useSettingsStore.getState().settings);
  return useSettingsStore.subscribe((state) => syncSimpleModeBodyClass(state.settings));
}
