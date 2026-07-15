// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { LicenseApi, LicenseState } from '../../../electron/ipc/api';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LicensingState {
  licenseStatus: LicenseState | null;
  trialDaysLeft: number | null;
  isTrial: boolean;
  isLicensed: boolean;
  dialogOpen: boolean;
  checkLicense(now?: Date): Promise<void>;
  activateLicense(key: string, now?: Date): Promise<void>;
  startTrial(now?: Date): Promise<void>;
  removeLicense(now?: Date): Promise<void>;
  refreshLicense(now?: Date): Promise<void>;
  openDialog(): void;
  closeDialog(): void;
}

// Port of app/renderer/license-state.js's trialDaysLeft(): whole days left
// (ceiling, min 1 while active), or null when the state isn't an active trial.
export function deriveTrialDaysLeft(state: LicenseState, now: Date): number | null {
  if (state.status !== 'trial' || !state.trialEndsAt) return null;
  const endMs = Date.parse(state.trialEndsAt);
  if (isNaN(endMs)) return null;
  const ms = endMs - now.getTime();
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

export function projectLicense(
  state: LicenseState,
  now: Date
): Pick<LicensingState, 'licenseStatus' | 'trialDaysLeft' | 'isTrial' | 'isLicensed'> {
  const isTrial = state.status === 'trial';
  const isLicensed = state.tier === 'pro' && (state.status === 'valid' || state.status === 'grace');
  return {
    licenseStatus: state,
    trialDaysLeft: deriveTrialDaysLeft(state, now),
    isTrial,
    isLicensed,
  };
}

export function createLicensingStore(getApi: () => LicenseApi) {
  return create<LicensingState>()((set) => ({
    licenseStatus: null,
    trialDaysLeft: null,
    isTrial: false,
    isLicensed: false,
    dialogOpen: false,
    // Mount-time fetch + the 60s entitlement poll (LicensePanel.tsx) both fire
    // this with a bare `void` — same never-throw contract as refreshLicense,
    // matching the try/catch the poll it replaces always had (a rejected
    // round-trip must not become an unhandled rejection every minute).
    async checkLicense(now = new Date()) {
      try {
        set(projectLicense(await getApi().getLicense(), now));
      } catch {
        // keep current state
      }
    },
    async activateLicense(key, now = new Date()) {
      set(projectLicense(await getApi().activateLicense(key), now));
    },
    // The main process stamps the trial itself at startup (ensureTrialStarted()
    // in app/electron/license.ts) — there is no start-trial IPC. This just
    // re-projects whatever the main process already resolved.
    async startTrial(now = new Date()) {
      set(projectLicense(await getApi().getLicense(), now));
    },
    // The main process rethrows a failed delete (inline-app.js:3346–3361) — let
    // the rejection propagate so the panel can show it instead of pretending
    // the key is gone.
    async removeLicense(now = new Date()) {
      set(projectLicense(await getApi().removeLicense(), now));
    },
    // Best-effort background refresh (inline-app.js:3365–3375 and the auto-kick
    // at 3180): the IPC round-trip can reject, but there is nothing useful to
    // show for it — keep whatever state is already on screen.
    async refreshLicense(now = new Date()) {
      try {
        set(projectLicense(await getApi().refreshLicense(), now));
      } catch {
        // keep current state
      }
    },
    openDialog() {
      set({ dialogOpen: true });
    },
    closeDialog() {
      set({ dialogOpen: false });
    },
  }));
}

export const useLicensingStore = createLicensingStore(getSoundBuddy);
