// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/sound-buddy-test' },
}));

import { loadLicensePolicy } from './license-policy-loader';

describe('loadLicensePolicy', () => {
  it('loads real GRACE_DAYS/DAY_MS values from the compiled CJS build', () => {
    const policy = loadLicensePolicy();
    expect(policy.GRACE_DAYS).toBe(7);
    expect(policy.DAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('loads real callable decodeSb1Key/resolvePolicyState functions from the compiled CJS build', () => {
    const policy = loadLicensePolicy();
    expect(typeof policy.decodeSb1Key).toBe('function');
    expect(typeof policy.resolvePolicyState).toBe('function');
  });

  it('memoizes — returns the same object identity on a second call', () => {
    const first = loadLicensePolicy();
    const second = loadLicensePolicy();
    expect(second).toBe(first);
  });
});
