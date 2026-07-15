// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  createLicensingStore,
  useLicensingStore,
  deriveTrialDaysLeft,
  deriveGraceDaysLeft,
  licenseStatusLine,
} from './licensingStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';
import type { LicenseState } from '../../../electron/ipc/api';

const NOW = new Date('2026-07-15T00:00:00Z');

describe('createLicensingStore', () => {
  it('starts with a fresh, unlicensed state', () => {
    const mock = createMockSoundBuddy();
    const store = createLicensingStore(() => mock.api);

    expect(store.getState().licenseStatus).toBeNull();
    expect(store.getState().trialDaysLeft).toBeNull();
    expect(store.getState().isTrial).toBe(false);
    expect(store.getState().isLicensed).toBe(false);
    expect(store.getState().dialogOpen).toBe(false);
    expect(store.getState().dialogError).toBeNull();
  });

  it('projects a trial license', async () => {
    const licenseState: LicenseState = {
      tier: 'pro',
      status: 'trial',
      trialEndsAt: '2026-07-20T00:00:00Z',
    };
    const mock = createMockSoundBuddy({ getLicense: async () => licenseState });
    const store = createLicensingStore(() => mock.api);

    await store.getState().checkLicense(NOW);

    expect(store.getState().isTrial).toBe(true);
    expect(store.getState().isLicensed).toBe(false);
    expect(store.getState().trialDaysLeft).toBe(5);
    expect(store.getState().licenseStatus).toEqual(licenseState);
  });

  it('projects a free/none license', async () => {
    const licenseState: LicenseState = { tier: 'free', status: 'none' };
    const mock = createMockSoundBuddy({ getLicense: async () => licenseState });
    const store = createLicensingStore(() => mock.api);

    await store.getState().checkLicense(NOW);

    expect(store.getState().isTrial).toBe(false);
    expect(store.getState().isLicensed).toBe(false);
    expect(store.getState().trialDaysLeft).toBeNull();
  });

  it('treats valid and grace as licensed, not trial', async () => {
    for (const status of ['valid', 'grace'] as const) {
      const licenseState: LicenseState = { tier: 'pro', status };
      const mock = createMockSoundBuddy({ getLicense: async () => licenseState });
      const store = createLicensingStore(() => mock.api);

      await store.getState().checkLicense(NOW);

      expect(store.getState().isLicensed).toBe(true);
      expect(store.getState().isTrial).toBe(false);
    }
  });

  it('re-projects license state on startTrial', async () => {
    const licenseState: LicenseState = {
      tier: 'pro',
      status: 'trial',
      trialEndsAt: '2026-07-20T00:00:00Z',
    };
    const mock = createMockSoundBuddy({
      getLicense: async () => {
        mock.calls.push({ method: 'getLicense', args: [] });
        return licenseState;
      },
    });
    const store = createLicensingStore(() => mock.api);

    await store.getState().startTrial(NOW);

    expect(store.getState().isTrial).toBe(true);
    expect(mock.calls).toContainEqual({ method: 'getLicense', args: [] });
  });

  it('binds the default hook to the module-level state shape', () => {
    expect(useLicensingStore.getState().licenseStatus).toBeNull();
    expect(useLicensingStore.getState().isLicensed).toBe(false);
  });

  describe('openDialog / closeDialog', () => {
    it('opens the dialog and clears any stale error', () => {
      const mock = createMockSoundBuddy();
      const store = createLicensingStore(() => mock.api);
      store.setState({ dialogError: 'stale error' });

      store.getState().openDialog();

      expect(store.getState().dialogOpen).toBe(true);
      expect(store.getState().dialogError).toBeNull();
    });

    it('closes the dialog without touching the error', () => {
      const mock = createMockSoundBuddy();
      const store = createLicensingStore(() => mock.api);
      store.setState({ dialogOpen: true, dialogError: 'kept' });

      store.getState().closeDialog();

      expect(store.getState().dialogOpen).toBe(false);
      expect(store.getState().dialogError).toBe('kept');
    });
  });

  describe('activateLicense', () => {
    it('applies a pro key immediately and closes the dialog', async () => {
      const licenseState: LicenseState = { tier: 'pro', status: 'valid', kind: 'lifetime' };
      const mock = createMockSoundBuddy({
        activateLicense: async (key) => {
          mock.calls.push({ method: 'activateLicense', args: [key] });
          return licenseState;
        },
      });
      const store = createLicensingStore(() => mock.api);
      store.setState({ dialogOpen: true, dialogError: 'stale' });

      await store.getState().activateLicense('SB1-XXXX', NOW);

      expect(store.getState().isLicensed).toBe(true);
      expect(store.getState().licenseStatus?.kind).toBe('lifetime');
      expect(store.getState().dialogOpen).toBe(false);
      expect(store.getState().dialogError).toBeNull();
      expect(mock.calls).toContainEqual({ method: 'activateLicense', args: ['SB1-XXXX'] });
    });

    it('leaves licenseStatus untouched for an invalid key and sets dialogError', async () => {
      const invalidState: LicenseState = {
        tier: 'free',
        status: 'invalid',
        error: 'Key not recognized — check for typos and paste the full key.',
      };
      const mock = createMockSoundBuddy({ activateLicense: async () => invalidState });
      const store = createLicensingStore(() => mock.api);
      store.setState({ dialogOpen: true });

      await store.getState().activateLicense('bad-key', NOW);

      expect(store.getState().licenseStatus).toBeNull();
      expect(store.getState().isLicensed).toBe(false);
      expect(store.getState().dialogOpen).toBe(true);
      expect(store.getState().dialogError).toBe(
        'License key could not be validated: Key not recognized — check for typos and paste the full key..'
      );
    });

    it('sets a save-error and leaves licenseStatus untouched when the IPC call throws', async () => {
      const mock = createMockSoundBuddy({
        activateLicense: () => Promise.reject(new Error('disk full')),
      });
      const store = createLicensingStore(() => mock.api);

      await store.getState().activateLicense('SB1-XXXX', NOW);

      expect(store.getState().licenseStatus).toBeNull();
      expect(store.getState().dialogError).toBe('Could not save the license: Error: disk full');
    });
  });

  describe('removeLicense', () => {
    it('projects the freed state and clears dialogError on success', async () => {
      const freeState: LicenseState = { tier: 'free', status: 'none' };
      const mock = createMockSoundBuddy({ removeLicense: async () => freeState });
      const store = createLicensingStore(() => mock.api);
      store.setState({
        licenseStatus: { tier: 'pro', status: 'valid', kind: 'lifetime' },
        dialogError: 'stale',
      });

      await store.getState().removeLicense(NOW);

      expect(store.getState().licenseStatus).toEqual(freeState);
      expect(store.getState().isLicensed).toBe(false);
      expect(store.getState().dialogError).toBeNull();
    });

    it('sets a remove-error and keeps the existing state when the IPC call throws', async () => {
      const existing: LicenseState = { tier: 'pro', status: 'valid', kind: 'lifetime' };
      const mock = createMockSoundBuddy({
        removeLicense: () => Promise.reject(new Error('keychain locked')),
      });
      const store = createLicensingStore(() => mock.api);
      store.setState({ licenseStatus: existing });

      await store.getState().removeLicense(NOW);

      expect(store.getState().licenseStatus).toEqual(existing);
      expect(store.getState().dialogError).toBe('Could not remove the license: Error: keychain locked');
    });
  });

  describe('refreshLicense', () => {
    it('projects the refreshed state on success', async () => {
      const refreshed: LicenseState = { tier: 'pro', status: 'valid', kind: 'subscription' };
      const mock = createMockSoundBuddy({ refreshLicense: async () => refreshed });
      const store = createLicensingStore(() => mock.api);

      await store.getState().refreshLicense(NOW);

      expect(store.getState().licenseStatus).toEqual(refreshed);
    });

    it('silently keeps the current state when the IPC call throws', async () => {
      const existing: LicenseState = { tier: 'pro', status: 'valid', kind: 'subscription' };
      const mock = createMockSoundBuddy({
        refreshLicense: () => Promise.reject(new Error('offline')),
      });
      const store = createLicensingStore(() => mock.api);
      store.setState({ licenseStatus: existing });

      await store.getState().refreshLicense(NOW);

      expect(store.getState().licenseStatus).toEqual(existing);
      expect(store.getState().dialogError).toBeNull();
    });

    it('silently keeps the current state when the result is falsy', async () => {
      const existing: LicenseState = { tier: 'pro', status: 'valid', kind: 'subscription' };
      const mock = createMockSoundBuddy({
        // @ts-expect-error — exercising the main process's best-effort null contract
        refreshLicense: async () => null,
      });
      const store = createLicensingStore(() => mock.api);
      store.setState({ licenseStatus: existing });

      await store.getState().refreshLicense(NOW);

      expect(store.getState().licenseStatus).toEqual(existing);
    });
  });
});

