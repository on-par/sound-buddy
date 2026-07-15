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
  dialogError: string | null;
  checkLicense(now?: Date): Promise<void>;
  activateLicense(key: string, now?: Date): Promise<void>;
  removeLicense(now?: Date): Promise<void>;
  refreshLicense(now?: Date): Promise<void>;
  startTrial(now?: Date): Promise<void>;
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

// Port of app/renderer/license-state.js's graceDaysLeft(): whole days of
// grace left (ceiling, min 1 while active), or null when the state isn't in
// a grace period.
export function deriveGraceDaysLeft(state: LicenseState, now: Date): number | null {
  if (state.status !== 'grace' || !state.graceEndsAt) return null;
  const endMs = Date.parse(state.graceEndsAt);
  if (isNaN(endMs)) return null;
  const ms = endMs - now.getTime();
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

// Port of app/renderer/license-state.js's graceBannerText(): banner copy
// during a grace period, or null when the state isn't in grace / the dates
// don't parse.
function graceBannerLine(state: LicenseState, now: Date): string | null {
  const days = deriveGraceDaysLeft(state, now);
  if (days === null) return null;
  const unit = days === 1 ? 'day' : 'days';
  return `Your license has expired — Pro features stay unlocked for ${days} more ${unit}. Renew to keep them.`;
}

// Port of inline-app.js's licenseStatusLine(): the license dialog's status
// line, string-identical across every status. `trialDaysLeft` is pre-derived
// via deriveTrialDaysLeft since LicensingState already carries it; `now` only
// feeds the grace branch's day count (mirrors graceBannerText's own default).
export function licenseStatusLine(
  state: LicenseState | null,
  trialDaysLeft: number | null,
  now: Date = new Date()
): string {
  if (!state || state.status === 'none') return 'Free tier — full report card included.';
  if (state.status === 'trial') {
    const left = trialDaysLeft ? `${trialDaysLeft} ${trialDaysLeft === 1 ? 'day' : 'days'} left` : 'active';
    return `Pro trial — ${left}. Start a subscription to keep Pro when it ends.`;
  }
  if (state.status === 'trial-expired') {
    return 'Your Pro trial has ended — the report card stays free. Start a subscription to reunlock Pro features.';
  }
  if (state.status === 'valid') {
    const who = state.email ? ` (${state.email})` : '';
    if (state.kind === 'lifetime') return `Pro — lifetime license${who}.`;
    const until = state.expiresAt ? ` until ${new Date(state.expiresAt).toLocaleDateString()}` : '';
    return `Pro — active${until}${who}.`;
  }
  if (state.status === 'grace') return graceBannerLine(state, now) || 'License expired — grace period active.';
  if (state.status === 'expired') return 'License expired — back on the free tier. Renew to restore Pro features.';
  // Invalid: surface the specific reason the validator computed (bad paste vs
  // wrong product vs issuance bug) rather than a generic shrug.
  return 'License key could not be validated' + (state.error ? ': ' + state.error : '') + '.';
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
    dialogError: null,
    async checkLicense(now = new Date()) {
      set(projectLicense(await getApi().getLicense(), now));
    },
    async activateLicense(key, now = new Date()) {
      let state: LicenseState;
      try {
        state = await getApi().activateLicense(key);
      } catch (err) {
        set({ dialogError: 'Could not save the license: ' + String(err) });
        return;
      }
      if (state.tier === 'pro') {
        // Unlocks immediately — no restart (acceptance criterion) — and
        // closes the dialog just like the inline flow did.
        set({ ...projectLicense(state, now), dialogOpen: false, dialogError: null });
      } else {
        // Invalid/expired key: the main process leaves any previously stored
        // key untouched, so licenseStatus must not move either.
        set({ dialogError: licenseStatusLine(state, deriveTrialDaysLeft(state, now)) });
      }
    },
    async removeLicense(now = new Date()) {
      let state: LicenseState;
      try {
        state = await getApi().removeLicense();
      } catch (err) {
        // The main process rethrows a failed delete — don't pretend the key
        // is gone (it would come back on the next read).
        set({ dialogError: 'Could not remove the license: ' + String(err) });
        return;
      }
      set({ ...projectLicense(state, now), dialogError: null });
    },
    async refreshLicense(now = new Date()) {
      // Best-effort, silent-failure contract (#117): a rejected IPC call or a
      // falsy result just leaves the current state on screen.
      try {
        const state = await getApi().refreshLicense();
        if (state) set(projectLicense(state, now));
      } catch {
        /* keep current state */
      }
    },
    // The main process stamps the trial itself at startup (ensureTrialStarted()
    // in app/electron/license.ts) — there is no start-trial IPC. This just
    // re-projects whatever the main process already resolved.
    async startTrial(now = new Date()) {
      set(projectLicense(await getApi().getLicense(), now));
    },
    openDialog() {
      set({ dialogOpen: true, dialogError: null });
    },
    closeDialog() {
      set({ dialogOpen: false });
    },
  }));
}

export const useLicensingStore = createLicensingStore(getSoundBuddy);
