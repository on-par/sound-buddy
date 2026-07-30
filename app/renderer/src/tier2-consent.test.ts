// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it, vi } from 'vitest';
import { activateTier2Feature, TIER2_CONSENT_COPY } from './tier2-consent';

describe('activateTier2Feature (#378)', () => {
  it('activates immediately when consent was previously granted', async () => {
    const activate = vi.fn();
    const requestConsent = vi.fn();
    await expect(activateTier2Feature({ consentGranted: true, requestConsent, activate })).resolves.toBe(true);
    expect(requestConsent).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledOnce();
  });

  it('requires unmistakable consent before activating a Tier 2 feature', async () => {
    const activate = vi.fn();
    const persistConsent = vi.fn().mockResolvedValue(undefined);
    await expect(activateTier2Feature({
      consentGranted: false,
      requestConsent: async () => true,
      persistConsent,
      activate,
    })).resolves.toBe(true);
    expect(persistConsent).toHaveBeenCalledWith(true);
    expect(activate).toHaveBeenCalledOnce();
  });

  it('does not activate or persist when the consent dialog is declined', async () => {
    const activate = vi.fn();
    const persistConsent = vi.fn();
    await expect(activateTier2Feature({
      consentGranted: false,
      requestConsent: async () => false,
      persistConsent,
      activate,
    })).resolves.toBe(false);
    expect(persistConsent).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('Tier 2 consent disclosure', () => {
  it('names the exact data and the hard network boundary', () => {
    expect(TIER2_CONSENT_COPY).toContain('channel names, levels, and routing configuration');
    expect(TIER2_CONSENT_COPY).toContain('OSC over UDP');
    expect(TIER2_CONSENT_COPY).toContain('local subnet only');
    expect(TIER2_CONSENT_COPY).toContain('No cloud relay');
    expect(TIER2_CONSENT_COPY).toContain('read-only');
  });
});
