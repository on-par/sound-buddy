// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Tier 2 (console-network / OSC-UDP) consent gate (#378) — the mandatory
// pre-flight check every future Tier 2 main-process module (e.g. #371's OSC
// client) must call with the current getSettings() result before ever
// calling dgram.createSocket or equivalent. There is no other sanctioned way
// to open a console-network socket in this codebase. Pure module: no
// Electron imports, and no imports of ./license or ./ipc/licensing (or any
// worker/Stripe code) — the license/Stripe code path stays fully decoupled
// from console-networking, per the council's #378 requirement.

import type { AppSettings } from './ipc/api';

/** Exactly what a Tier 2 feature reads from the console over OSC/UDP — read-only. */
export const CONSOLE_NETWORK_CONSENT_SCOPE: readonly string[] = [
  'channel names',
  'channel levels',
  'routing configuration',
];

export function hasConsoleNetworkConsent(
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>
): boolean {
  return settings.consoleNetworkConsentGranted === true;
}

export class ConsoleNetworkConsentError extends Error {}

export function assertConsoleNetworkConsent(
  settings: Pick<AppSettings, 'consoleNetworkConsentGranted'>
): void {
  if (!hasConsoleNetworkConsent(settings)) {
    throw new ConsoleNetworkConsentError(
      'Console network access requires consent — show the Tier 2 consent modal (#378) and wait for the user to grant access before opening any OSC socket.'
    );
  }
}