describe('deriveTrialDaysLeft', () => {
  it('is null for a non-trial status', () => {
    expect(deriveTrialDaysLeft({ tier: 'pro', status: 'valid' }, NOW)).toBeNull();
  });

  it('is null when trialEndsAt is missing', () => {
    expect(deriveTrialDaysLeft({ tier: 'pro', status: 'trial' }, NOW)).toBeNull();
  });

  it('is null when trialEndsAt is unparseable', () => {
    expect(
      deriveTrialDaysLeft({ tier: 'pro', status: 'trial', trialEndsAt: 'not-a-date' }, NOW)
    ).toBeNull();
  });

  it('is null when trialEndsAt is in the past', () => {
    expect(
      deriveTrialDaysLeft(
        { tier: 'pro', status: 'trial', trialEndsAt: '2026-07-01T00:00:00Z' },
        NOW
      )
    ).toBeNull();
  });

  it('clamps to a minimum of 1 day when ending within an hour', () => {
    expect(
      deriveTrialDaysLeft(
        { tier: 'pro', status: 'trial', trialEndsAt: '2026-07-15T01:00:00Z' },
        NOW
      )
    ).toBe(1);
  });

  it('ceilings to whole days for an exact multi-day span', () => {
    expect(
      deriveTrialDaysLeft(
        { tier: 'pro', status: 'trial', trialEndsAt: '2026-07-20T00:00:00Z' },
        NOW
      )
    ).toBe(5);
  });
});

