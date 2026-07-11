// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Licensing domain (#225 split of the former monolithic ipc.ts): the thin IPC
// wrappers over electron/license.ts's offline verification. None of these
// handlers touch the network.

import { ipcMain } from 'electron';
import { getLicenseState, activateLicense, removeLicense } from '../license';

export function registerLicensingHandlers(): void {
  // License (#54) — offline validation only; none of these touch the network.
  // get-license re-verifies the stored key on every call, so expiry/grace roll
  // over naturally without a restart.
  ipcMain.handle('get-license', () => getLicenseState());
  ipcMain.handle('activate-license', (_event, key: string) => activateLicense(String(key ?? '')));
  ipcMain.handle('remove-license', () => removeLicense());
}
