// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Licensing domain (#225 split of the former monolithic ipc.ts): the thin IPC
// wrappers over electron/license.ts's offline verification. The get/activate/
// remove handlers stay fully offline; refresh-license (#117) makes the app's
// one scoped network call — only when a subscription key is within 7 days of
// expiry or already in grace, sending nothing but the already-signed key.

import { ipcMain } from 'electron';
import { getLicenseState, activateLicense, removeLicense } from '../license';
import { maybeRefreshLicense } from '../license-refresh';

export function registerLicensingHandlers(): void {
  // License (#54) — offline validation only; none of these touch the network.
  // get-license re-verifies the stored key on every call, so expiry/grace roll
  // over naturally without a restart.
  ipcMain.handle('get-license', () => getLicenseState());
  ipcMain.handle('activate-license', (_event, key: string) => activateLicense(String(key ?? '')));
  ipcMain.handle('remove-license', () => removeLicense());
  // Manual "Refresh license" button (#117) — forces the check regardless of
  // the expiry window; the automatic launch/paywall triggers call
  // maybeRefreshLicense() unforced from license-refresh.ts / index.html.
  ipcMain.handle('refresh-license', () => maybeRefreshLicense({ force: true }));
}