describe('deriveGraceDaysLeft', () => {
  it('is null for a non-grace status', () => {
    expect(deriveGraceDaysLeft({ tier: 'pro', status: 'valid' }, NOW)).toBeNull();
  });

  it('is null when graceEndsAt is missing', () => {
    expect(deriveGraceDaysLeft({ tier: 'pro', status: 'grace' }, NOW)).toBeNull();
  });

  it('is null when graceEndsAt is in the past', () => {
    expect(
      deriveGraceDaysLeft({ tier: 'pro', status: 'grace', graceEndsAt: '2026-07-01T00:00:00Z' }, NOW)
    ).toBeNull();
  });

  it('ceilings to whole days', () => {
    expect(
      deriveGraceDaysLeft({ tier: 'pro', status: 'grace', graceEndsAt: '2026-07-18T00:00:00Z' }, NOW)
    ).toBe(3);
  });
});

describe('licenseStatusLine', () => {
  it('reads free tier for null state', () => {
    expect(licenseStatusLine(null, null)).toBe('Free tier — full report card included.');
  });

  it('reads free tier for status "none"', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'none' }, null)).toBe(
      'Free tier — full report card included.'
    );
  });

  it('reads an active trial with a day count', () => {
    const state: LicenseState = { tier: 'pro', status: 'trial', trialEndsAt: '2026-07-20T00:00:00Z' };
    expect(licenseStatusLine(state, 5)).toBe(
      'Pro trial — 5 days left. Start a subscription to keep Pro when it ends.'
    );
  });

  it('singularizes a 1-day trial', () => {
    const state: LicenseState = { tier: 'pro', status: 'trial', trialEndsAt: '2026-07-16T00:00:00Z' };
    expect(licenseStatusLine(state, 1)).toBe(
      'Pro trial — 1 day left. Start a subscription to keep Pro when it ends.'
    );
  });

  it('falls back to "active" when the trial day count is unavailable', () => {
    const state: LicenseState = { tier: 'pro', status: 'trial' };
    expect(licenseStatusLine(state, null)).toBe(
      'Pro trial — active. Start a subscription to keep Pro when it ends.'
    );
  });

  it('reads an expired trial', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'trial-expired' }, null)).toBe(
      'Your Pro trial has ended — the report card stays free. Start a subscription to reunlock Pro features.'
    );
  });

  it('reads a valid lifetime license', () => {
    expect(licenseStatusLine({ tier: 'pro', status: 'valid', kind: 'lifetime' }, null)).toBe(
      'Pro — lifetime license.'
    );
  });

  it('reads a valid lifetime license with an email', () => {
    expect(
      licenseStatusLine({ tier: 'pro', status: 'valid', kind: 'lifetime', email: 'a@b.com' }, null)
    ).toBe('Pro — lifetime license (a@b.com).');
  });

  it('reads a valid subscription with expiry and email', () => {
    const state: LicenseState = {
      tier: 'pro',
      status: 'valid',
      kind: 'subscription',
      email: 'a@b.com',
      expiresAt: '2026-08-01T00:00:00Z',
    };
    expect(licenseStatusLine(state, null)).toBe(
      `Pro — active until ${new Date('2026-08-01T00:00:00Z').toLocaleDateString()} (a@b.com).`
    );
  });

  it('reads a valid subscription with no expiry or email', () => {
    expect(licenseStatusLine({ tier: 'pro', status: 'valid', kind: 'subscription' }, null)).toBe(
      'Pro — active.'
    );
  });

  it('reads the grace banner text', () => {
    const state: LicenseState = { tier: 'pro', status: 'grace', graceEndsAt: '2026-07-18T00:00:00Z' };
    expect(licenseStatusLine(state, null, NOW)).toBe(
      'Your license has expired — Pro features stay unlocked for 3 more days. Renew to keep them.'
    );
  });

  it('falls back to a generic grace line when graceEndsAt is missing', () => {
    expect(licenseStatusLine({ tier: 'pro', status: 'grace' }, null, NOW)).toBe(
      'License expired — grace period active.'
    );
  });

  it('reads expired', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'expired' }, null)).toBe(
      'License expired — back on the free tier. Renew to restore Pro features.'
    );
  });

  it('reads invalid with a reason', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'invalid', error: 'bad signature' }, null)).toBe(
      'License key could not be validated: bad signature.'
    );
  });

  it('reads invalid without a reason', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'invalid' }, null)).toBe(
      'License key could not be validated.'
    );
  });
});
