// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SettingsPlanStatus from './SettingsPlanStatus';
import { useLicensingStore } from './stores/licensingStore';
import type { LicenseState } from '../../electron/ipc/api';

// upgrade-prompt.js is a classic script loaded via BOOT_SCRIPTS in the real
// app; here it's read straight off require() and hung on window, matching
// UpgradeMomentum.test.ts's pattern for its sibling module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const upgradePromptApi = require('../upgrade-prompt.js');

function renderMarkup(): string {
  return renderToString(createElement(SettingsPlanStatus));
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { upgradePrompt: upgradePromptApi };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLicensingStore.setState({ licenseStatus: null });
});

describe('SettingsPlanStatus', () => {
  it('renders "Free plan" and an Upgrade to Pro button for a free/no-license user', () => {
    useLicensingStore.setState({ licenseStatus: { tier: 'free', status: 'none' } as LicenseState });
    const markup = renderMarkup();
    expect(markup).toContain('Free plan');
    expect(markup).toContain('id="settings-plan-upgrade"');
    expect(markup).toContain('Upgrade to Pro');
  });

  it('renders "Free plan" and the upgrade button when no license status is loaded yet', () => {
    useLicensingStore.setState({ licenseStatus: null });
    const markup = renderMarkup();
    expect(markup).toContain('Free plan');
    expect(markup).toContain('id="settings-plan-upgrade"');
  });

  it('renders "Pro — active" with no upgrade button for a valid subscription', () => {
    useLicensingStore.setState({
      licenseStatus: { tier: 'pro', status: 'valid', kind: 'subscription' } as LicenseState,
    });
    const markup = renderMarkup();
    expect(markup).toContain('Pro — active');
    expect(markup).not.toContain('settings-plan-upgrade');
  });

  it('renders "Pro — lifetime license" with no upgrade button for a lifetime license', () => {
    useLicensingStore.setState({
      licenseStatus: { tier: 'pro', status: 'valid', kind: 'lifetime' } as LicenseState,
    });
    const markup = renderMarkup();
    expect(markup).toContain('Pro — lifetime license');
    expect(markup).not.toContain('settings-plan-upgrade');
  });

  it('renders the trial countdown label and the upgrade button while trialing', () => {
    useLicensingStore.setState({
      licenseStatus: { tier: 'pro', status: 'trial', trialEndsAt: '2099-01-01T00:00:00Z' } as LicenseState,
    });
    const markup = renderMarkup();
    expect(markup).toContain('Pro trial');
    expect(markup).toContain('id="settings-plan-upgrade"');
  });
});
