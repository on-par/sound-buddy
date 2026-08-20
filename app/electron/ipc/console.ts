// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The thin IPC surface for #884: wires #876's discoverConsoles and #877's
// fetchConsoleIdentity to the renderer. Both channels are reads — see the
// #884 ADR (console panel is read-only by construction, pinned by
// console-read-only-gate.test.ts). Consent (ADR-0006/ADR-0013) is asserted
// inside the delegated modules via assertConsoleNetworkConsent; main
// revalidates a manually-entered IP before ever touching the network because
// the renderer is never trusted (threat-model.test.ts discipline).

import { ipcMain } from 'electron';
import { log, logWarn } from '../logger';
import { getSettings } from '../settings';
import { discoverConsoles } from './console-discovery';
import { fetchConsoleIdentity } from './console-connection';
import type { ScanConsolesResult, FetchConsoleIdentityResult } from './api';

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_OCTET = 255;

export function isValidConsoleIp(ip: unknown): ip is string {
  if (typeof ip !== 'string') return false;
  const match = IPV4_PATTERN.exec(ip);
  if (!match) return false;
  return match.slice(1).every((octet) => {
    if (octet.length > 1 && octet.startsWith('0')) return false;
    return Number(octet) <= MAX_OCTET;
  });
}

function actionableError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function registerConsoleHandlers(): void {
  ipcMain.handle('scan-consoles', async (): Promise<ScanConsolesResult> => {
    try {
      const consoles = await discoverConsoles({ log }, getSettings());
      return { success: true, consoles };
    } catch (err) {
      const error = actionableError(
        err,
        "Couldn't scan for a console. Check this Mac is on the same network as the console, then try again."
      );
      logWarn(`scan-consoles failed: ${error}`);
      return { success: false, error };
    }
  });

  ipcMain.handle('fetch-console-identity', async (_e, ip: unknown): Promise<FetchConsoleIdentityResult> => {
    if (!isValidConsoleIp(ip)) {
      return {
        success: false,
        error: 'Enter the console IP as four numbers separated by dots, for example 192.168.1.50.',
      };
    }
    try {
      const identity = await fetchConsoleIdentity({ log }, getSettings(), ip);
      return { success: true, identity };
    } catch (err) {
      const error = actionableError(
        err,
        "Couldn't read the console's identity. Check the IP is correct and the console is powered on and reachable on the network."
      );
      logWarn(`fetch-console-identity failed: ${error}`);
      return { success: false, error };
    }
  });
}
