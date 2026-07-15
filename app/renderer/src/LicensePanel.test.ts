// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LicensePanel, { licenseStatusLine, activate, remove, refresh } from './LicensePanel';
import { ElectronContext } from './useElectron';
import { createLicensingStore, useLicensingStore } from './stores/licensingStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { LicenseState } from '../../electron/ipc/api';

afterEach(() => {
  useLicensingStore.setState({
    licenseStatus: null,
    trialDaysLeft: null,
    isTrial: false,
    isLicensed: false,
    dialogOpen: false,
  });
});

function renderMarkup(): string {
  const mock = createMockSoundBuddy();
  return renderToString(createElement(ElectronContext.Provider, { value: mock.api }, createElement(LicensePanel)));
}

describe('licenseStatusLine', () => {
  it('describes the free tier when there is no state', () => {
    expect(licenseStatusLine(null, null)).toBe('Free tier — full report card included.');
  });

  it('describes the free tier for status "none"', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'none' }, null)).toBe(
      'Free tier — full report card included.'
    );
  });

  it('pluralizes trial days left', () => {
    expect(licenseStatusLine({ tier: 'pro', status: 'trial' }, 5)).toBe(
      'Pro trial — 5 days left. Start a subscription to keep Pro when it ends.'
    );
    expect(licenseStatusLine({ tier: 'pro', status: 'trial' }, 1)).toBe(
      'Pro trial — 1 day left. Start a subscription to keep Pro when it ends.'
    );
  });

  it('falls back to "active" when trial days left is null', () => {
    expect(licenseStatusLine({ tier: 'pro', status: 'trial' }, null)).toBe(
      'Pro trial — active. Start a subscription to keep Pro when it ends.'
    );
  });

  it('describes an ended trial', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'trial-expired' }, null)).toBe(
      'Your Pro trial has ended — the report card stays free. Start a subscription to reunlock Pro features.'
    );
  });

  it('describes a lifetime license with email', () => {
    expect(
      licenseStatusLine({ tier: 'pro', status: 'valid', kind: 'lifetime', email: 'e@x.com' }, null)
    ).toBe('Pro — lifetime license (e@x.com).');
  });

  it('describes a lifetime license without email', () => {
    expect(licenseStatusLine({ tier: 'pro', status: 'valid', kind: 'lifetime' }, null)).toBe(
      'Pro — lifetime license.'
    );
  });

  it('describes a subscription with an expiry date and no email', () => {
    const line = licenseStatusLine(
      { tier: 'pro', status: 'valid', kind: 'subscription', expiresAt: '2027-01-01T00:00:00Z' },
      null
    );
    expect(line).toMatch(/^Pro — active until /);
    expect(line.endsWith('.')).toBe(true);
  });

  it('describes a subscription with no expiry and no email', () => {
    expect(licenseStatusLine({ tier: 'pro', status: 'valid', kind: 'subscription' }, null)).toBe(
      'Pro — active.'
    );
  });

  it('describes a grace-period license', () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const line = licenseStatusLine({ tier: 'pro', status: 'grace', graceEndsAt: future }, null);
    expect(line).toContain('Renew to keep them.');
  });

  it('falls back to a generic grace message when graceEndsAt is unparseable', () => {
    expect(licenseStatusLine({ tier: 'pro', status: 'grace', graceEndsAt: 'nope' }, null)).toBe(
      'License expired — grace period active.'
    );
  });

  it('describes an expired license', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'expired' }, null)).toBe(
      'License expired — back on the free tier. Renew to restore Pro features.'
    );
  });

  it('describes an invalid key with a reason', () => {
    expect(
      licenseStatusLine({ tier: 'free', status: 'invalid', error: 'Key not recognized' }, null)
    ).toBe('License key could not be validated: Key not recognized.');
  });

  it('describes an invalid key without a reason', () => {
    expect(licenseStatusLine({ tier: 'free', status: 'invalid' }, null)).toBe(
      'License key could not be validated.'
    );
  });
});

