// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  createLicensingStore,
  useLicensingStore,
  deriveTrialDaysLeft,
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

  it('activates a valid key', async () => {
    const licenseState: LicenseState = { tier: 'pro', status: 'valid', kind: 'lifetime' };
    const mock = createMockSoundBuddy({
      activateLicense: async (key) => {
        mock.calls.push({ method: 'activateLicense', args: [key] });
        return licenseState;
      },
    });
    const store = createLicensingStore(() => mock.api);

    await store.getState().activateLicense('SB1-XXXX', NOW);

    expect(store.getState().isLicensed).toBe(true);
    expect(store.getState().licenseStatus?.kind).toBe('lifetime');
    expect(mock.calls).toContainEqual({ method: 'activateLicense', args: ['SB1-XXXX'] });
  });

  it('projects an invalid key without throwing', async () => {
    const licenseState: LicenseState = {
      tier: 'free',
      status: 'invalid',
      error: 'Key not recognized — check for typos and paste the full key.',
    };
    const mock = createMockSoundBuddy({ activateLicense: async () => licenseState });
    const store = createLicensingStore(() => mock.api);

    await store.getState().activateLicense('bad-key', NOW);

    expect(store.getState().isLicensed).toBe(false);
    expect(store.getState().licenseStatus?.error).toBe(
      'Key not recognized — check for typos and paste the full key.'
    );
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
