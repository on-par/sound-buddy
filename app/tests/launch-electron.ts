// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { _electron as electron } from 'playwright';
import type { ElectronApplication } from '@playwright/test';

// Headless-by-default e2e launches live here so specs cannot drift back to
// visible windows. SB_E2E_HEADED=1 is the local debugging escape hatch; the
// repository guard in app/electron/e2e-headless.test.ts enforces this boundary.

/** The launch options any spec is allowed to choose for itself. */
export interface LaunchElectronOptions {
  /** argv after the entry point (unpackaged) or after the executable (packaged). */
  args?: string[];
  /**
   * Full environment for the launched app. Callers own it (packaged specs pass a
   * deliberately restricted PATH/HOME); the headless flag is merged into it.
   */
  env?: NodeJS.ProcessEnv;
  /** Packaged-app specs only: the .app's binary. */
  executablePath?: string;
}

/**
 * Chromium switches that keep a never-shown window's timers and
 * requestAnimationFrame running, so animation-rate specs (meters, transport)
 * still observe DOM updates while headless.
 */
export const HEADLESS_SWITCHES: readonly string[] = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

/** True when the human running the suite asked for a visible window. */
export function isHeaded(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SB_E2E_HEADED === '1';
}

/**
 * Pure: apply the headless decision to a caller's launch options. Headless is
 * the default — it sets SB_E2E_HEADLESS=1, which main.ts's getWindowOptions
 * reads to construct the BrowserWindow with show:false.
 */
export function headlessLaunchOptions(
  opts: LaunchElectronOptions,
  headed: boolean,
): LaunchElectronOptions {
  if (headed) return opts;
  return {
    ...opts,
    args: [...(opts.args ?? []), ...HEADLESS_SWITCHES],
    env: { ...(opts.env ?? process.env), SB_E2E_HEADLESS: '1' },
  };
}

/** The one and only _electron.launch in the repo (#1249). */
export function launchElectron(opts: LaunchElectronOptions = {}): Promise<ElectronApplication> {
  // Playwright's launch type requires every env value to be a string, while the
  // public test helper accepts NodeJS.ProcessEnv to preserve callers' envs.
  return electron.launch(
    headlessLaunchOptions(opts, isHeaded()) as unknown as Parameters<typeof electron.launch>[0],
  );
}