describe('activate', () => {
  it('closes the dialog and clears the error on a pro result', async () => {
    const licenseState: LicenseState = { tier: 'pro', status: 'valid', kind: 'lifetime' };
    const mock = createMockSoundBuddy({ activateLicense: async () => licenseState });
    const store = createLicensingStore(() => mock.api);
    store.getState().openDialog();
    let error = 'stale';
    const setError = (msg: string) => { error = msg; };

    await activate('SB1-XXXX', store, setError);

    expect(store.getState().dialogOpen).toBe(false);
    expect(error).toBe('');
  });

  it('sets the status line as the error on a non-pro result', async () => {
    const licenseState: LicenseState = { tier: 'free', status: 'invalid', error: 'bad key' };
    const mock = createMockSoundBuddy({ activateLicense: async () => licenseState });
    const store = createLicensingStore(() => mock.api);
    let error = '';
    const setError = (msg: string) => { error = msg; };

    await activate('bad', store, setError);

    expect(error).toBe('License key could not be validated: bad key.');
  });

  it('sets a save-failed message when the IPC call throws', async () => {
    const mock = createMockSoundBuddy({ activateLicense: () => Promise.reject(new Error('offline')) });
    const store = createLicensingStore(() => mock.api);
    let error = '';
    const setError = (msg: string) => { error = msg; };

    await activate('SB1-XXXX', store, setError);

    expect(error).toBe('Could not save the license: Error: offline');
  });
});

describe('remove', () => {
  it('clears the error on success', async () => {
    const mock = createMockSoundBuddy({ removeLicense: async () => ({ tier: 'free', status: 'none' }) });
    const store = createLicensingStore(() => mock.api);
    let error = 'stale';
    const setError = (msg: string) => { error = msg; };

    await remove(store, setError);

    expect(error).toBe('');
    expect(store.getState().licenseStatus).toEqual({ tier: 'free', status: 'none' });
  });

  it('sets a remove-failed message when the IPC call throws', async () => {
    const mock = createMockSoundBuddy({ removeLicense: () => Promise.reject(new Error('locked')) });
    const store = createLicensingStore(() => mock.api);
    let error = '';
    const setError = (msg: string) => { error = msg; };

    await remove(store, setError);

    expect(error).toBe('Could not remove the license: Error: locked');
  });
});

describe('refresh', () => {
  it('updates state silently on success', async () => {
    const licenseState: LicenseState = { tier: 'pro', status: 'valid', kind: 'subscription' };
    const mock = createMockSoundBuddy({ refreshLicense: async () => licenseState });
    const store = createLicensingStore(() => mock.api);

    await refresh(store);

    expect(store.getState().licenseStatus).toEqual(licenseState);
  });

  it('keeps current state silently when the IPC call rejects', async () => {
    const prior: LicenseState = { tier: 'pro', status: 'valid', kind: 'subscription' };
    const mock = createMockSoundBuddy({ refreshLicense: () => Promise.reject(new Error('down')) });
    const store = createLicensingStore(() => mock.api);
    store.setState({ licenseStatus: prior });

    await expect(refresh(store)).resolves.toBeUndefined();
    expect(store.getState().licenseStatus).toEqual(prior);
  });
});

describe('LicensePanel markup', () => {
  it('renders hidden by default with the free-tier status line', () => {
    const html = renderMarkup();
    expect(html).toContain('id="license-dialog"');
    expect(html).toContain('style="display:none"');
    expect(html).toContain('Free tier — full report card included.');
  });

  it('shows flex display when the dialog is open', () => {
    useLicensingStore.setState({ dialogOpen: true });
    const html = renderMarkup();
    expect(html).toContain('style="display:flex"');
  });

  it('hides remove/refresh for a free user', () => {
    const html = renderMarkup();
    const removeBtn = html.match(/<button[^>]*id="license-remove-btn"[^>]*>/)![0];
    const refreshBtn = html.match(/<button[^>]*id="license-refresh-btn"[^>]*>/)![0];
    expect(removeBtn).toContain('display:none');
    expect(refreshBtn).toContain('display:none');
  });

  it('shows remove but not refresh for a lifetime pro user', () => {
    useLicensingStore.setState({ licenseStatus: { tier: 'pro', status: 'valid', kind: 'lifetime' } });
    const html = renderMarkup();
    const removeBtn = html.match(/<button[^>]*id="license-remove-btn"[^>]*>/)![0];
    const refreshBtn = html.match(/<button[^>]*id="license-refresh-btn"[^>]*>/)![0];
    expect(removeBtn).toContain('display:inline-flex');
    expect(refreshBtn).toContain('display:none');
  });

  it('shows both remove and refresh for a subscription pro user', () => {
    useLicensingStore.setState({ licenseStatus: { tier: 'pro', status: 'valid', kind: 'subscription' } });
    const html = renderMarkup();
    const removeBtn = html.match(/<button[^>]*id="license-remove-btn"[^>]*>/)![0];
    const refreshBtn = html.match(/<button[^>]*id="license-refresh-btn"[^>]*>/)![0];
    expect(removeBtn).toContain('display:inline-flex');
    expect(refreshBtn).toContain('display:inline-flex');
  });

  it('renders the error div hidden with empty text by default', () => {
    const html = renderMarkup();
    expect(html).toMatch(/id="license-dialog-error"[^>]*style="display:none"/);
  });
});
